// The `yak/client` routes facet: the store client an app's pages import
// (./client.js), at `./api/client.js` beside the doors it wraps, for a host
// that builds it where it serves it, and those of its doors whose wire is
// not the store's (./page-wire.ts): `query`, `apply` and `vocab.json`, each
// asked again of the store's own door in the store's wire. The doors whose
// wire is the store's (`ws`, `who`, `vocab`) are the store's own under `/api`
// (@yaks/api `under`).
//
// The client is bundled once, as the host warms, so the first page load
// finds it made. yaks.app serves the same module from its built assets
// (workers/yak assets.ts) and answers the doors itself, with a space's
// members, an app's access and its meter (workers/yak apps.ts `api`), in the
// same wire, so its Worker lists no `yak/client`.
import type { Handler, Route } from '@yaks/api/routed'
import { bundle, kept } from '@yaks/cli/page'
import { BINARY } from '@yaks/vocab/wire'
import { batched, lineOf, receipt } from './page-wire.ts'

/** Where a page finds its client: beside its store's doors, which a host
 * serving this facet answers under `/api` (@yaks/api `under`). */
export let CLIENT = '/api/client.js'

// A bulk load or a binary batch is the store's own wire already.
let storeWire = (req: Request) => {
  let type = req.headers.get('content-type') ?? ''
  return type.includes('ndjson') || type.split(';')[0].trim() == BINARY
}

export let routes = (host: {
  early?: (make: () => Promise<unknown>) => void
  stopping?: AbortSignal
  /** the host's own doors, asked once a request arrives: the host is
   * composed before its handler is */
  handler?: Handler
}): Route[] => {
  // `req` asked again of the store's door at `path`, as `init` says.
  let onto = (req: Request, path: string, init: RequestInit = req) =>
    Promise.resolve(host.handler!(new Request(new URL(path, req.url), init)))
  return [{
    method: 'GET',
    path: CLIENT,
    handle: kept(
      CLIENT,
      'text/javascript; charset=utf-8',
      (signal) => bundle(new URL('./client.js', import.meta.url), signal),
      { early: host.early, closing: host.stopping },
    ),
  }, {
    method: 'GET',
    path: '/api/query',
    handle: (req) => {
      let url = new URL(req.url)
      let to = new URLSearchParams()
      let line = lineOf(url)
      if (line != null) to.set('q', line)
      if (url.searchParams.get('live') == '1') to.set('live', '1')
      return onto(req, `/query?${to}`)
    },
  }, {
    method: 'POST',
    path: '/api/apply',
    handle: async (req) => {
      let to = `/apply${new URL(req.url).search}`
      if (storeWire(req)) return onto(req, to)
      let sent: unknown = JSON.parse(await req.text())
      let headers = new Headers(req.headers)
      headers.set('content-type', 'application/json')
      let answer = await onto(req, to, {
        method: 'POST',
        headers,
        body: JSON.stringify(batched(sent)),
      })
      if (answer.status != 200) return answer
      return Response.json(receipt(sent, await answer.json()))
    },
  }, {
    method: 'GET',
    path: '/api/vocab.json',
    handle: async (req) => {
      let answer = await onto(req, '/vocab')
      if (answer.status != 200) return answer
      return Response.json((await answer.json()).docs)
    },
  }]
}
