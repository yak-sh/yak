// The direct Responses transport: credentials go in at the HTTP edge and
// completed provider items come out. Session replay, tools, and graph writes
// belong to the runner; this file owns no conversation or process state.
import { type ObservationDelta } from './observations.ts'

export type Credential = {
  token: string
  account?: string
  base?: string
}

export type CredentialSource = {
  get: () => Promise<Credential>
  refresh?: () => Promise<Credential>
}

export type ResponseRequest = {
  model: string
  input: unknown
  [name: string]: unknown
}

export type ResponseEvent = {
  type: string
  [name: string]: unknown
}

export type ResponseItem = {
  type: string
  [name: string]: unknown
}

export type ResponseUsage = {
  input: number
  cached: number
  output: number
  reasoning: number
  raw: Record<string, unknown>
}

export type RateLimits = Record<string, string>

export type ResponseResult = {
  model: string
  items: ResponseItem[]
  unknown: ResponseEvent[]
  unknownItems: ResponseItem[]
  usage?: ResponseUsage
  response: Record<string, unknown>
  limits: RateLimits
}

export type ResponseFault = Error & {
  status?: number
  code?: string
  limits?: RateLimits
  evidence?: ResponseEvent[]
  items?: ResponseItem[]
}

export type ResponseOptions = {
  credentials: CredentialSource
  authentication?: 'required' | 'optional'
  base?: string
  fetch?: typeof fetch
  headers?: Record<string, string>
  retries?: number
  pause?: (ms: number) => Promise<void>
  id?: () => string
  shape?: (request: ResponseRequest) => Record<string, unknown>
  // Abort one exchange that makes no progress for this long — the connect that
  // never returns headers, the headers with no first frame, the mid-stream gap
  // that never closes. 0 disables. Without it a stalled bus hangs forever: the
  // managed scheduler renews the lease every half-TTL, so the generation reads
  // `running` with no error and its claim never frees (T-24135).
  stallMs?: number
}

type RunOptions = {
  signal?: AbortSignal
  event?: (event: ResponseEvent) => void
}

let knownEvents = new Set([
  'response.created',
  'response.in_progress',
  'response.completed',
  'response.failed',
  'response.incomplete',
  'response.output_item.added',
  'response.output_item.done',
  'response.content_part.added',
  'response.content_part.done',
  'response.output_text.delta',
  'response.output_text.done',
  'response.refusal.delta',
  'response.refusal.done',
  'response.reasoning_summary_part.added',
  'response.reasoning_summary_part.done',
  'response.reasoning_summary_text.delta',
  'response.reasoning_summary_text.done',
  'response.function_call_arguments.delta',
  'response.function_call_arguments.done',
  'error',
])

let knownItems = new Set([
  'message',
  'reasoning',
  'function_call',
  'compaction',
  'custom_tool_call',
])

let sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

let record = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value == 'object' && !Array.isArray(value)

// A resettable idle deadline for one provider exchange. It aborts its OWN signal
// — never the caller's stop — when `ms` passes with no progress, and each frame
// calls kick() to push the deadline forward. The caller reads stalled() to turn
// that self-abort into a diagnosable fault instead of a silent hang. A relayed
// stop aborts too, but leaves stalled() false so the caller keeps its own path.
let watchdog = (ms: number, stop?: AbortSignal) => {
  let control = new AbortController()
  let stalled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let relay = () => control.abort()
  let kick = () => {
    if (!ms || control.signal.aborted) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      stalled = true
      control.abort()
    }, ms)
  }
  if (stop?.aborted) control.abort()
  else stop?.addEventListener('abort', relay, { once: true })
  kick()
  return {
    signal: control.signal,
    kick,
    stalled: () => stalled,
    close: () => {
      clearTimeout(timer)
      stop?.removeEventListener('abort', relay)
    },
  }
}

