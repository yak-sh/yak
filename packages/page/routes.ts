// The two doors a witnessed page needs: the `routes` facet a host takes
// (`@yaks/page/routes`).
//
// `POST /page` is THE WITNESS. A browser tab carries three things no server
// has: the address somebody is actually standing at, the document after a
// login and its scripts (refetch a paywalled page and you archive the
// paywall), and the moment. So one door takes all three at once and lands
// them in one batch — which is also why the tab's bytes are scrubbed and
// stored INSIDE the request rather than left to the capture effect: a page
// that arrives already frozen never asks anybody to fetch it again.
//
// `GET /page/<eid>` is the archive, read back. The bytes are content-
// addressed and `GET /blob/<sha>` (@yaks/blob) already answers for them, but
// nothing there knows they are a document or where they came from, so this
// door answers by the PAGE: its own fence, its media type, and the two
// headers that let a reader date a snapshot without asking the graph
// (RFC 7089 — `Memento-Datetime` is the moment these bytes were what the page
// said, and the `rel="original"` link is the address they were said at).
//
// The fence is @yaks/blob's `served`: a sandbox CSP with no scripts, and
// nosniff. It is defence in DEPTH — ./scrub.ts already removed every external
// reference before these bytes were stored, and it had to, because an archive
// mailed, copied or opened from a file has no header in front of it.

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

/** Where a frozen page answers from. */
export let PREFIX = '/page/'

/** What a witness says: where it was, what it was called, what it saw. */
export type Filing = {
  /** the address the tab was standing at */
  url?: string
  /** what the tab called it */
  title?: string
  /** the document as the tab had it, after login and scripts */
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
  // One entity by its id is a GET, never a query: it needs no grammar, no
  // vocabulary beyond this package's own, and no index.
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
      // Find-or-mint is the id itself: the entity a canonical address names
      // (./url.ts), so a second witness of one page patches the first.
      let eid = pageEid(url)
      let page = await find(eid) ?? { entity: { eid } }
      let [landed] = said.html
        ? await froze(page, String(said.html), { blobs })
        : [{ entity: page.entity }]
      // The tab's own title beats the archive's — it is what the person was
      // looking at — and either one names a page only while nothing else
      // does, so a title somebody wrote by hand survives every later visit.
      let title = String(said.title ?? '').trim()
      let bundle: Bundle = {
        ...landed,
        [WEB]: { url, ...comp(landed, WEB) },
        ...(title && !comp(page, DOC) ? { [DOC]: { [TITLE]: title } } : {}),
      }
      try {
        // `frozen_at` and `bytes` are server-owned: this door IS the server,
        // and a client could otherwise claim an archive nobody holds.
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
      // Not immutable: this address is the PAGE, and a page frozen again is
      // new bytes at the same one. The immutable door is `/blob/<sha>`.
      out.headers.set('cache-control', 'no-cache')
      let at = new Date(String(web.frozen_at ?? ''))
      if (!isNaN(+at)) out.headers.set('memento-datetime', at.toUTCString())
      if (web.url) out.headers.set('link', `<${web.url}>; rel="original"`)
      return out
    },
  }]
}
