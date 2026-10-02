import { describeFailure } from './diagnostics.ts'

/** The root disk is shared by every session. Check it without writing to the
 * graph, so an alert can still leave when the graph's disk is full. */
export let FREE_FLOOR = 10 * 1024 ** 3
export type DiskAlert = { path: string; free: number; threshold: number }

/** POSIX df's available column is in KiB, regardless of the box's locale. */
export let available = (output: string): number => {
  let row = output.trim().split('\n').at(-1)?.trim().split(/\s+/)
  let value = row?.length == 6 ? Number(row[3]) : NaN
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('df did not report available disk space')
  }
  return value * 1024
}

export let rootFree = async (): Promise<number> => {
  let { success, stdout } = await new Deno.Command('df', {
    args: ['-Pk', '/'],
    env: { LC_ALL: 'C' },
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!success) throw new Error('df could not check root disk space')
  return available(new TextDecoder().decode(stdout))
}

/** One report per low-space spell. A failed delivery remains owed, and a
 * recovered disk arms the next report. The service owns when checks run. */
export let diskMonitor = (opts: {
  free?: () => Promise<number>
  report: (alert: DiskAlert) => Promise<void>
  threshold?: number
}) => {
  let threshold = opts.threshold ?? FREE_FLOOR
  let reported = false
  return async () => {
    let free = await (opts.free ?? rootFree)()
    if (!Number.isSafeInteger(free) || free < 0) {
      throw new Error('invalid available disk space')
    }
    if (free >= threshold) reported = false
    else if (!reported) {
      await opts.report({ path: '/', free, threshold })
      reported = true
    }
  }
}

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
  exception: { values: { type: string; value: string }[] }
  fingerprint?: string[]
  tags: Record<string, string>
  extra?: Record<string, unknown>
}

/** Pure event builders keep disk state and the delivery transport separate. */
export let diskEvent = (alert: DiskAlert): SentryEvent => ({
  exception: {
    values: [{
      type: 'LowDiskSpace',
      value: `Root disk has ${(alert.free / 1024 ** 3).toFixed(2)} GiB ` +
        `free, below ${alert.threshold / 1024 ** 3} GiB`,
    }],
  },
  fingerprint: ['yak-root-disk-space'],
  tags: { phase: 'disk-space', path: alert.path },
  extra: { free_bytes: alert.free, threshold_bytes: alert.threshold },
})

export let failureEvent = (error: unknown, phase: string): SentryEvent => ({
  exception: {
    values: [{
      type: error instanceof Error ? error.name : 'Error',
      value: describeFailure(error),
    }],
  },
  tags: { phase },
})

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