// Only named scalar fields cross from the OpenAI dialect into the Tasks
// observation vocabulary. Completed items take the durable runner path;
// these deltas are hints for a watcher who is connected right now.
export let responseObservation = (
  event: ResponseEvent,
): ObservationDelta | undefined => {
  if (
    event.type == 'response.output_text.delta' ||
    event.type == 'response.refusal.delta'
  ) {
    return typeof event.delta == 'string' && event.delta
      ? { kind: 'model', text: event.delta }
      : undefined
  }
  if (event.type == 'response.reasoning_summary_text.delta') {
    return typeof event.delta == 'string' && event.delta
      ? { kind: 'reasoning', text: event.delta }
      : undefined
  }
  if (event.type == 'response.output_item.added' && record(event.item)) {
    let item = event.item
    if (item.type == 'function_call' || item.type == 'custom_tool_call') {
      return {
        kind: 'tool',
        name: typeof item.name == 'string' ? item.name : 'tool',
      }
    }
  }
  return undefined
}

let fault = (
  message: string,
  fields: Omit<ResponseFault, keyof Error> = {},
): ResponseFault => Object.assign(new Error(message), fields)

let scrub = (value: unknown, secrets: string[]): unknown => {
  if (typeof value == 'string') {
    let text = value
    for (let secret of secrets) {
      if (secret) text = text.replaceAll(secret, '[redacted]')
    }
    return text
  }
  if (Array.isArray(value)) return value.map((item) => scrub(item, secrets))
  if (!record(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([name, item]) => [name, scrub(item, secrets)]),
  )
}

let safe = (value: unknown, secrets: string[]) => {
  let clean = scrub(value, secrets)
  if (!record(clean)) throw fault('responses: expected an object')
  return clean
}

// An HTTP-error body carries both a short machine `code` and the human
// `message` naming what it rejected ("No tool output for function call …").
// A failed session stamps only the fault's .message, so the reason is the
// half that makes the failure diagnosable — carry both through, redacted.
let explain = (body: string, secrets: string[]) => {
  let parsed: unknown
  try {
    parsed = scrub(JSON.parse(body), secrets)
  } catch {
    return {}
  }
  if (!record(parsed)) return {}
  let error = record(parsed.error)
    ? parsed.error
    : record(parsed.detail)
    ? parsed.detail
    : parsed
  let code = typeof error.code == 'string' && /^[\w.:-]{1,64}$/.test(error.code)
    ? error.code
    : undefined
  let reason = typeof error.message == 'string' && error.message.trim()
    ? error.message.trim()
    : undefined
  return { code, reason }
}

let eventCode = (frame: ResponseEvent | undefined) => {
  if (!frame) return undefined
  let response = record(frame.response) ? frame.response : frame
  let error = record(response.error) ? response.error : response
  let value = error.code
  return typeof value == 'string' && /^[\w.:-]{1,64}$/.test(value)
    ? value
    : undefined
}

let incomplete = (frame: ResponseEvent | undefined) => {
  if (frame?.type != 'response.incomplete') return undefined
  let response = record(frame.response) ? frame.response : {}
  let details = record(response.incomplete_details)
    ? response.incomplete_details
    : {}
  let reason = details.reason
  return typeof reason == 'string' && /^[\w.:-]{1,64}$/.test(reason)
    ? reason
    : undefined
}

let limitNames = new Set([
  'retry-after',
  'x-ratelimit-limit-requests',
  'x-ratelimit-limit-tokens',
  'x-ratelimit-remaining-requests',
  'x-ratelimit-remaining-tokens',
  'x-ratelimit-reset-requests',
  'x-ratelimit-reset-tokens',
])

let limits = (headers: Headers): RateLimits =>
  Object.fromEntries(
    [...headers]
      .filter(([name]) => limitNames.has(name.toLowerCase()))
      .map(([name, value]) => [name.toLowerCase(), value]),
  )

let event = (block: string, secrets: string[]) => {
  let data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
  if (!data || data == '[DONE]') return null
  let parsed: unknown
  try {
    parsed = scrub(JSON.parse(data), secrets)
  } catch {
    throw fault('responses: malformed SSE data')
  }
  if (!record(parsed) || typeof parsed.type != 'string') {
    throw fault('responses: stream event has no type')
  }
  return parsed as ResponseEvent
}

