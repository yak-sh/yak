// The kernel lends hosted execution and authenticates each callback against
// the original ask. Private inputs contain app identity and credential sentinels.
import { artifactStore, type Bucket, objectBlobs } from '@yaks/blob'
import { resolve } from '@yaks/connections'
import { type Grant, grants as authorized } from '@yaks/egress'
import type { Comp } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { Stale } from '@yaks/graph/errors'
import { token } from '@yaks/graph/sha256'
import {
  billed,
  type Executor,
  frozenRequest,
  type Inference,
  type InferenceReceipt,
  inferenceReply,
  type MediaReceipt,
  ModelError,
  type Price,
  submitCall,
} from '@yaks/model'
import { endpoint } from '@yaks/openai'
import { sentinel } from '@yaks/secrets'
import { capture } from '@yaks/tracker/report'
import type { FrozenRequest, Kernel } from '../model/worker.ts'
import { blobPrefix } from './blob-key.ts'
import { ctxOf } from './connections.ts'
import { egressOf } from './outbound.ts'
import { appStore, directoryOf } from './directory.ts'
import type { Env } from './env.ts'
import type { Stored } from './graph.ts'
import { countedMedia, refusedSpend } from './meter.ts'
import { KERNEL, metaOf } from './meta.ts'
import { vaultOf } from './vault.ts'

export let RELEASE = 'yak-model-v1'
type PrivateRequest = FrozenRequest & { app: string; price?: Price }
type Bindings = Partial<Env>
let identity = (call: string, executor = RELEASE): Inference => ({
  call,
  executor,
  request: `inference/${executor}/${call}/request`,
  receipt: `inference/${executor}/${call}/receipt`,
})
let bucket = (env: Bindings): Bucket => {
  if (!env.MODEL_RECEIPTS) {
    throw new ModelError('unbound', 'No inference receipt store')
  }
  return env.MODEL_RECEIPTS
}
let read = async <T>(env: Bindings, key: string): Promise<T | undefined> => {
  let object = await bucket(env).get(key)
  return object
    ? JSON.parse(new TextDecoder().decode(await object.arrayBuffer()))
    : undefined
}
let validate = (job: Inference) => {
  let expected = identity(job.call, job.executor)
  if (
    !/^[\w-]{1,100}$/.test(job.call) || job.executor !== RELEASE ||
    job.request !== expected.request || job.receipt !== expected.receipt
  ) {
    throw new ModelError('inference_identity')
  }
}
let requestAt = async (env: Bindings, job: Inference) => {
  validate(job)
  let frozen = await read<PrivateRequest>(env, job.request)
  if (
    !frozen?.app || frozen.call !== job.call ||
    frozen.executor !== job.executor ||
    frozen.request.call !== job.call
  ) throw new ModelError('inference_request')
  return frozen
}
let location = async (env: Bindings, app: string, dormant = false) => {
  if (!env.STORE) throw new ModelError('unbound')
  let found = await directoryOf(env.STORE).appAt(app)
  if (!found || (!dormant && (found.app.trashed || found.space.trashed))) {
    throw new ModelError('inference_app')
  }
  return found
}
let askAt = async (
  env: Bindings,
  job: Inference,
  frozen: PrivateRequest,
  found: Awaited<ReturnType<typeof location>>,
) => {
  let graph = metaOf(appStore(env.STORE!, found.space, found.app, env), KERNEL)
  let [ask] = await graph.query(`.entity.eid=${job.call}&*`, { trusted: true })
  let pinned = ask?.inference as Comp | undefined
  if (
    !ask?.ask || !ask.entry || pinned?.executor !== job.executor ||
    pinned.request !== job.request
  ) throw new ModelError('inference_identity')
  return { frozen, found, graph, ask }
}
let authenticated = async (env: Bindings, job: Inference) => {
  let frozen = await requestAt(env, job)
  return askAt(env, job, frozen, await location(env, frozen.app))
}
// The executor writes a complete private receipt only after authenticating
// the original ask. Its account can be settled while its Store is asleep.
let completed = async (env: Bindings, job: Inference) => {
  let frozen = await requestAt(env, job)
  let found = await location(env, frozen.app, true)
  let receipt = await read<InferenceReceipt>(env, job.receipt)
  if (
    !receipt || receipt.call !== job.call ||
    (!receipt.reply && !receipt.failure)
  ) throw new ModelError('inference_receipt')
  let active = found.app.trashed || found.space.trashed
    ? undefined
    : await askAt(env, job, frozen, found)
  return { frozen, found, receipt, graph: active?.graph, ask: active?.ask }
}
let budgetRefusal = (failure?: InferenceReceipt['failure']) =>
  failure?.code === 'limit' && !failure.interrupted
