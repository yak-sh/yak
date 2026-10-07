/** Read-through doors to the independent tracker Worker. Options are read for
 * every request so the CLI's vault-backed secret can rotate without a restart.
 * Remote bundles are never applied to the box's graph. */
import type { Route } from '@yaks/api'
import { derivedEid } from '@yaks/graph'
import { sign } from './ticket.ts'

export type Options = { remote?: { url?: string; secret?: string } }
let uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
let platform = derivedEid('tracker|platform')

/** Only the two bounded trace read endpoints leave the box. */
export let routes = (
  _host: unknown,
  options: Options = {},
  go: typeof fetch = fetch,
): Route[] =>
  ['traces', 'trace'].map((path) => ({
    method: 'GET',
    path: `/tracker/${path}`,
    handle: async (request) => {
      let remote = options.remote
      if (!remote?.url) {
        return Response.json({ error: 'Remote tracker is not configured' }, {
          status: 503,
        })
      }
      if (!remote.secret) {
        return Response.json(
          { error: 'Remote tracker secret is unavailable' },
          { status: 503 },
        )
      }
      let query = new URL(request.url).searchParams
      let scope = query.get('scope') ?? 'platform'
      if (scope != 'platform' && !uuid.test(scope)) {
        return Response.json({
          error: 'scope must be platform or a global space eid',
        }, { status: 400 })
      }
      let n = Number(query.get('limit') ?? 100)
      if (!Number.isSafeInteger(n) || n < 1 || n > 100) {
        return Response.json({ error: 'limit must be 1..100' }, { status: 400 })
      }
      let params = new URLSearchParams({ scope, limit: String(n) })
      for (let key of path == 'trace' ? ['eid', 'after'] : ['app', 'after']) {
        let value = query.get(key)
        if (value != null && !uuid.test(value) || key == 'eid' && !value) {
          return Response.json({ error: `${key} must be a global eid` }, {
            status: 400,
          })
        }
        if (value) params.set(key, value)
      }
      try {
        let url = new URL(remote.url)
        if (
          url.username || url.password ||
          !['http:', 'https:'].includes(url.protocol)
        ) throw Error()
        // HTTP is useful only for the isolated local Worker proof.
        if (
          url.protocol == 'http:' &&
          !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
        ) throw Error()
        url.pathname = `${url.pathname.replace(/\/$/, '')}/${path}`
        url.search = params.toString()
        url.hash = ''
        let ticket = await sign({
          scope: scope == 'platform' ? platform : scope,
          person: 'box-tracker',
          admin: true,
          exp: Math.floor(Date.now() / 1000) + 60,
        }, remote.secret)
        let response = await go(url, {
          headers: { authorization: `Bearer ${ticket}` },
          redirect: 'error',
          signal: AbortSignal.any([
            request.signal,
            AbortSignal.timeout(15_000),
          ]),
        })
        if (!response.ok) {
          return Response.json({
            error: `Remote tracker refused the read (${response.status})`,
          }, { status: response.status == 404 ? 404 : 502 })
        }
        return Response.json(await response.json(), {
          headers: { 'cache-control': 'no-store' },
        })
      } catch {
        // Neither a credential, ticket, configured URL nor upstream body is an error report.
        return Response.json({ error: 'Remote tracker is unavailable' }, {
          status: 502,
        })
      }
    },
  }))