let events = async function* (
  body: ReadableStream<Uint8Array>,
  secrets: string[],
) {
  let reader = body.getReader()
  let decoder = new TextDecoder()
  let pending = ''
  while (true) {
    let part = await reader.read()
    pending += decoder.decode(part.value, { stream: !part.done })
    let blocks = pending.split(/\r?\n\r?\n/)
    pending = blocks.pop() ?? ''
    for (let block of blocks) {
      let parsed = event(block, secrets)
      if (parsed) yield parsed
    }
    if (part.done) break
  }
  if (pending.trim()) {
    let parsed = event(pending, secrets)
    if (parsed) yield parsed
  }
}

let usage = (value: unknown): ResponseUsage | undefined => {
  if (!record(value)) return undefined
  let input = record(value.input_tokens_details)
    ? value.input_tokens_details
    : {}
  let output = record(value.output_tokens_details)
    ? value.output_tokens_details
    : {}
  return {
    input: Number(value.input_tokens ?? 0),
    cached: Number(input.cached_tokens ?? 0),
    output: Number(value.output_tokens ?? 0),
    reasoning: Number(output.reasoning_tokens ?? 0),
    raw: value,
  }
}

let terminal = async (
  response: Response,
  secrets: string[],
  notify?: (event: ResponseEvent) => void,
  kick?: () => void,
): Promise<ResponseResult> => {
  if (!response.body) throw fault('responses: provider returned no stream')
  // Headers arrived; reset the deadline for the wait on the first frame, then on
  // every frame the gap to the next one.
  kick?.()
  let items: ResponseItem[] = []
  let unknown: ResponseEvent[] = []
  let completed: Record<string, unknown> | undefined
  let ended: ResponseEvent | undefined
  for await (let frame of events(response.body, secrets)) {
    kick?.()
    notify?.(frame)
    if (!knownEvents.has(frame.type)) unknown.push(frame)
    if (frame.type == 'response.output_item.done') {
      let item = safe(frame.item, secrets)
      if (typeof item.type != 'string') {
        throw fault('responses: completed item has no type')
      }
      items.push(item as ResponseItem)
    }
    if (frame.type == 'response.completed') {
      completed = safe(frame.response, secrets)
    }
    if (
      frame.type == 'response.failed' ||
      frame.type == 'response.incomplete' ||
      frame.type == 'error'
    ) ended = frame
  }
  if (!completed) {
    let status = ended?.type?.replace('response.', '') ?? 'disconnected'
    let reason = incomplete(ended) ?? eventCode(ended)
    throw fault(`responses: ${status}${reason ? ` — ${reason}` : ''}`, {
      code: eventCode(ended) ?? reason,
      evidence: ended ? [...unknown, ended] : unknown,
      items,
    })
  }
  if (completed.status != 'completed') {
    throw fault(`responses: ${String(completed.status ?? 'failed')}`)
  }
  if (typeof completed.model != 'string') {
    throw fault('responses: completion names no serving model')
  }
  return {
    model: completed.model,
    items,
    unknown,
    unknownItems: items.filter((item) => !knownItems.has(item.type)),
    usage: usage(completed.usage),
    response: completed,
    limits: limits(response.headers),
  }
}

let credential = (value: Credential, optional = false) => {
  if (!optional && !value.token?.trim()) throw fault('responses: no credential')
  return value
}

let credentials = async (
  load: () => Promise<Credential>,
  message: string,
  optional = false,
  retries = 0,
  pause: (ms: number) => Promise<void> = sleep,
) => {
  for (let failures = 0;; failures++) {
    try {
      return credential(await load(), optional)
    } catch {
      if (failures >= retries) throw fault(message)
      await pause(200 * 2 ** failures)
    }
  }
}

let request = (value: ResponseRequest) => {
  let include = Array.isArray(value.include) ? [...value.include] : []
  if (!include.includes('reasoning.encrypted_content')) {
    include.push('reasoning.encrypted_content')
  }
  return { ...value, include, store: false, stream: true }
}

