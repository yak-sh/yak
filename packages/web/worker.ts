/**
 * A site's service worker, keeping its pages and its files so opening one
 * again draws at once (./picture.ts).
 *
 * - A page a person opens that was kept is answered with its picture at
 *   once, and the page as it is now is asked for at the same moment, for the
 *   picture's bootstrap to take (`FRESH`).
 * - A page sends its snapshot as it is left or hidden (./keep.ts), and the
 *   picture of it is kept under its address, the newest `pages` of them.
 * - A file named by its bytes (`named`, a path prefix) never changes, so it
 *   is answered from what was kept, and kept as it first passes, the newest
 *   `files` of them: a picture drawn by an earlier release still has its
 *   sheet and fonts.
 * - Visiting an address in `forget` (signing out, the sign-in page) forgets
 *   every kept page, any snapshot taken by a page loaded before it, and the
 *   databases its pages kept (`databases`).
 *
 * Every other request goes to the network as if there were no worker.
 *
 * @module
 */
import { FRESH, picture } from './picture.ts'

/** The caches this worker keeps pages and files in. */
export let PAGES = 'yak-pages'
export let FILES = 'yak-files'

/** What a site keeps: the paths whose visit forgets its pages, where its
 * files named by their bytes are, and how many of each are kept. Forgetting
 * also deletes the IndexedDB databases whose names start with `databases`:
 * what its pages kept of their own. */
export type Keeping = {
  forget: string[]
  named?: string
  pages?: number
  files?: number
  databases?: string
}

/** What a page sends its worker as it is left (./keep.ts): its address, its
 * whole document, when the snapshot was taken and when the page was loaded,
 * in milliseconds since the epoch. */
export type Snapshot = { keep: string; html: string; at: number; since: number }

/** How a request is answered: `page` from a kept picture where there is one,
 * `fresh` with the page already asked for, `file` from what was kept,
 * `forget` passed on after forgetting the kept pages, or null, untouched.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let at = (path: string, o: { mode?: RequestMode; method?: string; fresh?: boolean } = {}) =>
 *   route({
 *     url: 'https://yaks.app' + path,
 *     mode: o.mode ?? 'cors',
 *     method: o.method ?? 'GET',
 *     headers: new Headers(o.fresh ? { 'x-yak-fresh': '1' } : {}),
 *   }, 'https://yaks.app', { forget: ['/logout', '/login'], named: '/_yak/' })
 * assertEquals(at('/checks', { mode: 'navigate' }), 'page')
 * assertEquals(at('/logout', { mode: 'navigate', method: 'POST' }), 'forget')
 * assertEquals(at('/checks', { method: 'POST', mode: 'navigate' }), null)
 * assertEquals(at('/checks', { fresh: true }), 'fresh')
 * assertEquals(at('/_yak/pages.0123456789.css'), 'file')
 * assertEquals(at('/api/apply', { method: 'POST' }), null)
 * ```
 */
export let route = (
  req: Pick<Request, 'url' | 'mode' | 'method' | 'headers'>,
  origin: string,
  keeping: Keeping,
): 'page' | 'fresh' | 'file' | 'forget' | null => {
  let url = new URL(req.url)
  if (url.origin != origin) return null
  if (req.mode == 'navigate' && keeping.forget.includes(url.pathname)) {
    return 'forget'
  }
  if (req.method != 'GET') return null
  if (req.mode == 'navigate') return 'page'
  if (req.headers.has(FRESH)) return 'fresh'
  if (keeping.named && url.pathname.startsWith(keeping.named)) return 'file'
  return null
}

/** The address a page is kept under: its own, without a fragment. */
export let pageKey = (url: string): string => {
  let at = new URL(url)
  at.hash = ''
  return at.href
}

// Where the time the pages were last forgotten is kept, beside them.
let FORGOT = '/.forgot'

