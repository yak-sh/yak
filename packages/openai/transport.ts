// One Responses wire implementation, shared by the neutral Model adapter and
// callers that need provider-native items, usage, evidence, and frame hooks.
import type { Credential as ProviderCredential } from './credential.ts'

/** A bearer; omitted base uses the public API (or the transport's base). */
export type TransportCredential = Omit<ProviderCredential, 'base'> & {
  base?: string
}

export type CredentialSource = {
  get: () => TransportCredential | Promise<TransportCredential>
  refresh?: () => TransportCredential | Promise<TransportCredential>
  /** A safe, caller-authored recovery instruction; never a loader exception. */
  hint?: string
}

/** Stable credential fault text for callers that schedule sign-in recovery. */
export let CREDENTIAL_FAULT = 'responses: credential unavailable'

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

/** HTTP-edge policy. No environment, filesystem, or Tasks dependencies. */
export type ResponseOptions = {
  /** Keep response ids usable as anchors on the public API. Default false. */
  store?: boolean
  /** Scrub all credentials held by this client from frames and diagnostics.
   * Default false; enable at a boundary that records provider output. */
  redact?: boolean
  credentials: CredentialSource
  authentication?: 'required' | 'optional'
  base?: string
  fetch?: typeof fetch
  headers?: Record<string, string>
  /** Additional attempts for credential loads and transient wire failures;
   * default 2 (three total attempts). Wire backoff is 1s, 4s, then capped at
   * 60s; Retry-After may extend it, up to 60s. */
  retries?: number
  /** How long a transient wire failure may go on being retried once `retries`
   * is spent — a backend outage answers every attempt the same way, and five
   * seconds of patience is not an outage. 0 (the default) stops at `retries`;
   * the wait is the same backoff, so the total is wall-clock, not attempts. */
  patienceMs?: number
  pause?: (ms: number) => Promise<void>
  id?: () => string
  /** Replace default body shaping for compatible providers. */
  shape?: (request: ResponseRequest) => Record<string, unknown>
  /** Abort a connection, first frame, or inter-frame gap with no progress for
   * this long. 0 (the default) disables the watchdog. */
  stallMs?: number
}

/** Per-exchange cancellation and a hook for every parsed frame (after redaction). */
export type RunOptions = {
  /** Do not replay a dispatched exchange when callers expose partial output. */
  noRetry?: boolean
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
  'image_generation_call',
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

/** A wire failure. `kind` is stable even when the provider supplies no code. */
export class ResponseError extends Error {
  status?: number
  code?: string
  limits?: RateLimits
  evidence?: ResponseEvent[]
  items?: ResponseItem[]

  constructor(public kind: string, message: string) {
    super(message)
    this.name = 'ResponseError'
  }
}

let fault = (
  kind: string,
  message: string,
  fields: Omit<ResponseFault, keyof Error> = {},
): ResponseError => Object.assign(new ResponseError(kind, message), fields)

// Capacity is answered as a CODE at least as often as a status: a 200 stream
// can end in `response.failed` carrying error.code=server_is_overloaded, and a
// refusal body can name server_error with no 5xx of its own. Both are the
// backend asking us to come back, so they retry like a dropped connection.
let busy = new Set([
  'server_is_overloaded',
  'server_error',
  'overloaded',
  'overloaded_error',
  'rate_limit_exceeded',
])

// Terminal provider failures and malformed events are not network failures.
// A stall is one of them: a bus that connected and went silent said nothing
// about this request, so the next attempt is as clean as a dropped connection
// (T-37332 — two stalls ended a session that had retries left).
let transient = (error: ResponseError) =>
  error.kind == 'transport' || error.kind == 'disconnected' ||
  error.kind == 'stalled' ||
  error.kind == 'no_stream' || error.status == 429 ||
  (error.status != null && error.status >= 500 && error.status < 600) ||
  (error.code != null && busy.has(error.code))

let retryAfter = (error: ResponseError) => {
  let value = error.limits?.['retry-after']
  if (!value) return 0
  let ms = /^\d+(\.\d+)?$/.test(value)
    ? Number(value) * 1000
    : Date.parse(value) - Date.now()
  return Number.isFinite(ms) ? Math.min(60_000, Math.max(0, ms)) : 0
}

// Stop is prompt even during backoff, and never starts another HTTP attempt.
let backoff = (
  ms: number,
  signal?: AbortSignal,
  pause?: ResponseOptions['pause'],
) =>
  new Promise<void>((resolve, reject) => {
    signal?.throwIfAborted()
    let timer: ReturnType<typeof setTimeout> | undefined
    let close = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
    let abort = () => {
      close()
      reject(signal?.reason)
    }
    let done = () => {
      close()
      resolve()
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (pause) {
      Promise.resolve().then(() => pause(ms)).then(done, (error) => {
        close()
        reject(error)
      })
    } else timer = setTimeout(done, ms)
  })

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
  if (!record(clean)) {
    throw fault('malformed_stream', 'responses: expected an object')
  }
  return clean
}

/** A short machine token — a fault code, a class name, an incomplete reason. */
let codeOf = (value: unknown) =>
  typeof value == 'string' && /^[\w.:-]{1,64}$/.test(value) ? value : undefined

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
  let code = codeOf(error.code) ?? codeOf(error.type)
  let reason = typeof error.message == 'string' && error.message.trim()
    ? error.message.trim()
    : undefined
  return { code, reason }
}

