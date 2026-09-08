// The Responses API as a `Model`: neutral items in, one streamed exchange over
// fetch, neutral items out. The stream is read to its end and only the
// completed items are kept — a daemon records what a model said and asked
// for, not how it arrived — so this file owns no deltas and no watcher.
//
// Two facts about the wire live here and nowhere else. Every request streams
// (`stream: true`) because the Codex backend answers nothing else. Every
// request says whether the provider may keep it (`store`): the public API can,
// and then a reply's id anchors the next request; the Codex backend refuses
// anything but `store: false`, so a caller there replays the conversation.

import {
  type Item,
  type Model,
  ModelError,
  type Reply,
  type Request,
} from '@yaks/model'
import type { Credential } from './credential.ts'

/** How the model is reached. */
export type Options = {
  credential: () => Credential | Promise<Credential>
  fetch?: typeof fetch
  /** the provider keeps the reply, so its id can anchor the next request.
   * The Codex backend refuses `true`. */
  store?: boolean
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
export let body = (req: Request, store = false): Frame => ({
  model: req.model,
  ...req.instructions ? { instructions: req.instructions } : {},
  input: input(req.items),
  tools: req.tools.map((t) => ({ type: 'function', strict: false, ...t })),
  ...req.effort ? { reasoning: { effort: req.effort } } : {},
  ...req.anchor ? { previous_response_id: req.anchor } : {},
  include: ['reasoning.encrypted_content'],
  store,
  stream: true,
})

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

let frame = (block: string): Frame | undefined => {
  let data = block.split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
  if (!data || data == '[DONE]') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    throw new ModelError('malformed_stream', 'malformed SSE data')
  }
  return record(parsed) ? parsed : undefined
}

/** The events of a server-sent event stream, one parsed frame at a time. */
export let frames = async function* (
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<Frame> {
  let reader = stream.getReader()
  let decoder = new TextDecoder()
  let pending = ''
  while (true) {
    let part = await reader.read()
    pending += decoder.decode(part.value, { stream: !part.done })
    let blocks = pending.split(/\r?\n\r?\n/)
    pending = blocks.pop() ?? ''
    for (let block of blocks) {
      let f = frame(block)
      if (f) yield f
    }
    if (part.done) break
  }
  let last = pending.trim() && frame(pending)
  if (last) yield last
}

// The short machine word an error body or event carries, when it has one.
let codeOf = (value: unknown): string | undefined => {
  if (!record(value)) return undefined
  let error = record(value.error) ? value.error : value
  let code = error.code
  return typeof code == 'string' && /^[\w.:-]{1,64}$/.test(code)
    ? code
    : undefined
}

let reasonOf = (value: unknown): string | undefined => {
  if (!record(value)) return undefined
  let error = record(value.error) ? value.error : value
  return typeof error.message == 'string' ? error.message : undefined
}

let refused = async (response: Response): Promise<never> => {
  let text = await response.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch { /* not JSON: the status is the word */ }
  let reason = reasonOf(parsed)
  throw new ModelError(
    codeOf(parsed) ?? `http_${response.status}`,
    `HTTP ${response.status}${reason ? ` — ${reason}` : ''}`,
  )
}

// Read the stream to its end: the completed items, and the completion frame
// that names the reply and the serving model.
let drain = async (
  stream: ReadableStream<Uint8Array>,
): Promise<{ done: Frame[]; completed: Frame }> => {
  let done: Frame[] = []
  let completed: Frame | undefined
  let ended: Frame | undefined
  for await (let f of frames(stream)) {
    if (f.type == 'response.output_item.done' && record(f.item)) {
      done.push(f.item)
    } else if (f.type == 'response.completed' && record(f.response)) {
      completed = f.response
    } else if (
      f.type == 'response.failed' || f.type == 'response.incomplete' ||
      f.type == 'error'
    ) ended = f
  }
  if (!completed) {
    let status = str(ended?.type, 'disconnected').replace('response.', '')
    let inner = record(ended?.response) ? ended!.response : ended
    throw new ModelError(codeOf(inner) ?? status, `response ${status}`)
  }
  return { done, completed }
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
 */
export let responses = (opts: Options): Model => async (req) => {
  let auth: Credential
  try {
    auth = await opts.credential()
  } catch (e) {
    throw new ModelError('no_credential', (e as Error).message)
  }
  let headers = new Headers({
    'content-type': 'application/json',
    accept: 'text/event-stream',
    authorization: `Bearer ${auth.token}`,
  })
  if (auth.account) headers.set('chatgpt-account-id', auth.account)
  let go = opts.fetch ?? fetch
  let response: Response
  try {
    response = await go(`${auth.base.replace(/\/$/, '')}/responses`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body(req, opts.store)),
    })
  } catch (e) {
    throw new ModelError(
      'transport',
      `transport failed: ${(e as Error).message}`,
    )
  }
  if (!response.ok) return refused(response)
  if (!response.body) throw new ModelError('no_stream', 'no stream')
  let { done, completed } = await drain(response.body)
  let reply: Reply = {
    id: str(completed.id),
    model: str(completed.model, req.model),
    items: items(done),
  }
  return reply
}
