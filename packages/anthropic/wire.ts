// The Messages API on the wire, spoken over fetch: the shapes this package
// sends and reads (only the parts it uses), one request to the API, what a
// refusal means, and the message a reply's event stream builds.
import { ModelError } from '@yaks/model'
import { jsonFrames } from '@yaks/model/sse'

/** The API version every request names. */
export let VERSION = '2026-10-21'
let BASE = 'https://api.anthropic.com'

type Base64 = { type: 'base64'; media_type: string; data: string }

/** A block of a message sent. */
export type Block =
  | { type: 'text'; text: string }
  | { type: 'image' | 'document'; source: Base64 }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string }

/** A message sent: one role's turn. */
export type Param = { role: 'user' | 'assistant'; content: Block[] }

export type ToolParam = {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

/** A tool the API runs itself, named by its `type`. */
export type HostedParam =
  & { type: string; name: string }
  & Record<
    string,
    unknown
  >

/** What a reply used, as the API counts it. */
export type ApiUsage = {
  input_tokens?: number | null
  output_tokens: number
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
  cache_creation?: { ephemeral_1h_input_tokens?: number } | null
  server_tool_use?: { web_search_requests?: number | null } | null
}

/** Where a block of a reply's text came from: a web search result names its
 * page by `url`. */
export type Citation = { type: string; url?: string; title?: string | null }

/** A block of a reply: text, a tool call, or one this package passes by.
 * `json` is a call's input as the stream has sent it so far. */
export type Content = {
  type: string
  text?: string
  id?: string
  name?: string
  input?: unknown
  json?: string
  citations?: Citation[]
}

export type Message = {
  id: string
  model: string
  content: Content[]
  stop_reason?: string | null
  stop_details?: { explanation?: string | null } | null
  usage: ApiUsage
}

/** One page of a list, and where the next begins. */
export type Page<T> = { data: T[]; has_more: boolean; last_id?: string | null }

export type ModelInfo = {
  id: string
  display_name: string
  max_input_tokens?: number | null
}

/** One event of a reply's stream. */
export type Event = {
  type: string
  index?: number
  message?: Message
  content_block?: Content
  delta?: {
    type?: string
    text?: string
    partial_json?: string
    citation?: Citation
    stop_reason?: string | null
    stop_details?: Message['stop_details']
  }
  usage?: Partial<ApiUsage>
}

export type Wire = {
  fetch?: typeof fetch
  base?: string
}

// The status each error type comes with, so an error event mid-stream is read
// as the status it would have been sent with.
let STATUS: Record<string, number> = {
  authentication_error: 401,
  permission_error: 403,
  not_found_error: 404,
  rate_limit_error: 429,
  api_error: 500,
  overloaded_error: 529,
}

let parse = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * What the API refused with, said the way a model's failure is said here: a
 * rate limit or an overloaded or failing server is `busy` and may pass, the
 * key's account out of credit is `credit`, a refused key is `key`, an unknown
 * model is `model`, and a request it would not take is `request`. A spent
 * credit balance is never `limit`: that is a caller's own ceiling, which is
 * expected, while the account running dry is a failure of whoever holds the
 * key. `status` is the HTTP status, or none for an error event mid-stream.
 */
export let failure = (
  status: number | undefined,
  body: string,
  headers?: Headers,
): ModelError => {
  let error = (parse(body) as { error?: { type?: string; message?: string } })
    ?.error
  let at = status ?? STATUS[error?.type ?? ''] ?? 400
  let said = [status, error?.message ?? body].filter(Boolean).join(' ') ||
    `${at}`
  let wait = Number(headers?.get('retry-after'))
  let retry = Number.isFinite(wait) && wait > 0 ? { after: wait * 1000 } : {}
  let response = { body }
  return at == 429 || at >= 500
    ? new ModelError('busy', said, retry, response)
    : at == 401 || at == 403
    ? new ModelError('key', said, undefined, response)
    : at == 404
    ? new ModelError('model', said, undefined, response)
    : /credit balance/i.test(body)
    ? new ModelError('credit', said, undefined, response)
    : new ModelError('request', said, undefined, response)
}

/** A request to the API, refused as {@link failure} says. A connection that
 * fails is `busy`; a stop the caller asked for is thrown as its reason. */
export let send = async (
  wire: Wire,
  key: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> => {
  init.signal?.throwIfAborted()
  let headers = {
    accept: 'application/json',
    authorization: `Bearer ${key}`,
    'anthropic-version': VERSION,
    ...init.body ? { 'content-type': 'application/json' } : {},
  }
  // Named, so a host's ANTHROPIC_BASE_URL never redirects the key.
  let url = (wire.base ?? BASE).replace(/\/$/, '') + path
  let response: Response
  try {
    response = await (wire.fetch ?? fetch)(url, { ...init, headers })
  } catch (e) {
    init.signal?.throwIfAborted()
    throw new ModelError('busy', (e as Error)?.message ?? String(e), {})
  }
  if (response.ok) return response
  let body = await response.text().catch(() => '')
  throw failure(response.status, body, response.headers)
}

let fault = (kind: string, message: string) =>
  kind == 'transport'
    ? new ModelError('busy', message, {})
    : new ModelError(kind, message)

/** A reply's events as they arrive; an error event is thrown as
 * {@link failure} reads it, and a dropped connection is `busy`. */
export let events = (body: ReadableStream<Uint8Array>) =>
  jsonFrames(body, fault, (e) => {
    if (typeof e.type != 'string') {
      throw fault('malformed_stream', 'a stream event has no type')
    }
    if (e.type == 'error') throw failure(undefined, JSON.stringify(e))
  }) as AsyncGenerator<Event>

let input = (json: string) => {
  let v = parse(json)
  if (v === undefined) {
    throw fault('malformed_stream', 'a tool call input is not JSON')
  }
  return v
}

let present = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v != null))

/** The message after one more event of its stream: a block begins, grows by
 * its delta (text, a tool call's input, a citation) or ends, or the message
 * says why it stopped and what it used.
 * Usage is cumulative, so each count the event names replaces the last. */
export let built = (m: Message, e: Event): Message => {
  let at = e.index ?? 0
  let block = m.content[at]
  let d = e.delta ?? {}
  if (e.type == 'content_block_start') {
    m.content[at] = { ...e.content_block! }
  } else if (e.type == 'content_block_delta' && block) {
    if (d.type == 'text_delta') block.text = (block.text ?? '') + d.text
    if (d.type == 'input_json_delta') {
      block.json = (block.json ?? '') + d.partial_json
    }
    if (d.type == 'citations_delta' && d.citation) {
      block.citations = [...block.citations ?? [], d.citation]
    }
  } else if (e.type == 'content_block_stop' && block?.json != null) {
    let { json, ...rest } = block
    m.content[at] = { ...rest, input: json ? input(json) : rest.input }
  } else if (e.type == 'message_delta') {
    m.stop_reason = d.stop_reason
    m.stop_details = d.stop_details
    m.usage = { ...m.usage, ...present(e.usage ?? {}) }
  }
  return m
}
