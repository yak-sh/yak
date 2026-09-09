// Neutral model items in and out; transport.ts alone owns the Responses wire.
import {
  type Item,
  type Model,
  ModelError,
  type Reply,
  type Request,
} from '@yaks/model'
import type { VocabDoc } from '@yaks/vocab'
import type { Credential } from './credential.ts'
import doc from './vocab.json' with { type: 'json' }
import {
  request,
  ResponseError,
  type ResponseOptions,
  type ResponseRequest,
  type RunOptions,
  transport,
} from './transport.ts'

/** The one comp this provider stamps on an ask it answered:
 * `openai{response_id}`. Load it beside the conversation's vocabulary. */
export let openaiDoc: VocabDoc = doc

export let OPENAI_COMP = 'openai'

/** How the model is reached. */
export type Options = Omit<ResponseOptions, 'credentials'> & RunOptions & {
  credential: () => Credential | Promise<Credential>
  /** Retry a rejected credential once with a fresh bearer. */
  refresh?: () => Credential | Promise<Credential>
}

type Frame = Record<string, unknown>

let record = (value: unknown): value is Frame =>
  value != null && typeof value == 'object' && !Array.isArray(value)

let str = (value: unknown, fallback = '') =>
  typeof value == 'string' ? value : fallback

// The neutral items in the API's four spellings.
let shape: Record<Item['kind'], (item: Item) => unknown> = {
  user: (i) => ({
    role: 'user',
    content: [{ type: 'input_text', text: (i as { text: string }).text }],
  }),
  assistant: (i) => ({
    type: 'message',
    role: 'assistant',
    content: [{ type: 'output_text', text: (i as { text: string }).text }],
  }),
  call: (i) => {
    let c = i as { id: string; name: string; args: string }
    return {
      type: 'function_call',
      call_id: c.id,
      name: c.name,
      arguments: c.args,
    }
  },
  result: (i) => {
    let r = i as { id: string; output: string }
    return { type: 'function_call_output', call_id: r.id, output: r.output }
  },
}

/** A request's items as Responses input items. */
export let input = (items: Item[]): unknown[] =>
  items.map((i) => shape[i.kind](i))

/** The whole request body. */
export let body = (req: Request, store = false): ResponseRequest =>
  request({
    model: req.model,
    ...req.instructions ? { instructions: req.instructions } : {},
    input: input(req.items),
    tools: req.tools.map((t) => ({ type: 'function', strict: false, ...t })),
    ...req.effort ? { reasoning: { effort: req.effort } } : {},
    ...req.anchor ? { previous_response_id: req.anchor } : {},
  }, store)

/** Completed output items as neutral items; reasoning and anything else the
 * API adds are not part of the conversation and are dropped. */
export let items = (done: Frame[]): Item[] => {
  let out: Item[] = []
  for (let item of done) {
    if (item.type == 'message') {
      let parts = Array.isArray(item.content) ? item.content : []
      let text = parts.map((p: unknown) => record(p) ? str(p.text) : '')
        .join('')
      out.push({ kind: 'assistant', text })
    } else if (item.type == 'function_call') {
      out.push({
        kind: 'call',
        id: str(item.call_id),
        name: str(item.name),
        args: str(item.arguments, '{}'),
      })
    }
  }
  return out
}

/**
 * A {@link Model} over the Responses API.
 *
 * ```ts
 * import { credential, responses } from '@yaks/openai'
 *
 * let model = responses({
 *   credential: credential(Deno.env.get, Deno.readTextFile),
 * })
 * ```
 *
 * A refusal the API named (a 4xx, a failed response), no credential, and a
 * transport that never connected are all {@link ModelError}s; the daemon
 * records those as errors and goes on. Anything else thrown is a defect.
 *
 * The model stamps `openai{response_id}` on every ask it answers, and answers
 * that id as an anchor only when `store` is on: the Codex backend keeps
 * nothing, so through it a caller replays the conversation and the id is a
 * record, not a handle.
 */
export let responses = (opts: Options): Model =>
  Object.assign(ask(opts), {
    vocab: openaiDoc,
    mark: (reply: Reply) => ({ [OPENAI_COMP]: { response_id: reply.id } }),
    anchor: (comps: Record<string, unknown>) => {
      if (!opts.store) return undefined
      let id = (comps[OPENAI_COMP] as Record<string, unknown> | undefined)
        ?.response_id
      return typeof id == 'string' && id ? id : undefined
    },
  })

let ask = (opts: Options) => {
  let client = transport({
    ...opts,
    credentials: { get: opts.credential, refresh: opts.refresh },
    // The Model previously made one attempt; retries are caller policy.
    retries: opts.retries ?? 0,
  })
  return async (req: Request): Promise<Reply> => {
    try {
      let out = await client.run(body(req, opts.store), {
        signal: opts.signal,
        event: opts.event,
      })
      return {
        id: str(out.response.id),
        model: out.model,
        items: items(out.items),
      }
    } catch (error) {
      if (!(error instanceof ResponseError)) throw error
      throw new ModelError(error.code ?? error.kind, error.message)
    }
  }
}