let platformSentinel = async (env: Bindings, name: string) =>
  sentinel(await vaultOf(env).salt(), 'hosted-inference:' + name)
let providerAt = async (
  at: Stored,
  provider: string,
): Promise<FrozenRequest['provider']> => {
  if (provider === 'openrouter') {
    if (!at.env.STORE) throw new ModelError('unbound')
    let link = await resolve(
      ctxOf({ ...at.env, STORE: at.env.STORE }),
      at.app!,
      provider,
    )
    if (!link) {
      throw new ModelError(
        'connection',
        'Connect OpenRouter to this app before asking its models',
      )
    }
    return { api: provider, key: link.sentinel }
  }
  return {
    api: 'openai',
    key: at.env.OPENAI_API_KEY ? await platformSentinel(at.env, 'openai') : '',
    base: await endpoint({
      base: at.env.OPENAI_API,
      gateway: at.env.AI_GATEWAY,
      account: at.env.CF_ACCOUNT,
      ai: at.env.AI,
    }),
    ...at.env.AI_GATEWAY_TOKEN
      ? {
        headers: {
          'cf-aig-authorization': 'Bearer ' +
            await platformSentinel(at.env, 'gateway'),
        },
      }
      : {},
  }
}

/** Missing or not-yet-live bindings preserve inline dispatch. Accepted asks
 * resume from their pinned receipt even while new dispatch is unavailable. */
export let lending = async (
  at: Stored,
  provider: string,
): Promise<Executor | undefined> => {
  if (
    !['openai', 'openrouter'].includes(provider) || !at.app ||
    !at.env.MODEL_RECEIPTS
  ) return
  let live = await at.env.MODEL?.version().catch(() => undefined)
  let enabled = live?.executor === RELEASE && !!live.id
  // A pinned ask must never fall back to an inline purchase.
  return {
    name: RELEASE,
    available: () => enabled,
    submit: async (call, req) => {
      let [ask] = await at.graph.get([call])
      let pinned = ask?.inference as Comp | undefined
      let job = identity(call, String(pinned?.executor ?? RELEASE))
      validate(job)
      if (!pinned?.request) {
        if (!enabled || !at.env.MODEL) throw new ModelError('unbound')
        let found = await location(at.env, at.app!)
        let no = await refusedSpend(
          directoryOf(at.env.STORE!),
          found.space,
          'models',
          at.env,
        )
        if (no) throw new ModelError('limit', no)
        // Retries never replace the first frozen request, including a lost
        // object-write acknowledgement before the graph pin was committed.
        if (!await read(at.env, job.request)) {
          let [model] = await at.graph.get([String((ask.ask as Comp).to)])
          let frozen: PrivateRequest = {
            call,
            executor: job.executor,
            app: at.app!,
            provider: await providerAt(at, provider),
            request: frozenRequest({ ...req, call }),
            ...model?.price ? { price: model.price as Price } : {},
          }
          await bucket(at.env).put(job.request, JSON.stringify(frozen))
        }
        await requestAt(at.env, job)
        await at.graph.apply([{
          entity: { eid: call },
          $was: {
            inference: { executor: token(pinned?.executor), request: null },
          },
          inference: { executor: job.executor, request: job.request },
        }], { trusted: true })
      }
      if (!at.env.MODEL) throw new ModelError('unbound')
      await at.env.MODEL.submit(job)
    },
    resume: async (call) => {
      let [ask] = await at.graph.get([call])
      let pinned = ask?.inference as Comp | undefined
      if (!pinned) throw new ModelError('inference_identity')
      let job = identity(call, String(pinned.executor))
      validate(job)
      let receipt = await read<InferenceReceipt>(at.env, job.receipt)
      if (!receipt) {
        // Create/lookup retries after a Store lost its acknowledgement.
        if (at.env.MODEL) await at.env.MODEL.submit(job)
        return
      }
      if (receipt.call !== call) {
        throw new Error('No matching inference receipt')
      }
      if (!pinned.receipt) {
        // Generation has finished even if the callback lost the kernel. Its
        // receipt can retry delivery and settlement without the executor.
        try {
          await hosting(at.env).delivered(job)
        } catch (error) {
          throw new ModelError(
            'inference_delivery',
            error instanceof Error ? error.message : String(error),
            { after: 1000 },
          )
        }
      }
      return inferenceReply(receipt)
    },
  }
}

/** Only the private ModelHost service entrypoint calls this interface. The
 * frozen app and the ask's server-owned pin authenticate paid operations;
 * complete private receipts retain accounting authority while an app sleeps. */
