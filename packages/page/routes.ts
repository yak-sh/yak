// The HTTP endpoint a recorded page needs, exported as `@yaks/page/routes`.
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
import type { Bundle, Comp, Storage } from '@yaks/graph'
import { detached } from '@yaks/graph/storage'
import { type Blobs, served } from '@yaks/blob'
import { WEB } from './comp.ts'
import { blobsOf, type Options } from './host.ts'

/** The path prefix an archived page is served under. */
export let PREFIX = '/page/'

let comp = (b: Bundle | undefined, name: string): Comp | undefined =>
  b?.[name] as Comp | undefined

let gone = () => new Response('not found', { status: 404 })

/** `GET /page/<eid>`. */
export let routes = (
  host: { storage: Storage; blobs: Blobs },
  options: Options = {},
): Route[] => {
  let blobs = blobsOf(host, options)
  // One entity by its id is a direct get, never a query: it needs no grammar,
  // no vocabulary beyond this package's own, and no index.
  let at = detached(host.storage)
  let find = async (eid: string): Promise<Bundle | undefined> =>
    (await at.get([eid]))[0]

  return [{
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