let eventCode = (frame: ResponseEvent | undefined) => {
  if (!frame) return undefined
  let response = record(frame.response) ? frame.response : frame
  let error = record(response.error) ? response.error : undefined
  // A nested error names its class in `type` when `code` is null. A bare error
  // frame's own `type` is the event name ('error'), never the fault's class.
  return error
    ? codeOf(error.code) ?? codeOf(error.type)
    : codeOf(response.code)
}

let incomplete = (frame: ResponseEvent | undefined) => {
  if (frame?.type != 'response.incomplete') return undefined
  let response = record(frame.response) ? frame.response : {}
  let details = record(response.incomplete_details)
    ? response.incomplete_details
    : {}
  return codeOf(details.reason)
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

let limits = (headers: Headers): RateLimits => {
  let out: RateLimits = {}
  headers.forEach((value, name) => {
    if (limitNames.has(name.toLowerCase())) out[name.toLowerCase()] = value
  })
  return out
}

let event = (block: string) => {
  let data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
  if (!data || data == '[DONE]') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    throw fault('malformed_stream', 'responses: malformed SSE data')
  }
  if (!record(parsed) || typeof parsed.type != 'string') {
    throw fault('malformed_stream', 'responses: stream event has no type')
  }
  return parsed as ResponseEvent
}

/** Decode SSE across arbitrary byte chunks, including CRLF and a final frame
 * without a blank line. The reader is released even if a consumer throws. */