export let hosting = (env: Bindings): Kernel => ({
  submitted: async (job) => !!(await authenticated(env, job)).ask.submitted,
  claim: async (job) => {
    let { graph, found, ask } = await authenticated(env, job)
    if (ask.submitted) return { claimed: false }
    let no = await refusedSpend(
      directoryOf(env.STORE!),
      found.space,
      'models',
      env,
    )
    if (no) return { refused: { code: 'limit', reason: no } }
    try {
      await submitCall(
        { apply: (b) => graph.apply(b) },
        job.call,
        new Date().toISOString(),
      )
      return { claimed: true }
    } catch (error) {
      if (
        error instanceof Stale && error.eid === job.call &&
        error.comp === 'submitted'
      ) return { claimed: false }
      throw error
    }
  },
  checkpoint: async (job, mark) => {
    let { graph, frozen } = await authenticated(env, job)
    if (Object.keys(mark).some((name) => name !== frozen.provider.api)) {
      throw new ModelError('inference_mark')
    }
    await graph.apply([{ entity: { eid: job.call }, ...mark }])
  },
  grants: async (job): Promise<Grant[]> => {
    let { frozen } = await authenticated(env, job)
    if (frozen.provider.api === 'openrouter') {
      return authorized(egressOf({ ...env, STORE: env.STORE! }, frozen.app), {
        app: frozen.app,
        person: null,
        level: 'owner',
      }, [frozen.provider.key])
    }
    let hosts = [new URL(frozen.provider.base!).host]
    let values = [
      { name: 'openai', value: env.OPENAI_API_KEY },
      { name: 'gateway', value: env.AI_GATEWAY_TOKEN },
    ]
    return Promise.all(
      values.filter((v) => v.value).map(async (v) => ({
        sentinel: await platformSentinel(env, v.name),
        value: v.value!,
        hosts,
      })),
    )
  },
  delivered: async (job) => {
    let { frozen, found, graph, ask, receipt } = await completed(env, job)
    let media = await read<MediaReceipt>(
      env,
      `inference/${job.executor}/${job.call}/media`,
    )
    let cost =
      (ask?.cost as { dollars: number; reported: boolean } | undefined) ??
        (receipt.reply ? billed(receipt.reply, frozen.price) : undefined)
    if (media && media.call !== job.call) {
      throw new ModelError('inference_identity')
    }
    cost ??= media?.cost == null
      ? undefined
      : { dollars: media.cost, reported: media.costReported ?? true }
    if (cost) {
      await countedMedia(
        { STORE: env.STORE! },
        found.space,
        job.call,
        cost.dollars,
        cost.reported,
      )
    } else if (!budgetRefusal(receipt.failure)) {
      await hosting(env).report(job, {
        code: 'inference_cost',
        interrupted: false,
        reason: 'The original hosted call cost is unknown',
      })
    }
    if (!graph) {
      // Trash stops app work, not the accounting for a purchase already made.
      // Restore can publish this same private receipt without spending again.
      throw new ModelError(
        'inference_delivery',
        'The original hosted receipt is retained until its app is restored',
        { after: 1000 },
      )
    }
    // A finished artifact is content-addressed; copy it into the app's own
    // namespace before any subscription can advertise its download address.
    for (let artifact of receipt.reply?.artifacts ?? []) {
      if (!env.BLOBS) throw new ModelError('media_storage')
      let source = await objectBlobs(bucket(env), 'artifacts/').get(
        artifact.address,
      )
      if (!source) throw new ModelError('inference_artifact')
      let saved = await artifactStore(
        objectBlobs(env.BLOBS, blobPrefix(found.space, found.app)),
      )(source, artifact.media_type)
      if (saved.address !== artifact.address || saved.size !== artifact.size) {
        throw new ModelError('inference_artifact')
      }
    }
    await graph.apply([{
      entity: { eid: job.call },
      ...cost ? { cost } : {},
      inference: { receipt: job.receipt },
    }])
  },
  report: async (job, failure) => {
    let { ask, found } = await completed(env, job)
    if (budgetRefusal(failure)) return
    if (!env.ERRORS) throw new Error('tracker intake is unavailable')
    let error = Object.assign(new Error(failure.reason), {
      name: failure.exception?.type ?? failure.code,
      stack: failure.exception?.stack ?? '',
    })
    // Tracker ingestion deduplicates occurrence identity; retries after a lost
    // queue acknowledgement retain one report rather than losing the failure.
    await env.ERRORS.send(capture(error, {
      sink: () => {},
      eid: derivedEid('inference-report|' + job.call + '|' + failure.code),
      at: (ask?.submitted as Comp | undefined)?.at as string | undefined,
      during: { app: found.app.eid, space: found.space.eid, entity: job.call },
      tags: { request: 'hosted model ' + failure.code, executor: job.executor },
    }))
  },
})