/** What a service worker needs of its global scope. */
export type Scope = {
  caches: CacheStorage
  fetch: typeof fetch
  location: { origin: string }
  clients: { claim(): Promise<void> }
  indexedDB?: Pick<IDBFactory, 'databases' | 'deleteDatabase'>
  addEventListener(
    type: 'fetch',
    hear: (e: FetchLike) => void,
  ): void
  addEventListener(
    type: 'activate',
    hear: (e: { waitUntil(p: Promise<unknown>): void }) => void,
  ): void
  addEventListener(
    type: 'message',
    hear: (e: { data: unknown; waitUntil(p: Promise<unknown>): void }) => void,
  ): void
}
/** A fetch event, as far as this worker reads it. */
export type FetchLike = {
  request: Request
  respondWith(r: Promise<Response>): void
  waitUntil(p: Promise<unknown>): void
}

/** Keep `scope`'s pages and files (see the module), now and as it runs. A
 * page open as the worker starts is its at once, so the page can be kept. */
export let keeping = (scope: Scope, opts: Keeping): void => {
  scope.addEventListener('activate', (e) => e.waitUntil(scope.clients.claim()))
  let { caches, location } = scope
  let most = { pages: opts.pages ?? 24, files: opts.files ?? 400 }
  // The page each kept page's picture asked for, until its bootstrap takes it.
  let asked = new Map<string, Promise<Response>>()
  let trim = async (cache: Cache, keep: number) => {
    let keys = (await cache.keys()).filter((r) => !r.url.endsWith(FORGOT))
    await Promise.all(keys.slice(0, -keep).map((r) => cache.delete(r)))
  }
  let forgotAt = async () => {
    let said = await (await caches.open(PAGES)).match(location.origin + FORGOT)
    return said ? Number(await said.text()) : 0
  }
  let forget = async () => {
    asked.clear()
    let { databases } = opts
    if (databases && scope.indexedDB) {
      for (let { name } of await scope.indexedDB.databases()) {
        if (name?.startsWith(databases)) scope.indexedDB.deleteDatabase(name)
      }
    }
    await caches.delete(PAGES)
    await (await caches.open(PAGES)).put(
      location.origin + FORGOT,
      new Response(String(Date.now())),
    )
  }
  let keep = async ({ keep: url, html, at, since }: Snapshot) => {
    if (new URL(url).origin != location.origin) return
    if (since < await forgotAt()) return
    let pages = await caches.open(PAGES)
    await pages.delete(pageKey(url))
    await pages.put(
      pageKey(url),
      new Response(picture(html, at), {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        },
      }),
    )
    await trim(pages, most.pages)
  }
  let page = async (req: Request) => {
    let kept = await (await caches.open(PAGES)).match(pageKey(req.url))
    if (!kept) return scope.fetch(req)
    let now = scope.fetch(req.url, {
      credentials: 'same-origin',
      headers: { accept: 'text/html' },
      cache: 'no-store',
    })
    // Nobody may come for it: the picture is closed before its bootstrap ran.
    now.catch(() => {})
    asked.set(pageKey(req.url), now)
    return kept
  }
  let fresh = (req: Request) => {
    let key = pageKey(req.url)
    let held = asked.get(key)
    asked.delete(key)
    return held?.catch(() => scope.fetch(req)) ?? scope.fetch(req)
  }
  let file = async (req: Request) => {
    let files = await caches.open(FILES)
    let kept = await files.match(req)
    if (kept) return kept
    let got = await scope.fetch(req)
    if (got.ok) {
      await files.put(req, got.clone())
      await trim(files, most.files)
    }
    return got
  }
  scope.addEventListener('fetch', (e) => {
    let how = route(e.request, location.origin, opts)
    if (how == 'forget') e.waitUntil(forget())
    else if (how == 'page') e.respondWith(page(e.request))
    else if (how == 'fresh') e.respondWith(fresh(e.request))
    else if (how == 'file') e.respondWith(file(e.request))
  })
  scope.addEventListener('message', (e) => {
    let said = e.data as Partial<Snapshot> | null
    if (typeof said?.keep == 'string' && typeof said.html == 'string') {
      e.waitUntil(keep(said as Snapshot))
    }
  })
}
