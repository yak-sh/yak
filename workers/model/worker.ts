// The executor's service door and Workflow adapter. Storage and account
// authorization are lent here, and providers are the plugins its config names
// (config.ts); generation policy lives in @yaks/model.
import { type Bucket, objectBlobs } from '@yaks/blob'
import { artifactStore } from '@yaks/blob/identify'
import { type Grant, granted } from '@yaks/egress'
import {
  type FrozenModelRequest,
  infer,
  type Inference,
  type InferenceHost,
  type InferenceReceipt,
  type Lent,
  type Mark,
  type MediaReceipt,
  type Model,
  ModelError,
  type ProviderFacet,
  thawedRequest,
} from '@yaks/model'

export let RELEASE = 'yak-model-v1'

/** Only references appear in Workflow parameters or results. */
export type WorkflowBinding = {
  create: (options: { id: string; params: Inference }) => Promise<unknown>
  get: (id: string) => Promise<{ status: () => Promise<unknown> }>
}
export type Steps = {
  do: <T extends string | void>(
    name: string,
    config: {
      retries: { limit: number; delay: number; backoff: 'exponential' }
      timeout?: number
    },
    run: () => Promise<T>,
  ) => Promise<T>
}

/** The kernel authenticates the ask and account at each I/O boundary. Its
 * claim writes submitted{at} guarded against an existing mark. */
export type Kernel = {
  submitted: (job: Inference) => Promise<boolean>
  claim: (job: Inference) => Promise<
    { claimed: boolean } | { refused: { code: string; reason: string } }
  >
  checkpoint: (job: Inference, mark: Mark) => Promise<void>
  grants: (job: Inference) => Promise<Grant[]>
  delivered: (job: Inference) => Promise<void>
  report: (
    job: Inference,
    failure: NonNullable<InferenceReceipt['failure']>,
  ) => Promise<void>
}
export type Env = {
  INFERENCES: WorkflowBinding
  RECEIPTS: Pick<Bucket, 'head' | 'get' | 'put'>
  KERNEL?: Kernel
  VERSION_METADATA?: { id: string; tag?: string; timestamp?: string }
}

/** A provider plugin the executor composes: its `./provider` facet and the
 * options its config gives it. */
export type Plugin = { facet: ProviderFacet; with?: Record<string, unknown> }

/** Frozen private input contains sentinels, never provider credentials. Image
 * bytes use arrays so JSON preserves them across a Workflow restart. The
 * provider is named as it serves (`provider.name`), lent `key` as its key and
 * given `with` over its configured options. */
export type FrozenRequest = {
  call: string
  executor: string
  provider: {
    name: string
    key: string
    with?: Record<string, unknown>
  }
  request: FrozenModelRequest
}

let validate = (job: Inference) => {
  if (
    !/^[\w-]{1,100}$/.test(job.call) || job.executor !== RELEASE ||
    job.request !== `inference/${RELEASE}/${job.call}/request` ||
    job.receipt !== `inference/${RELEASE}/${job.call}/receipt`
  ) {
    throw new ModelError('inference_identity', 'Invalid inference identity')
  }
}
let read = async <T>(env: Env, key: string): Promise<T | undefined> => {
  let object = await env.RECEIPTS.get(key)
  return object
    ? JSON.parse(new TextDecoder().decode(await object.arrayBuffer())) as T
    : undefined
}
let save = async (env: Env, key: string, value: unknown) => {
  let body = JSON.stringify(value)
  await env.RECEIPTS.put(key, body)
  // Receipts are the recovery evidence. A lost write acknowledgement cannot
  // be treated as delivery success.
  if (JSON.stringify(await read(env, key)) !== body) {
    throw new ModelError(
      'inference_storage',
      'Private inference receipt was not saved',
    )
  }
}
let frozen = async (env: Env, job: Inference): Promise<FrozenRequest> => {
  validate(job)
  let record = await read<FrozenRequest>(env, job.request)
  if (!record || record.call !== job.call || record.executor !== job.executor) {
    throw new ModelError('inference_request', 'No matching frozen request')
  }
  return record
}
let kernel = (env: Env): Kernel => {
  if (!env.KERNEL) {
    throw new ModelError('unbound', 'The inference host is not bound')
  }
  return env.KERNEL
}

/** Repeated submission creates or finds the same instance, including when
 * create succeeded but its acknowledgement was lost. */
