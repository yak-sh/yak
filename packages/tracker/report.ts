// Reporting hands scrubbed bundles to a generic sink. Neither capture nor a
// failed sink can change the caller's result; fallback never calls the reporter.

import { type Actor, type Bundle, status } from '@yaks/graph'
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

export let capture = (error: unknown, context: Context): Bundle[] => {
  let thrown = error instanceof Error
  let row: Bundle = {
    entity: { eid: context.eid ?? crypto.randomUUID() },
    ...context.actor ? { $actor: context.actor } : {},
    error: {
      at: context.at ?? new Date().toISOString(),
      level: context.level ?? 'error',
      ...!thrown ? { message: String(error) } : {},
      ...context.fault ? { fault: context.fault } : {},
      ...context.commit ? { commit: context.commit } : {},
      ...context.version != null ? { version: context.version } : {},
      ...context.environment ? { environment: context.environment } : {},
      ...context.tags ? { tags: context.tags } : {},
    },
    ...error instanceof Error
      ? {
        exception: {
          type: error.name,
          value: error.message,
          ...error.stack ? { stack: error.stack } : {},
          mechanism: context.mechanism ?? 'catch',
        },
      }
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

/** Independent deliveries start together. A refusal is a counter, never a
 * new error; console keeps the original rows visible if a sink is unavailable. */
export let fanout = (
  sinks: Record<string, Sink>,
): Sink & { failures: Record<string, number> } => {
  let failures = Object.fromEntries(Object.keys(sinks).map((name) => [name, 0]))
  return Object.assign(async (rows: Bundle[]) => {
    await Promise.all(
      Object.entries(sinks).map(async ([name, sink]) => {
        try {
          await sink(rows)
        } catch (error) {
          failures[name]++
          try {
            console.error(
              'tracker delivery failed —',
              name,
              failures[name],
              error,
              JSON.stringify(rows),
            )
          } catch { /* telemetry cannot break the caller */ }
        }
      }),
    )
  }, { failures })
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