export let responses = (options: ResponseOptions) => {
  let fetcher = options.fetch ?? fetch
  let base = options.base?.replace(/\/$/, '')
  let retries = Math.max(0, options.retries ?? 2)
  let stallMs = Math.max(0, options.stallMs ?? 0)
  let pause = options.pause ?? sleep
  let id = options.id ?? (() => crypto.randomUUID())
  // Refresh replaces the credential at the HTTP edge, but completed provider
  // items from later turns may still echo something seen before the refresh.
  // Keep every credential this transport has held as a redaction term for its
  // whole lifetime; none of them leave this closure.
  let secrets: string[] = []
  let remember = (auth: Credential) => {
    for (let value of [auth.token, auth.account ?? '']) {
      if (value && !secrets.includes(value)) secrets.push(value)
    }
  }

  let run = async (
    value: ResponseRequest,
    run: RunOptions = {},
  ): Promise<ResponseResult> => {
    let auth = await credentials(
      options.credentials.get,
      'responses: credential unavailable',
      options.authentication == 'optional',
      retries,
      pause,
    )
    remember(auth)
    let refreshed = false
    let failures = 0
    let requestId = id()
    while (true) {
      let headers = new Headers(options.headers)
      headers.set('accept', 'text/event-stream')
      if (auth.token) headers.set('authorization', `Bearer ${auth.token}`)
      headers.set('content-type', 'application/json')
      headers.set('x-client-request-id', requestId)
      if (auth.account) headers.set('chatgpt-account-id', auth.account)

      // One deadline spans this whole exchange — the connect, the wait on the
      // first frame, and every mid-stream gap — each frame pushing it forward.
      // A trip aborts its own signal (not run.signal), so the throw below is a
      // named stall the caller can fail on, never a silent hang.
      let dog = watchdog(stallMs, run.signal)
      let response: Response
      try {
        let endpoint = (base ?? auth.base ?? 'https://api.openai.com/v1')
          .replace(/\/$/, '')
        response = await fetcher(`${endpoint}/responses`, {
          method: 'POST',
          headers,
          body: JSON.stringify(options.shape?.(value) ?? request(value)),
          signal: dog.signal,
        })
      } catch (error) {
        dog.close()
        if (dog.stalled()) throw fault('responses: transport stalled')
        if (run.signal?.aborted || (error as Error)?.name == 'AbortError') {
          throw error
        }
        throw fault('responses: transport failed')
      }

      if (
        response.status == 401 &&
        !refreshed &&
        options.credentials.refresh
      ) {
        dog.close()
        await response.body?.cancel()
        auth = await credentials(
          options.credentials.refresh,
          'responses: credential refresh failed',
          options.authentication == 'optional',
          retries,
          pause,
        )
        remember(auth)
        refreshed = true
        continue
      }
      if (response.status >= 500 && failures < retries) {
        dog.close()
        await response.body?.cancel()
        await pause(200 * 2 ** failures++)
        continue
      }
      if (!response.ok) {
        dog.close()
        let body = await response.text()
        let status = response.status
        let { code, reason } = explain(body, secrets)
        throw fault(
          `responses: HTTP ${status}${reason ? ` — ${reason}` : ''}`,
          { status, code, limits: limits(response.headers) },
        )
      }
      try {
        return await terminal(response, secrets, run.event, dog.kick)
      } catch (error) {
        if (dog.stalled()) throw fault('responses: stream stalled')
        throw error
      } finally {
        dog.close()
      }
    }
  }

  // A connectivity probe distinct from "credentials exist": reach the serving
  // endpoint and report whether the transport got there at all. Any HTTP answer
  // — even 401 or 5xx — proves the bus is up; only a network failure or a bounded
  // timeout (the silent hang `run` guards mid-stream) reads as unreachable. A
  // readiness gate pairs this with the account's signed-in state so a box whose
  // bus is down or wedged drops out of the dispatch rotation (T-24135).
  let reach = async (): Promise<boolean> => {
    let auth: Credential
    try {
      auth = await credentials(
        options.credentials.get,
        'responses: credential unavailable',
        options.authentication == 'optional',
      )
    } catch {
      return false
    }
    remember(auth)
    let headers = new Headers(options.headers)
    headers.set('accept', 'application/json')
    if (auth.token) headers.set('authorization', `Bearer ${auth.token}`)
    if (auth.account) headers.set('chatgpt-account-id', auth.account)
    let endpoint = (base ?? auth.base ?? 'https://api.openai.com/v1')
      .replace(/\/$/, '')
    try {
      let response = await fetcher(`${endpoint}/models`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(5000),
      })
      await response.body?.cancel()
      return true
    } catch {
      return false
    }
  }

  return { run, reach }
}