export let submit = async (env: Env, job: Inference): Promise<void> => {
  await frozen(env, job)
  kernel(env)
  try {
    await env.INFERENCES.create({ id: job.call, params: job })
  } catch (error) {
    try {
      await (await env.INFERENCES.get(job.call)).status()
    } catch {
      throw error
    }
  }
}

// The model a frozen call names, from the first plugin serving it, lent this
// call's grants, receipts and artifact store.
let served = (
  plugins: readonly Plugin[],
  provider: FrozenRequest['provider'],
  lent: Omit<Lent, 'key'>,
): Model => {
  for (let plugin of plugins) {
    let model = plugin.facet.providers?.(
      { ...lent, key: () => Promise.resolve(provider.key) },
      { ...plugin.with, ...provider.with },
    )[provider.name]
    if (model) return model
  }
  throw new ModelError('inference_provider', 'No provider ' + provider.name)
}

export let host = (env: Env, plugins: readonly Plugin[]): InferenceHost => {
  let mediaKey = (job: Inference) =>
    `inference/${job.executor}/${job.call}/media`
  let media = (job: Inference) => ({
    read: () => read<MediaReceipt>(env, mediaKey(job)),
    save: (receipt: MediaReceipt) => save(env, mediaKey(job), receipt),
  })
  return {
    read: (job) => read<InferenceReceipt>(env, job.receipt),
    save: (job, receipt) => save(env, job.receipt, receipt),
    claim: async (job) => {
      let result = await kernel(env).claim(job)
      if ('refused' in result) {
        throw new ModelError(result.refused.code, result.refused.reason)
      }
      return result.claimed
    },
    submitted: (job) => kernel(env).submitted(job),
    checkpoint: (job, mark) => kernel(env).checkpoint(job, mark),
    recoverable: async (job) => {
      let receipt = await media(job).read()
      return !!receipt &&
        (receipt as MediaReceipt & { complete?: boolean }).complete !== false
    },
    request: async (job) => {
      let { request } = await frozen(env, job)
      return thawedRequest(request)
    },
    model: async (job): Promise<Model> => {
      let record = await frozen(env, job)
      let send: typeof fetch = async (input, init) =>
        granted(
          await kernel(env).grants(job),
          new Request(input, init),
        )
      return served(plugins, record.provider, {
        fetch: send,
        refresh: () => Promise.resolve(undefined),
        store: artifactStore(objectBlobs(env.RECEIPTS, 'artifacts/')),
        env: () => undefined,
        receipts: media(job),
      })
    },
  }
}

/** Retry generation only through infer's durable submission guard. Completion
 * and reporting retry independently and return no payload to Workflow storage. */
export let run = async (
  env: Env,
  job: Inference,
  step: Steps,
  plugins: readonly Plugin[],
): Promise<string> => {
  validate(job)
  let retry = {
    retries: { limit: 5, delay: 5000, backoff: 'exponential' as const },
  }
  let receipt: string
  try {
    receipt = await step.do(
      'generation',
      { ...retry, timeout: 30 * 60 * 1000 },
      () => infer(job, host(env, plugins)),
    )
  } catch (error) {
    // Exhausted recovery must wake the original ask with a final outcome.
    // Provider/media evidence stays private and intact for later accounting.
    receipt = await step.do('interrupted receipt', retry, async () => {
      let h = host(env, plugins)
      if (!await h.read(job)) {
        await h.save(job, {
          call: job.call,
          failure: {
            code: 'inference_interrupted',
            interrupted: true,
            reason: error instanceof Error ? error.message : String(error),
            ...error instanceof Error
              ? { exception: { type: error.name, stack: error.stack } }
              : {},
          },
        })
      }
      return job.receipt
    })
  }
  try {
    await step.do('delivery', retry, () => kernel(env).delivered(job))
  } catch (error) {
    await step.do(
      'delivery failure report',
      retry,
      () =>
        kernel(env).report(job, {
          code: 'inference_delivery',
          interrupted: false,
          reason: error instanceof Error ? error.message : String(error),
          ...error instanceof Error
            ? { exception: { type: error.name, stack: error.stack } }
            : {},
        }),
    )
    throw error
  }
  await step.do('report', retry, async () => {
    let saved = await read<InferenceReceipt>(env, receipt)
    if (saved?.failure) await kernel(env).report(job, saved.failure)
  })
  return receipt
}
