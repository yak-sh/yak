/** Read-through doors to the independent tracker Worker. Options are read for
 * every request so the CLI's vault-backed secret can rotate without a restart.
 * Remote bundles are never applied to the box's graph. */
import type { Route } from '@yaks/api'
import {
  late,
  type Remote,
  request as upstream,
  unavailable,
} from './remote.ts'

export type Options = { remote?: Remote }
let uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** What a read answered: its value and the tag it was read at, or that
 * nothing moved since the tag it was asked with, or the refusal and the
 * status it is: 503 where the tracker is out of reach or cannot answer for
 * now, 504 where it did not answer in time, and 502 or 404 where it refused
 * what was asked. */
export type Read =
  | { ok: true; value: unknown; tag?: string; unchanged?: false }
  | { ok: true; value?: undefined; tag: string; unchanged: true }
  | { ok: false; error: string; status: number }
let refused = (error: string, status: number): Read => ({
  ok: false,
  error,
  status,
})

/** One bounded remote read, shared by the HTTP door and graph tools. */
export let read = async (
  options: Options,
  path: 'bugs' | 'trace' | 'traces',
  query: URLSearchParams,
  signal?: AbortSignal,
  go: typeof fetch = fetch,
  /** the tag of the answer the caller holds: a remote with nothing moved
   * since answers that, reading nothing */
  tag?: string,
): Promise<Read> => {
  let remote = options.remote
  if (!remote?.url) return refused('Remote tracker is not configured', 503)
  if (!remote.secret) {
    return refused('Remote tracker secret is unavailable', 503)
  }
  let scope = query.get('scope') ?? 'platform'
  if (scope != 'platform' && !uuid.test(scope)) {
    return refused('scope must be platform or a global space eid', 400)
  }
  let n = Number(query.get('limit') ?? 100)
  if (!Number.isSafeInteger(n) || n < 1 || n > 100) {
    return refused('limit must be 1..100', 400)
  }
  let params = new URLSearchParams({ scope, limit: String(n) })
  for (
    let key of path == 'trace'
      ? ['eid', 'after']
      : path == 'bugs'
      ? ['app', 'bug']
      : ['app', 'after']
  ) {
    let value = query.get(key)
    if (path == 'bugs' && key == 'app' && value == '') value = null
    if (value != null && !uuid.test(value) || key == 'eid' && !value) {
      return refused(`${key} must be a global eid`, 400)
    }
    if (value) params.set(key, value)
  }
  for (let key of path == 'bugs' ? ['query', 'since'] : []) {
    if (query.has(key)) params.set(key, query.get(key)!)
  }
  let response: Response
  try {
    response = await upstream(
      remote,
      path,
      params,
      { signal, ...tag ? { headers: { 'if-none-match': tag } } : {} },
      go,
    )
  } catch (error) {
    // Neither a credential, ticket, configured URL nor upstream body is an error report.
    return late(error)
      ? refused('Remote tracker did not answer in time', 504)
      : refused('Remote tracker is unavailable', 503)
  }
  let etag = response.headers.get('etag') ?? undefined
  if (response.status == 304 && etag) {
    return { ok: true, tag: etag, unchanged: true }
  }
  let { status } = response
  if (!response.ok) {
    return refused(
      `Remote tracker refused the read (${status})`,
      status == 404 ? 404 : unavailable(status) ? 503 : 502,
    )
  }
  try {
    return {
      ok: true,
      value: await response.json(),
      ...etag ? { tag: etag } : {},
    }
  } catch {
    return refused('Remote tracker answered a read that is not JSON', 502)
  }
}

/** Only bug and bounded trace reads leave the box. */
export let routes = (
  _host: unknown,
  options: Options = {},
  go: typeof fetch = fetch,
): Route[] =>
  (['traces', 'trace', 'bugs'] as const).map((path) => ({
    method: 'GET',
    path: `/tracker/${path}`,
    handle: async (request) => {
      let result = await read(
        options,
        path,
        new URL(request.url).searchParams,
        request.signal,
        go,
      )
      return result.ok
        ? Response.json(result.value, {
          headers: { 'cache-control': 'no-store' },
        })
        : Response.json({ error: result.error }, { status: result.status })
    },
  }))
