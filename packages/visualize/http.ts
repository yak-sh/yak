/** Portable authenticated doors. No runtime, storage adapter or entity reads. */
import { type Activity, observe } from './activity.ts'
import { capture, MAX_LIMIT as EVENTS, MAX_WAIT } from './capture.ts'
import { GROUPS, MAX_LIMIT, select, snapshot, type Supplier } from './snapshot.ts'

/** Null permits anonymous access only when this supplied policy permits it. */
export type Hosting = Supplier & {
  graph: object
  who?: (request: Request) => unknown | Promise<unknown>
  stopping?: AbortSignal
  report?: (error: unknown) => void
}
export type Route = {
  method: string
  path: string
  handle: (request: Request) => Response | Promise<Response>
}
let json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
})
let publicError = Symbol('visualize validation')
let invalid = (message: string): never => {
  throw Object.assign(new Error(message), {
    name: 'Refused', status: 400, [publicError]: true,
  })
}
let number = (url: URL, name: string, max: number, min = 1) => {
  let text = url.searchParams.get(name)
  if (text == null) return undefined
  let n = Number(text)
  if (!text.trim() || !Number.isSafeInteger(n) || n < min || n > max) {
    invalid(`${name} must be an integer between ${min} and ${max}`)
  }
  return n
}
let parameters = (url: URL, allowed: string[]) => {
  for (let key of url.searchParams.keys()) {
    // Even parameter names can contain user data. Do not echo them.
    if (!allowed.includes(key)) invalid('unknown parameter')
    if (url.searchParams.getAll(key).length > 1) invalid('repeated parameter')
  }
}

/** Authenticate before supplying metadata, building assets or taking a lease.
 * Only our fixed validation messages cross the door: arbitrary host errors,
 * including their name/message/status fields, can contain secrets. */
export let guarded = (
  host: Hosting,
  handle: Route['handle'],
): Route['handle'] => async (request) => {
  try {
    if (!host.who) return json({
      error: 'Unauthorized', message: 'visualize requires an authenticator',
    }, 401)
    await host.who(request)
    if (request.signal.aborted) return json({
      error: 'Cancelled', message: 'request cancelled',
    }, 499)
    if (host.stopping?.aborted) return json({
      error: 'Unavailable', message: 'host is closing',
    }, 503)
    return await handle(request)
  } catch (error) {
    if (request.signal.aborted) return json({
      error: 'Cancelled', message: 'request cancelled',
    }, 499)
    if (host.stopping?.aborted) return json({
      error: 'Unavailable', message: 'host is closing',
    }, 503)
    let e = error as { name?: string; status?: number; [publicError]?: boolean }
    let proposed = e?.status ?? ({ Unauthorized: 401, Denied: 403,
      Refused: 400 } as Record<string, number>)[e?.name ?? ''] ?? 500
    let status = Number.isInteger(proposed) && proposed >= 400 && proposed <= 599
      ? proposed : 500
    if (status >= 500) {
      try {
        if (host.report) host.report(error)
        else console.error('@yaks/visualize door failed', error)
      } catch { /* reporting cannot bypass the refusal */ }
    }
    let message = status == 401 ? 'authentication required'
      : status == 403 ? 'access denied'
      : status < 500 ? 'request refused' : 'visualize unavailable'
    return json({
      error: status == 401 ? 'Unauthorized' : status == 403 ? 'Denied'
        : status < 500 ? 'Refused' : 'Unavailable',
      message: e?.[publicError] && error instanceof Error ? error.message : message,
    }, status)
  }
}

type Frame = { type: string; data: unknown; id?: string }
let encoder = new TextEncoder()
let encoded = (frame: Frame) => encoder.encode(
  `${frame.id ? `id: ${frame.id}\n` : ''}event: ${frame.type}\n` +
    `data: ${JSON.stringify(frame.data)}\n\n`,
)
let cursor = (text: string | null) => {
  if (text == null) return undefined
  let at = text.lastIndexOf(':')
  let epoch = text.slice(0, at)
  let raw = text.slice(at + 1)
  let seq = Number(raw)
  if (at < 1 || epoch.length > 128 || /[\r\n]/.test(epoch) ||
    !/^\d+$/.test(raw) || !Number.isSafeInteger(seq)) {
    invalid('invalid Last-Event-ID')
  }
  return { epoch, seq }
}

