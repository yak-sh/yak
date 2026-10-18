// Reporting hands scrubbed bundles to a generic sink. Neither capture nor a
// failed sink can change the caller's result; fallback never calls the reporter.

import type { Actor, Bundle } from '@yaks/graph'
import { status } from '@yaks/graph/errors'
import { comp, type Crumb, type Level, str } from './model.ts'
import { faultOf } from './fault.ts'

export type Sink = (rows: Bundle[]) => void | Promise<void>
export type Context = {
  sink: Sink
  actor?: Actor
  eid?: string
  at?: string
  level?: Level
  fault?: string
  commit?: string
  version?: number
  environment?: 'production' | 'staging'
  tags?: Record<string, unknown>
  during?: {
    entity?: string
    kind?: string
    app?: string
    space?: string
    session?: string
    process?: string
    request?: string
  }
  mechanism?:
    | 'catch'
    | 'wrapper'
    | 'onerror'
    | 'onunhandledrejection'
    | 'console'
  breadcrumbs?: Crumb[]
  request?: Bundle
  fallback?: Sink
}

/** Runtime provenance uses the same request association on every reporting path.
 * Non-HTTP entries name their operation without inventing an HTTP request. */
export let origin = (
  script: string,
  version: string | undefined,
  entrypoint: string,
  request?: Request,
  eid: string = crypto.randomUUID(),
): Pick<Context, 'tags' | 'commit' | 'during' | 'request'> => {
  return {
    tags: { script, version: version ?? 'unknown', entrypoint },
    commit: version,
    during: { request: eid },
    request: {
      entity: { eid },
      request: {
        route: entrypoint,
        ...request ? { method: request.method, url: request.url } : {},
      },
    },
  }
}

/** Refusals are control flow, not tracked mistakes. Hosts can exclude their
 * own accepted/deferred operation before calling caught. */
export let refused = (error: unknown): boolean => {
  let e = error && typeof error == 'object' ? error : {}
  let named = 'name' in e ? e.name : ''
  let code = 'status' in e ? e.status : undefined
  return named == 'CallError' || status(error) < 500 ||
    (typeof code == 'number' && code >= 400 && code < 500)
}