export let frames = async function* (
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ResponseEvent> {
  let reader = body.getReader()
  try {
    let decoder = new TextDecoder()
    let pending = ''
    while (true) {
      // Only a reader rejection is a transport fault. Parser defects and the
      // caller's event hook must never be mistaken for a dropped connection.
      let part: ReadableStreamReadResult<Uint8Array>
      try {
        part = await reader.read()
      } catch (error) {
        if ((error as Error)?.name == 'AbortError') throw error
        throw fault(
          'transport',
          'responses: error reading a body from connection',
        )
      }
      pending += decoder.decode(part.value, { stream: !part.done })
      let blocks = pending.split(/\r?\n\r?\n/)
      pending = blocks.pop() ?? ''
      for (let block of blocks) {
        let parsed = event(block)
        if (parsed) yield parsed
      }
      if (part.done) break
    }
    if (pending.trim()) {
      let parsed = event(pending)
      if (parsed) yield parsed
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
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
  if (!response.body) {
    throw fault('no_stream', 'responses: provider returned no stream')
  }
  // Headers arrived; reset the deadline for the wait on the first frame, then on
  // every frame the gap to the next one.
  kick?.()
  let items: ResponseItem[] = []
  let unknown: ResponseEvent[] = []
  let completed: Record<string, unknown> | undefined
  let ended: ResponseEvent | undefined
  for await (let parsed of frames(response.body)) {
    let frame = safe(parsed, secrets) as ResponseEvent
    kick?.()
    notify?.(frame)
    if (!knownEvents.has(frame.type)) unknown.push(frame)
    if (frame.type == 'response.output_item.done') {
      let item = safe(frame.item, secrets)
      if (typeof item.type != 'string') {
        throw fault('malformed_stream', 'responses: completed item has no type')
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
    throw fault(status, `responses: ${status}${reason ? ` — ${reason}` : ''}`, {
      code: eventCode(ended) ?? reason,
      // A 200 that ends in an overload still answers with the account's rate
      // headers; carry them so the backoff honors a Retry-After sent there.
      limits: limits(response.headers),
      evidence: ended ? [...unknown, ended] : unknown,
      items,
    })
  }
  if (completed.status != 'completed') {
    throw fault('failed', `responses: ${String(completed.status ?? 'failed')}`)
  }
  if (typeof completed.model != 'string') {
    throw fault(
      'malformed_stream',
      'responses: completion names no serving model',
    )
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

let credential = (value: TransportCredential, optional = false) => {
  if (!optional && !value.token?.trim()) {
    throw fault('no_credential', 'responses: no credential')
  }
  return value
}

let credentials = async (
  load: () => TransportCredential | Promise<TransportCredential>,
  message: string,
  optional = false,
  retries = 0,
  pause: (ms: number) => Promise<void> = sleep,
  hint?: string,
  redact = false,
) => {
  for (let failures = 0;; failures++) {
    try {
      return credential(await load(), optional)
    } catch (error) {
      if (failures >= retries) {
        let reason = hint ??
          (!redact && error instanceof Error ? error.message : undefined)
        throw fault(
          'no_credential',
          reason ? `${message} — ${reason}` : message,
        )
      }
      await pause(200 * 2 ** failures)
    }
  }
}

export let request = (
  value: ResponseRequest,
  store = false,
): ResponseRequest => {
  let include = Array.isArray(value.include) ? [...value.include] : []
  if (!include.includes('reasoning.encrypted_content')) {
    include.push('reasoning.encrypted_content')
  }
  return { ...value, include, store, stream: true }
}

/** The provider-native transport. `run` reads through EOF; `reach` probes
 * connectivity, not authorization. Neither keeps conversation state. */
export let transport = (options: ResponseOptions): {
  run: (value: ResponseRequest, run?: RunOptions) => Promise<ResponseResult>
  reach: () => Promise<boolean>
} => {
  let fetcher = options.fetch ?? fetch
  let base = options.base?.replace(/\/$/, '')
  let retries = Math.max(0, options.retries ?? 2)
  let patienceMs = Math.max(0, options.patienceMs ?? 0)
  let stallMs = Math.max(0, options.stallMs ?? 0)
  let pause = options.pause ?? sleep
  let id = options.id ?? (() => crypto.randomUUID())
  // Refresh replaces the credential at the HTTP edge, but completed provider
  // items from later turns may still echo something seen before the refresh.
  // Keep every credential this transport has held as a redaction term for its
  // whole lifetime; none of them leave this closure.
  let secrets: string[] = []
  let remember = (auth: TransportCredential) => {
    if (!options.redact) return
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
      CREDENTIAL_FAULT,
      options.authentication == 'optional',
      retries,
      pause,
      options.credentials.hint,
      options.redact,
    )
    remember(auth)
    let refreshed = false
    let failures = 0
    let waited = 0
    let requestId = id()
    let payload = JSON.stringify(
      options.shape?.(value) ?? request(value, options.store),
    )
    while (true) {
      run.signal?.throwIfAborted()
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
      try {
        let response: Response
        try {
          let endpoint = (base ?? auth.base ?? 'https://api.openai.com/v1')
            .replace(/\/$/, '')
          response = await fetcher(`${endpoint}/responses`, {
            method: 'POST',
            headers,
            body: payload,
            signal: dog.signal,
          })
        } catch (error) {
          if (dog.stalled()) {
            throw fault('stalled', 'responses: transport stalled')
          }
          if (run.signal?.aborted || (error as Error)?.name == 'AbortError') {
            throw error
          }
          throw fault('transport', 'responses: transport failed')
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
            undefined,
            options.redact,
          )
          remember(auth)
          refreshed = true
          continue
        }
        dog.kick()
        if (!response.ok) {
          // Once HTTP has refused the request its status wins, even if its
          // diagnostic body drops. A broken 401 body is not a retryable 200.
          let body = await response.text().catch(() => '')
          let status = response.status
          let { code, reason } = explain(body, secrets)
          throw fault(
            `http_${status}`,
            `responses: HTTP ${status}${reason ? ` — ${reason}` : ''}`,
            { status, code, limits: limits(response.headers) },
          )
        }
        return await terminal(response, secrets, run.event, dog.kick)
      } catch (error) {
        if (run.signal?.aborted) throw error
        let fail = error
        if (
          dog.stalled() &&
          !(error instanceof ResponseError && error.kind == 'stalled')
        ) {
          fail = fault('stalled', 'responses: stream stalled')
        }
        // Patience outlives the attempt count: an outage answers every attempt
        // the same way, and a caller that says how long it can wait keeps its
        // turn alive through one instead of failing in five seconds.
        if (
          run.noRetry || !(fail instanceof ResponseError) || !transient(fail) ||
          (failures >= retries && waited >= patienceMs)
        ) {
          throw fail
        }
        // Nothing from this attempt is committed. Reuse the exact body and
        // correlation id; only a complete exchange may reach the runner.
        dog.close()
        let wait = Math.max(
          Math.min(1000 * 4 ** failures++, 60_000),
          retryAfter(fail),
        )
        waited += wait
        await backoff(wait, run.signal, options.pause)
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
    let auth: TransportCredential
    try {
      auth = await credentials(
        options.credentials.get,
        CREDENTIAL_FAULT,
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