/** Per-reader bounded queue. Only dropped observation records count as lost. */
let stream = (host: Hosting, request: Request): Response => {
  let url = new URL(request.url)
  parameters(url, ['tail'])
  if (url.searchParams.has('tail') && url.searchParams.get('tail') != '1') {
    invalid('tail must be 1')
  }
  let last = cursor(request.headers.get('last-event-id'))
  let observation = observe(host.graph)
  let history = observation.history()
  let first = history[0]?.seq ?? null
  let latest = history.at(-1)?.seq ?? null
  let omitted = 0
  let reason = ''
  if (last && last.epoch != observation.epoch) reason = 'epoch'
  if (last?.epoch == observation.epoch) {
    if (last.seq > (latest ?? 0)) {
      observation.close()
      invalid('Last-Event-ID is ahead of this recording')
    }
    omitted = Math.max(0, (first ?? last.seq + 1) - last.seq - 1)
    if (omitted) reason = 'overflow'
    history = history.filter((e) => e.seq > last.seq)
  }
  // tail suppresses the initial replay, not a native EventSource reconnect
  // carrying a valid cursor in this same recording.
  if (url.searchParams.has('tail') && last?.epoch != observation.epoch) {
    history = []
  }
  let pending: Activity[] = []
  let lost = 0
  let closed = false
  let off = () => {}
  let timer: ReturnType<typeof setInterval> | undefined
  let controller: ReadableStreamDefaultController<Uint8Array>
  let cleanup = () => {
    if (closed) return
    closed = true
    clearInterval(timer)
    off()
    observation.close()
    pending = []
    request.signal.removeEventListener('abort', end)
    host.stopping?.removeEventListener('abort', end)
  }
  let end = () => {
    if (closed) return
    cleanup()
    controller.close()
  }
  let drain = () => {
    if (closed) return
    if (lost && (controller.desiredSize ?? 0) > 0) {
      controller.enqueue(encoded({
        type: 'gap', data: { reason: 'overflow', omitted: lost },
      }))
      lost = 0
    }
    while (pending.length && (controller.desiredSize ?? 0) > 0) {
      let event = pending.shift()!
      controller.enqueue(encoded({
        type: 'activity', data: event, id: `${event.epoch}:${event.seq}`,
      }))
    }
  }
  let activity = (event: Activity) => {
    if (closed) return
    if (pending.length >= EVENTS) { pending.shift(); lost++ }
    pending.push(event)
    drain()
  }
  let body = new ReadableStream<Uint8Array>({
    start: (sink) => {
      controller = sink
      // The hello cannot be dropped by observation overflow.
      controller.enqueue(encoded({ type: 'hello', data: {
        epoch: observation.epoch, first, last: latest, omitted,
        reason: reason || undefined, coverage: 'process-local', capacity: EVENTS,
      } }))
      off = observation.subscribe(activity)
      for (let event of history) activity(event)
      timer = setInterval(() => {
        if (!pending.length && (controller.desiredSize ?? 0) > 0) {
          controller.enqueue(encoder.encode(': keepalive\n\n'))
        }
      }, 15000)
      request.signal.addEventListener('abort', end, { once: true })
      host.stopping?.addEventListener('abort', end, { once: true })
      if (request.signal.aborted || host.stopping?.aborted) end()
    },
    pull: drain,
    cancel: cleanup,
  }, { highWaterMark: 8 })
  return new Response(body, { headers: {
    'content-type': 'text/event-stream', 'cache-control': 'no-store',
    'x-accel-buffering': 'no',
  } })
}

/** Direct adapter entry is authenticated too, not just the routes facade. */
export let events = (host: Hosting, request: Request) =>
  guarded(host, (request) => stream(host, request))(request)

export let http = (host: Hosting): Route[] => [
  {
    method: 'GET', path: '/visualize/anatomy',
    handle: guarded(host, (request) => {
      let url = new URL(request.url)
      parameters(url, ['group', 'search', 'id', 'limit'])
      let group = url.searchParams.get('group') ?? undefined
      if (group != undefined && !GROUPS.some((g) => g == group)) {
        invalid('unknown group')
      }
      let limit = number(url, 'limit', MAX_LIMIT)
      let source = snapshot(host)
      return json(url.searchParams.size ? select(source, {
        group, search: url.searchParams.get('search') ?? undefined,
        id: url.searchParams.get('id') ?? undefined, limit,
      }) : source)
    }),
  },
  {
    method: 'GET', path: '/visualize/activity',
    handle: guarded(host, async (request) => {
      let url = new URL(request.url)
      parameters(url, ['limit', 'wait'])
      return json(await capture(host.graph, {
        limit: number(url, 'limit', EVENTS),
        wait: number(url, 'wait', MAX_WAIT, 0), signal: request.signal,
      }))
    }),
  },
  { method: 'GET', path: '/visualize/events',
    handle: (request) => events(host, request) },
]