/** No request query, headers, body, cookies, or console arguments leave. */
export let scrub = (rows: Bundle[]): Bundle[] =>
  rows.map((row) => {
    let out = { ...row }
    if (out.request && typeof out.request == 'object') {
      let { method, url, route, status, ms, agent } = comp(out, 'request')
      out.request = {
        method,
        url: typeof url == 'string' ? url.split(/[?#]/)[0] : url,
        route,
        status,
        ms,
        agent,
      }
    }
    if (out.error && typeof out.error == 'object') {
      let tags = comp(out, 'error').tags
      if (tags && typeof tags == 'object' && !Array.isArray(tags)) {
        let safe = Object.fromEntries(
          Object.entries(tags)
            .filter(([key]) => key != 'arguments'),
        )
        out.error = { ...comp(out, 'error'), tags: safe }
      }
    }
    return out
  })

let json = (value: object): string => {
  try {
    return (JSON.stringify(value) ?? String(value)).slice(0, 1000)
  } catch {
    return String(value)
  }
}

// The stack below this module's outermost door, where a value was reported.
// The cut is by function, never by file: a Worker bundles every module into
// one file, where import.meta.url names none of them. A door not on the stack
// leaves no frames. V8 and JavaScriptCore cut; their types do not declare it,
// and a runtime without it leaves no stack.
let cut: unknown = Reflect.get(Error, 'captureStackTrace')
let below = (): string => {
  if (typeof cut != 'function') return ''
  for (let door of [caught, report, capture, described]) {
    let at: { stack?: string } = {}
    cut.call(Error, at, door)
    let frames = (at.stack ?? '').split('\n').slice(1).join('\n')
    if (frames) return frames
  }
  return ''
}

// What an Error was wrapped around, down its `cause` chain: each link's stack
// (which opens with its name and message), else the value itself. A wrapper
// says what it was doing; the chain says why it failed.
let causes = (error: Error): string => {
  let out: string[] = []
  let seen = new Set<unknown>([error])
  for (let c = error.cause; c != null && !seen.has(c) && out.length < 5;) {
    seen.add(c)
    out.push(
      c instanceof Error ? c.stack || `${c.name}: ${c.message}` : json1(c),
    )
    c = c instanceof Error ? c.cause : undefined
  }
  return out.join('\nCaused by: ')
}

let json1 = (v: unknown): string =>
  typeof v == 'object' && v ? json(v) : String(v)

/** What a thrown value says it is. An Error says so itself. Any other object
 * (a refusal's `{error, message}`, a plain `{code, …}`) says its own name and
 * message, or its JSON, never `[object Object]`; it carries no stack, so the
 * stack is where it was reported from. A string or number is its message.
 *
 * ```ts
 * import { equal, ok } from '@yaks/testing'
 * import { described } from '@yaks/tracker/report'
 *
 * equal(described({ error: 'Refused', message: 'no' })?.type, 'Refused')
 * equal(described({ id: 7 })?.value, '{"id":7}')
 * equal(described('broken'), undefined)
 * let wrapped = new Error('could not take', { cause: new Error('refused') })
 * ok(described(wrapped)?.cause?.startsWith('Error: refused'))
 * ```
 */
export let described = (
  error: unknown,
):
  | { type: string; value: string; stack?: string; cause?: string }
  | undefined => {
  if (error instanceof Error) {
    let cause = causes(error)
    return {
      type: error.name,
      value: error.message,
      ...error.stack ? { stack: error.stack } : {},
      ...cause ? { cause } : {},
    }
  }
  if (!error || typeof error != 'object') return undefined
  let own = error as Record<string, unknown>
  let named = [own.name, own.error, own.code]
    .find((v): v is string => typeof v == 'string' && v != '')
  let stack = below()
  return {
    type: named ?? error.constructor?.name ?? 'Object',
    value: typeof own.message == 'string' ? own.message : json(error),
    ...stack ? { stack: `${named ?? 'Object'}\n${stack}` } : {},
  }
}

export let capture = (error: unknown, context: Context): Bundle[] => {
  let shown = described(error)
  let row: Bundle = {
    entity: { eid: context.eid ?? crypto.randomUUID() },
    ...context.actor ? { $actor: context.actor } : {},
    error: {
      at: context.at ?? new Date().toISOString(),
      level: context.level ?? 'error',
      ...error instanceof Error
        ? {}
        : { message: shown ? `${shown.type}: ${shown.value}` : String(error) },
      ...context.fault ? { fault: context.fault } : {},
      ...context.commit ? { commit: context.commit } : {},
      ...context.version != null ? { version: context.version } : {},
      ...context.environment ? { environment: context.environment } : {},
      ...context.tags ? { tags: context.tags } : {},
    },
    ...shown
      ? { exception: { ...shown, mechanism: context.mechanism ?? 'catch' } }
      : {},
    ...context.during ? { during: context.during } : {},
    ...context.breadcrumbs
      ? {
        breadcrumbs: { items: context.breadcrumbs.slice(-20) },
      }
      : {},
  }
  return scrub([row, ...context.request ? [context.request] : []])
}

export let report = async (error: unknown, context: Context): Promise<void> => {
  let rows: Bundle[] = []
  try {
    rows = capture(error, context)
    await context.sink(rows)
  } catch {
    try {
      await (context.fallback ?? consoleRows)(rows)
    } catch { /* no recursion */ }
  }
}
let consoleRows: Sink = (rows) => console.error(JSON.stringify(rows))
export let caught = (error: unknown, context: Context): Promise<void> => {
  try {
    return refused(error) ? Promise.resolve() : report(error, context)
  } catch {
    return Promise.resolve()
  }
}

export let queue =
  (binding: { send: (body: Bundle[]) => Promise<void> }): Sink => (rows) =>
    binding.send(rows)
export let spool =
  (append: (line: string) => void | Promise<void>): Sink => (rows) =>
    append(`${JSON.stringify(rows)}\n`)
export let post =
  (url: string, send: typeof fetch = fetch): Sink => async (rows) => {
    let response = await send(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(rows),
      keepalive: true,
    })
    if (!response.ok) throw new Error(`tracker intake: ${response.status}`)
  }

export type WindowClock = {
  now: () => number
  after: (ms: number, run: () => Promise<void>) => () => void
}
export type Coalesced = Sink & {
  flush: () => Promise<void>
  close: () => Promise<void>
}
let clock: WindowClock = {
  now: Date.now,
  after: (ms, run) => {
    let timer = setTimeout(() => void run(), ms)
    // One-shot commands need not live a minute just to forget an empty window.
    let deno = (globalThis as {
      Deno?: { unrefTimer: (timer: ReturnType<typeof setTimeout>) => void }
    }).Deno
    deno?.unrefTimer(timer)
    return () => clearTimeout(timer)
  },
}

/** First samples leave immediately. Each app/fault window keeps only its latest
 * repeat sample, whose hits count reaches every sink and downstream grouping. */
export let coalesce = (
  sink: Sink,
  options: { window?: number; clock?: WindowClock } = {},
): Coalesced => {
  let time = options.clock ?? clock
  let span = options.window ?? 60_000
  let windows = new Map<string, {
    until: number
    cancel: () => void
    rows?: Bundle[]
    hits: number
  }>()
  let pending = new Set<Promise<void>>()
  let closed = false
  let send = (rows: Bundle[]): Promise<void> => {
    let delivery = reportRows(rows, sink)
    pending.add(delivery)
    void delivery.then(() => pending.delete(delivery))
    return delivery
  }
  let finish = (key: string): Promise<void> => {
    let window = windows.get(key)
    if (!window) return Promise.resolve()
    windows.delete(key)
    window.cancel()
    if (!window.rows) return Promise.resolve()
    let [row, ...rest] = window.rows
    return send([{
      ...row,
      error: { ...comp(row, 'error'), hits: window.hits },
    }, ...rest])
  }
  let flush = async () => {
    await Promise.all([...windows.keys()].map(finish))
    await Promise.all(pending)
  }
  return Object.assign((rows: Bundle[]): Promise<void> => {
    let row = rows[0]
    if (closed || !row?.error) return send(rows)
    let key = JSON.stringify([str(comp(row, 'during').app), faultOf(row)])
    let window = windows.get(key)
    // A delayed timer must not hold the next window's first occurrence.
    if (window && time.now() >= window.until) {
      void finish(key)
      window = undefined
    }
    if (window) {
      window.rows = rows
      window.hits += Number(comp(row, 'error').hits ?? 1)
      return Promise.resolve()
    }
    windows.set(key, {
      until: time.now() + span,
      cancel: time.after(span, () => finish(key)),
      hits: 0,
    })
    return send(rows)
  }, {
    flush,
    close: () => {
      closed = true
      return flush()
    },
  })
}

let reportRows = async (rows: Bundle[], sink: Sink) => {
  try {
    await sink(rows)
  } catch {
    try {
      await consoleRows(rows)
    } catch { /* no recursion */ }
  }
}
