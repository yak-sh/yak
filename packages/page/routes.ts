// The two HTTP endpoints a recorded page needs, exported as
// `@yaks/page/routes`.
//
// `POST /page` is how a browser reports a page it is looking at. A browser tab
// has three things no server has: the address somebody is actually standing at,
// the document as it looks after login and after scripts ran (refetch a
// paywalled page and you archive the paywall), and the moment. So one endpoint
// accepts all three at once and writes them in one transaction — which is also
// why the tab's bytes are scrubbed and stored inside this handler rather than
// left to the capture effect: a page that arrives already archived never asks
// anybody to fetch it again.
//
// `GET /page/<eid>` returns the archive. The bytes are content-addressed and
// `GET /blob/<sha>` (@yaks/blob) already serves them, but nothing there knows
// they are a document or where they came from, so this endpoint answers by the
// page: the restrictive headers, the media type, and the two headers that let a
// reader date a snapshot without querying the graph (RFC 7089 —
// `Memento-Datetime` is the moment these bytes were what the page said, and the
// `rel="original"` link is the address they were read from).
//
// The restrictive headers come from @yaks/blob's `served()`: a sandbox CSP with
// no scripts, plus nosniff. They are defence in depth — ./scrub.ts already
// removed every external reference before these bytes were stored, and it had
// to, because an archive mailed, copied or opened from a file has no header in
// front of it.

import type { Route } from '@yaks/api'
import type { Bundle, Comp, Graph, Storage } from '@yaks/graph'
import { detached } from '@yaks/graph'
import type { Driver } from '@yaks/sqlite'
import { served } from '@yaks/blob'
import { DOC, TITLE } from '@yaks/doc'
import { WEB } from './comp.ts'
import { froze } from './freeze.ts'
import { blobsOf, type Options } from './host.ts'
import { canon, fetchable, pageEid } from './url.ts'

/** The path prefix an archived page is served under. */
export let PREFIX = '/page/'

/** The JSON body `POST /page` accepts: where the browser was, what it called
 * the page, and the document it had. */
export type Filing = {
  /** the address the tab was at */
  url?: string
  /** what the tab called it */
  title?: string
  /** the document as the tab had it, after login and after scripts ran */
  html?: string
}

let comp = (b: Bundle | undefined, name: string): Comp | undefined =>
  b?.[name] as Comp | undefined

let bad = (why: string) => new Response(why, { status: 400 })
let gone = () => new Response('not found', { status: 404 })

/** `POST /page` and `GET /page/<eid>`. */
export let routes = (
  host: { graph: Graph; storage: Storage; sql: Driver },
  options: Options = {},
): Route[] => {
  let blobs = blobsOf(host, options)
  // One entity by its id is a direct get, never a query: it needs no grammar,
  // no vocabulary beyond this package's own, and no index.
  let at = detached(host.storage)
  let find = async (eid: string): Promise<Bundle | undefined> =>
    (await at.get([eid]))[0]

  return [{
    method: 'POST',
    path: '/page',
    handle: async (request) => {
      let said = await request.json().catch(() => null) as Filing | null
      if (!said || typeof said != 'object') {
        return bad('a page filing is a JSON object')
      }
      let url = canon(String(said.url ?? ''))
      if (!fetchable(url)) return bad('a http(s) url is required')
      // Find-or-create is the id itself: the entity a canonical address names
      // (./url.ts), so a second report of one page patches the first.
      let eid = pageEid(url)
      let page = await find(eid) ?? { entity: { eid } }
      let [landed] = said.html
        ? await froze(page, String(said.html), { blobs })
        : [{ entity: page.entity }]
      // The tab's own title beats the archive's — it is what the person was
      // looking at — and either one names a page only while nothing else does,
      // so a title somebody wrote by hand survives every later capture.
      let title = String(said.title ?? '').trim()
      let bundle: Bundle = {
        ...landed,
        [WEB]: { url, ...comp(landed, WEB) },
        ...(title && !comp(page, DOC) ? { [DOC]: { [TITLE]: title } } : {}),
      }
      try {
        // `frozen_at` and `bytes` are server-owned properties: this handler is
        // the server, and a client could otherwise claim an archive that does
        // not exist.
        return Response.json(
          await host.graph.apply([bundle], {
            trusted: true,
          }),
        )
      } catch (e) {
        return bad(String((e as Error)?.message ?? e))
      }
    },
  }, {
    method: 'GET',
    path: `${PREFIX}*`,
    handle: async (request) => {
      let eid = new URL(request.url).pathname.slice(PREFIX.length)
      // A page's id is a uuid; anything else never named one, so it is a miss
      // rather than a lookup, and no path can escape into the store.
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(eid)) {
        return gone()
      }
      let web = comp(await find(eid), WEB)
      if (!web?.bytes) return gone()
      let bytes = await blobs.get(String(web.bytes))
      if (!bytes) return gone()
      let out = served(bytes, { mime: 'text/html; charset=utf-8' })
      // Not immutable: this URL names the page, and a page archived again is
      // new bytes at the same URL. The immutable one is `/blob/<sha>`.
      out.headers.set('cache-control', 'no-cache')
      let at = new Date(String(web.frozen_at ?? ''))
      if (!isNaN(+at)) out.headers.set('memento-datetime', at.toUTCString())
      if (web.url) out.headers.set('link', `<${web.url}>; rel="original"`)
      return out
    },
  }]
}
