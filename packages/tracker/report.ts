// Reporting hands scrubbed bundles to a generic sink. Neither capture nor a
// failed sink can change the caller's result; fallback never calls the reporter.

import { type Actor, type Bundle, status } from '@yaks/graph'
import { comp, type Crumb, type Level } from './model.ts'

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
