// The box Sentry transport, shared by caught host failures and disk alerts.

import { comp, str } from './model.ts'
import { faultOf } from './fault.ts'
import { stackFrames } from './frames.ts'
import type { Sink } from './report.ts'

type Target = {
  api: string
  org: string
  project: string
  environment: string
}
type Key = {
  projectId: string | number
  isActive: boolean
  dsn?: { public?: string }
}
type Project = { id: string; slug: string }

export type SentryEvent = {
  exception: {
    values: {
      type: string
      value: string
      stacktrace?: {
        frames: {
          filename: string
          lineno?: number
          colno?: number
          function?: string
        }[]
      }
    }[]
  }
  fingerprint?: string[]
  tags: Record<string, unknown>
  extra?: Record<string, unknown>
}

/** The same captured sample, fault and occurrence count as the durable spool. */
export let sentry =
  (send: (event: SentryEvent) => Promise<void>): Sink => async (rows) => {
    let row = rows[0]
    if (!row?.error) return
    let error = comp(row, 'error')
    let exception = comp(row, 'exception')
    let frames = stackFrames(str(exception.stack)).reverse().map((frame) => ({
      filename: frame.file,
      lineno: frame.line,
      colno: frame.column,
      function: frame.function,
    }))
    await send({
      exception: {
        values: [{
          type: str(exception.type) || 'Error',
          value: str(exception.value ?? error.message),
          ...frames.length ? { stacktrace: { frames } } : {},
        }],
      },
      fingerprint: [str(comp(row, 'during').app), faultOf(row)],
      tags: {
        ...error.tags as Record<string, unknown>,
        ...comp(row, 'during'),
      },
      extra: {
        commit: error.commit,
        actor: row.$actor,
        hits: error.hits ?? 1,
        at: error.at,
        stack: exception.stack,
      },
    })
  }

/** Send to the same Sentry project admin errors reads. Both discovery doors
 * accept its existing org:read token; the token never reaches ingest.
 * APIs: https://docs.sentry.io/api/organizations/list-an-organizations-projects/
 * https://docs.sentry.io/api/organizations/list-an-organizations-client-keys/ */
export let sentryReporter = (opts: {
  target?: Target
  token: () => Promise<string | undefined>
  dsn?: () => Promise<string | undefined>
  fetch?: typeof globalThis.fetch
}) => {
  let target = opts.target ?? {
    api: 'https://us.sentry.io/api/0',
    org: 'yaks',
    project: 'yaks-app',
    environment: 'production',
  }
  let fetch = opts.fetch ?? globalThis.fetch
  let dsn: string | undefined
  let request = async (url: string, init?: RequestInit) => {
    let response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`Sentry report request answered ${response.status}`)
    }
    return response
  }
  let find = async <T>(
    url: string,
    token: string,
    matches: (row: T) => boolean,
  ): Promise<T | undefined> => {
    let seen = new Set<string>()
    for (;;) {
      let response = await request(url, {
        headers: { authorization: `Bearer ${token}` },
      })
      let rows: T[] = await response.json()
      let found = rows.find(matches)
      if (found) return found
      let cursor = /rel="next"; results="true"; cursor="([^"]+)"/.exec(
        response.headers.get('link') ?? '',
      )?.[1]
      if (!cursor) return
      if (seen.has(cursor)) throw new Error('Sentry repeated a discovery page')
      seen.add(cursor)
      let next = new URL(url)
      next.searchParams.set('cursor', cursor)
      url = String(next)
    }
  }
  let resolve = async () => {
    if (dsn) return dsn
    let configured = await opts.dsn?.()
    if (configured) return dsn = configured
    let token = await opts.token()
    if (!token) throw new Error('No Sentry credential for the report')
    let { api, org, project } = target
    let base = `${api}/organizations/${org}`
    let found = await find<Project>(
      `${base}/projects/?query=${encodeURIComponent(project)}`,
      token,
      (row) => row.slug == project,
    )
    if (!found) throw new Error('Sentry reporting project was not found')
    let key = await find<Key>(
      `${base}/project-keys/?status=active`,
      token,
      (key) =>
        String(key.projectId) == found.id && key.isActive &&
        Boolean(key.dsn?.public),
    )
    if (!key?.dsn?.public) {
      throw new Error('Sentry project has no active ingest key')
    }
    return dsn = key.dsn.public
  }
  return async (event: SentryEvent): Promise<void> => {
    let uri = new URL(await resolve())
    let project = uri.pathname.split('/').pop()
    let base = uri.pathname.slice(0, uri.pathname.lastIndexOf('/'))
    let url = `${uri.protocol}//${uri.host}${base}/api/${project}/store/`
    let response = await request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${uri.username}`,
      },
      body: JSON.stringify({
        ...event,
        event_id: crypto.randomUUID().replaceAll('-', ''),
        timestamp: new Date().toISOString(),
        platform: 'other',
        level: 'error',
        environment: target.environment,
        server_name: Deno.hostname(),
        tags: { ...event.tags, service: 'yak' },
        ...(event.fingerprint
          ? { fingerprint: [...event.fingerprint, Deno.hostname()] }
          : {}),
      }),
    })
    await response.body?.cancel()
  }
}
