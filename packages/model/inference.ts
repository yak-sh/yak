// A lent executor keeps the original ask while a separately hosted generation
// runs. Private requests and receipts cross durable steps by reference only.
import {
  type Mark,
  type Model,
  ModelError,
  type Reply,
  type Request,
} from './mod.ts'

/** A session yields while resume has no receipt; submit is idempotent by call. */
export type Executor = {
  /** A durable admission mark distinguishes these asks from older inline work. */
  name?: string
  /** New asks may dispatch only while the independently deployed service is live. */
  available?: () => boolean | Promise<boolean>
  submit: (call: string, request: Request) => Promise<void>
  resume: (call: string) => Promise<Reply | undefined>
}

/** JSON input to an executor. Functions and process-local cancellation never
 * enter the private frozen object. */
export type FrozenModelRequest =
  & Pick<
    Request,
    | 'call'
    | 'model'
    | 'input'
    | 'modalities'
    | 'effort'
    | 'instructions'
    | 'tools'
    | 'questions'
    | 'tokens'
    | 'anchor'
    | 'conversation'
  >
  & {
    items: (Exclude<Request['items'][number], { kind: 'image' }> | {
      kind: 'image'
      bytes: number[]
      mediaType: string
      label: string
    })[]
  }

export let frozenRequest = (req: Request): FrozenModelRequest => {
  let {
    call,
    model,
    input,
    modalities,
    effort,
    instructions,
    tools,
    questions,
    tokens,
    anchor,
    conversation,
  } = req
  return JSON.parse(JSON.stringify({
    call,
    model,
    input,
    modalities,
    effort,
    instructions,
    tools,
    questions,
    tokens,
    anchor,
    conversation,
    items: req.items.map((item) =>
      item.kind === 'image' ? { ...item, bytes: [...item.bytes] } : item
    ),
  }))
}

export let thawedRequest = (req: FrozenModelRequest): Request => ({
  ...req,
  items: req.items.map((item) =>
    item.kind === 'image'
      ? { ...item, bytes: Uint8Array.from(item.bytes) }
      : item
  ),
})

/** The ask's pinned executor and private object references. */
export type Inference = {
  call: string
  executor: string
  request: string
  receipt: string
}

/** A complete private answer, or evidence that generation cannot be repeated. */
export type InferenceReceipt = {
  call: string
  reply?: Reply
  mark?: Mark
  failure?: {
    code: string
    interrupted: boolean
    reason: string
    exception?: { type: string; stack?: string }
  }
}

/** Every effect belongs to the host. claim must atomically mark submission,
 * return false if already marked, and never clear that mark on failure. */
export type InferenceHost = {
  read: (job: Inference) => Promise<InferenceReceipt | undefined>
  save: (job: Inference, receipt: InferenceReceipt) => Promise<void>
  request: (job: Inference) => Promise<Request>
  model: (job: Inference) => Promise<Model>
  submitted: (job: Inference) => Promise<boolean>
  claim: (job: Inference) => Promise<boolean>
  checkpoint: (job: Inference, mark: Mark) => Promise<void>
  /** Complete provider evidence can retry delivery, never generation. */
  recoverable?: (job: Inference) => Promise<boolean>
}

/** Paid generation is never repeated after an uncertain submission. A saved
 * provider receipt may still recover its output without another generation. */
export let infer = async (
  job: Inference,
  host: InferenceHost,
): Promise<string> => {
  let saved = await host.read(job)
  if (saved) return job.receipt
  let model = await host.model(job)
  let request = await host.request(job)
  let fresh = !await host.submitted(job)
  let sent = false, submissionFailure: unknown
  let receipt: InferenceReceipt
  try {
    let reply: Reply
    if (fresh) {
      // Free preparation may retry. Only the adapter's paid POST boundary
      // claims submission, and no transport retry can spend that claim twice.
      let guarded = {
        ...request,
        call: job.call,
        onSubmit: async () => {
          if (sent) throw new ModelError('inference_interrupted')
          sent = true
          try {
            if (!await host.claim(job)) throw new ModelError('submitted')
          } catch (error) {
            submissionFailure = error
            throw error
          }
        },
        onAck: (mark: Mark) => host.checkpoint(job, mark),
      }
      reply = await model(guarded)
    } else {
      if (!model.recover) throw new ModelError('inference_interrupted')
      reply = await model.recover(job.call)
    }
    receipt = { call: job.call, reply, mark: model.mark?.(reply) }
  } catch (error) {
    // A lost claim acknowledgement may have committed. The next attempt reads
    // durable submission evidence; a preparation failure has made no purchase.
    if (submissionFailure || (fresh && !sent)) throw error
    // A delivery failure may have a durable provider receipt: let the step
    // retry recovery. Missing/partial evidence must become an interruption.
    if (await host.recoverable?.(job)) {
      throw new ModelError(
        'inference_delivery',
        'Receipt delivery is pending',
        { after: 1000 },
      )
    }
    receipt = {
      call: job.call,
      failure: {
        code: error instanceof ModelError
          ? error.code
          : 'inference_interrupted',
        interrupted: true,
        reason: error instanceof Error ? error.message : String(error),
        ...error instanceof Error && !(error instanceof ModelError)
          ? { exception: { type: error.name, stack: error.stack } }
          : {},
      },
    }
  }
  // Outside the catch: a failed save must retry from existing submission
  // evidence, rather than recording the successful output as failed.
  await host.save(job, receipt)
  return job.receipt
}

/** Sessions receive a final result, never a reason to regenerate this ask. */
export let inferenceReply = (receipt: InferenceReceipt): Reply => {
  if (receipt.reply) return receipt.reply
  throw new ModelError(
    receipt.failure?.interrupted
      ? 'inference_interrupted'
      : receipt.failure?.code ?? 'inference_receipt',
    receipt.failure?.reason ??
      'The original generation could not be recovered; a new generation requires a new ask',
  )
}
