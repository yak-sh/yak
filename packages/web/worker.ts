/**
 * A site's service worker, keeping its pages and its files so opening one
 * again draws at once (./picture.ts).
 *
 * - A page a person opens that was kept is answered with its picture at
 *   once, and the page as it is now is asked for at the same moment, for the
 *   picture's bootstrap to take (`FRESH`).
 * - A page opened with no picture of its own, at an address the site's
 *   shell stands for (`shelled`), is answered with the shell the same way:
 *   the newest one a page sent as it was left.
 * - A page sends its snapshot as it is left or hidden (./keep.ts), and the
 *   picture of it is kept under its address, the newest `pages` of them.
 * - A file named by its bytes (`named`, a path prefix) never changes, so it
 *   is answered from what was kept, and kept as it first passes; the newest
 *   `files` of them stay, counted as a page is left rather than on each
 *   file's way to a page that is loading: a picture drawn by an earlier
 *   release still has its sheet and fonts.
 * - A push naming the page its notification opens (`opens`) keeps a picture
 *   of that page as it is when the push arrives, so opening it from the
 *   notification, or offline, draws what the push was about at once.
 * - Visiting an address in `forget` (signing out, the sign-in page) forgets
 *   every kept page, any snapshot taken by a page loaded before it, and the
 *   databases its pages kept (`databases`).
 *
 * - A picture that cannot be replaced by its page sends its address
 *   (`NETWORK`) before it loads again, and that next open of it comes from
 *   the network; one the worker cannot draw does too.
 * - A page the network cannot give (`failed`) is answered with the site's
 *   page saying so: the browser offline, the site unreachable, no answer
 *   within `wait`, or an error page the site did not draw (`drew`).
 *
 * Every other request goes to the network as if there were no worker.
 *
 * @module
 */
import { FRESH, FRESH_URL, FRESH_WAIT, NETWORK, picture } from './picture.ts'
import { keptReports } from './kept-reports.ts'
import type { Failure } from './opening.ts'

/** The caches this worker keeps pages and files in. */
export let PAGES = 'yak-pages'
export let FILES = 'yak-files'

/** What a site keeps: the paths whose visit forgets its pages, where its
 * files named by their bytes are, and how many of each are kept. Forgetting
 * also deletes the IndexedDB databases whose names start with `databases`:
 * what its pages kept of their own. `opens` reads the page a push's
 * notification opens from what was pushed. `shelled` says whether the
 * site's shell stands for a page at an address. `broke` is the door a
 * picture reports at when it falls back to the network
 * (@yaks/tracker/report), and `pictures: false` draws none. `failed` is the
 * page that says why an open could not be had (./opening.ts `failurePage`),
 * and `drew` whether an error page the server answered is the site's own,
 * which says so itself. */
export type Keeping = {
  forget: string[]
  named?: string
  pages?: number
  files?: number
  databases?: string
  opens?: (pushed: unknown) => string | undefined
  shelled?: (url: string) => boolean
  opening?: (source: 'picture' | 'shell' | 'push') => string
  address?: (url: string) => string
  report?: string
  broke?: string
  pictures?: boolean
  failed?: (why: Failure) => string
  drew?: (html: string) => boolean
  wait?: number
}

/** What a page sends its worker as it is left (./keep.ts): its address, its
 * whole document, its shell where it has one, when the snapshot was taken
 * and when the page was loaded, in milliseconds since the epoch. */
export type Snapshot = {
  keep: string
  html: string
  shell?: string
  at: number
  since: number
}

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

// Where the time the pages were last forgotten is kept, beside them, and
// the shell.
export let FORGOT = '/.forgot'
let SHELL = '/.shell'

/** What a service worker needs of its global scope. */
export type Scope = {
  caches: CacheStorage
  fetch: typeof fetch
  location: { origin: string }
  clients: {
    claim(): Promise<void>
    matchAll?(
      o: { type: 'window' },
    ): Promise<{ url: string; navigate?(url: string): Promise<unknown> }[]>
  }
  indexedDB?: Pick<IDBFactory, 'databases' | 'deleteDatabase'>
  navigator?: { onLine: boolean }
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
    hear: (
      e: {
        data: unknown
        ports?: readonly Pick<MessagePort, 'postMessage'>[]
        waitUntil(p: Promise<unknown>): void
      },
    ) => void,
  ): void
  addEventListener(
    type: 'push',
    hear: (e: PushLike) => void,
  ): void
}
/** A fetch event, as far as this worker reads it. */
export type FetchLike = {
  request: Request
  respondWith(r: Promise<Response>): void
  waitUntil(p: Promise<unknown>): void
}

/** A push event, as far as this worker reads it. */
export type PushLike = {
  data: { json(): unknown } | null
  waitUntil(p: Promise<unknown>): void
}

// How long a push waits for the page it opens: a browser gives its handler
// about half a minute.
let PUSHED = 10_000

// How long an open waits on the network before saying it failed.
let OPENED = 8_000

/** Keep `scope`'s pages and files (see the module), now and as it runs. A
 * page open as the worker starts is its at once, so the page can be kept. */
export let keeping = (scope: Scope, opts: Keeping): void => {
  let { caches, location } = scope
  // Pictures off: every page goes to the network, and what was kept is
  // dropped as this worker takes over. Windows open while pictures were on
  // load again from the network once, since one may be a picture stuck.
  let pictures = opts.pictures ?? true
  let unpicture = async () => {
    if (!await caches.delete(PAGES)) return
    let open = await scope.clients.matchAll?.({ type: 'window' }) ?? []
    await Promise.all(open.map((w) => w.navigate?.(w.url).catch(() => {})))
  }
  scope.addEventListener('activate', (e) =>
    e.waitUntil(
      scope.clients.claim().then(() => pictures ? undefined : unpicture()),
    ))
  let address = opts.address ?? ((url: string) => url)
  let keyOf = (url: string) => pageKey(address(url))
  let most = { pages: opts.pages ?? 24, files: opts.files ?? 400 }
  // The page each kept page's picture asked for, until its bootstrap takes it.
  let asked = new Map<string, Promise<Response>>()
  // The pages whose next open comes from the network: their picture failed.
  let unpictured = new Set<string>()
  let own = [FORGOT, SHELL].map((path) => location.origin + path)
  let trim = async (cache: Cache, keep: number) => {
    let keys = (await cache.keys()).filter((r) => !own.includes(r.url))
    await Promise.all(keys.slice(0, -keep).map((r) => cache.delete(r)))
  }
  let forgotAt = async () => {
    let said = await (await caches.open(PAGES)).match(location.origin + FORGOT)
    return said ? Number(await said.text()) : 0
  }
  let reports = opts.report && keptReports(scope, opts.report, forgotAt)
  // What the worker itself could not do, told at the site's door.
  let tell = (e: unknown) => {
    if (!opts.broke) return
    let error = e instanceof Error ? e : Error(String(e))
    scope.fetch(location.origin + opts.broke, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: 'The worker could not draw a kept page: ' + error.message,
        stack: `${error.stack ?? ''}\n${location.origin}/worker.js`,
        page: location.origin + '/worker.js',
        mechanism: 'catch',
      }),
    }).catch(() => {})
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
    if (reports) await reports.forget()
  }
  let stored = (html: string) =>
    new Response(html, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  let keep = async (
    { keep: url, html, shell, at, since }: Snapshot,
    source: 'picture' | 'push' = 'picture',
  ) => {
    if (!pictures) return
    if (new URL(url).origin != location.origin) return
    if (since < await forgotAt()) return
    let pages = await caches.open(PAGES)
    await pages.delete(pageKey(url))
    await pages.put(
      pageKey(url),
      stored(
        picture(html, at, {
          opening: opts.opening?.(source),
          door: opts.broke,
        }),
      ),
    )
    if (shell && opts.shelled?.(url)) {
      await pages.put(
        location.origin + SHELL,
        stored(
          picture(shell, at, {
            opening: opts.opening?.('shell'),
            door: opts.broke,
            shell: true,
          }),
        ),
      )
    }
    await trim(pages, most.pages)
    await trim(await caches.open(FILES), most.files)
  }
  let timed = async (got: Promise<Response>, began: number) => {
    let res = await got
    if (!opts.opening || res.type == 'opaque' || res.type == 'opaqueredirect') {
      return res
    }
    let headers = new Headers(res.headers)
    headers.set(FRESH_WAIT, String(performance.now() - began))
    if (res.url) headers.set(FRESH_URL, res.url)
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    })
  }
  // A page's own picture, else the shell where it stands for the page: never
  // in a frame, whose page is another's.
  let kept = async (req: Request, key: string) => {
    if (!pictures) return undefined
    let pages = await caches.open(PAGES)
    let shell = (req.destination || 'document') == 'document' &&
      opts.shelled?.(key)
    return await pages.match(key) ??
      (shell ? await pages.match(location.origin + SHELL) : undefined)
  }
  // The page from the network, or the site's page saying why it isn't.
  let reached = async (req: Request) => {
    let { failed } = opts
    if (!failed) return scope.fetch(req)
    let said = (why: Failure) =>
      new Response(failed(why), {
        status: 503,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        },
      })
    let wait = opts.wait ?? OPENED
    let timer: ReturnType<typeof setTimeout> | undefined
    let late = new Promise<null>((done) => timer = setTimeout(done, wait, null))
    let got: Response | null
    try {
      got = await Promise.race([scope.fetch(req), late])
    } catch (e) {
      return said({
        state: scope.navigator?.onLine == false ? 'offline' : 'unreachable',
        said: String(e),
      })
    } finally {
      clearTimeout(timer)
    }
    if (!got) {
      return said({ state: 'failed', said: `No answer in ${wait / 1000} s` })
    }
    if (got.status < 500 || opts.drew?.(await got.clone().text())) return got
    return said({ state: 'failed', said: `The server answered ${got.status}` })
  }
  let page = async (req: Request) => {
    let key = keyOf(req.url)
    if (unpictured.delete(key)) return reached(req)
    let drawn = await kept(req, key).catch((e) => {
      tell(e)
      return undefined
    })
    if (!drawn) return reached(req)
    let now = timed(
      scope.fetch(key, {
        credentials: 'same-origin',
        headers: { accept: 'text/html' },
        cache: 'no-store',
      }),
      performance.now(),
    )
    // Nobody may come for it: the picture is closed before its bootstrap ran.
    now.catch(() => {})
    asked.set(key, now)
    return drawn
  }
  // The page at `url` as it is now, kept as if it had just been left. One
  // that sends elsewhere (signed out) or fails is not kept.
  let refresh = async (url: string) => {
    let key = keyOf(new URL(url, location.origin).href)
    if (new URL(key).origin != location.origin) return
    let since = Date.now()
    let now = await scope.fetch(key, {
      credentials: 'same-origin',
      headers: { accept: 'text/html' },
      cache: 'no-store',
      signal: AbortSignal.timeout(PUSHED),
    })
    let html = (now.headers.get('content-type') ?? '').includes('text/html')
    if (!now.ok || !html || (now.url && pageKey(now.url) != key)) return
    await keep({ keep: key, html: await now.text(), at: since, since }, 'push')
  }
  let fresh = (req: Request) => {
    let key = keyOf(req.url)
    let held = asked.get(key)
    asked.delete(key)
    let fetch = () => timed(scope.fetch(req), performance.now())
    return held?.catch(fetch) ?? fetch()
  }
  let file = async (req: Request) => {
    let files = await caches.open(FILES)
    let kept = await files.match(req)
    if (kept) return kept
    let got = await scope.fetch(req)
    if (got.ok) await files.put(req, got.clone())
    return got
  }
  scope.addEventListener('fetch', (e) => {
    if (
      reports && e.request.method == 'POST' &&
      e.request.url == location.origin + opts.report
    ) return e.respondWith(reports.send(e.request))
    let how = route(e.request, location.origin, opts)
    if (how == 'forget') e.waitUntil(forget())
    else if (how == 'page') e.respondWith(page(e.request))
    else if (how == 'fresh') e.respondWith(fresh(e.request))
    else if (how == 'file') e.respondWith(file(e.request))
  })
  // Beside showing the notification, never before it: what was pushed is
  // read again here, and a page that cannot be had leaves the last picture.
  scope.addEventListener('push', (e) => {
    let pushed: unknown
    try {
      pushed = e.data?.json()
    } catch {
      return
    }
    let url = opts.opens?.(pushed)
    if (url) e.waitUntil(refresh(url))
  })
  scope.addEventListener('message', (e) => {
    let said = e.data as Partial<Snapshot> | null
    let failed = (e.data as { [NETWORK]?: unknown } | null)?.[NETWORK]
    if (typeof failed == 'string') {
      unpictured.add(keyOf(failed))
      asked.delete(keyOf(failed))
      return e.ports?.[0]?.postMessage(true)
    }
    if (
      typeof said?.keep == 'string' && typeof said.html == 'string' &&
      (said.shell == null || typeof said.shell == 'string')
    ) {
      e.waitUntil(keep(said as Snapshot))
    }
  })
}
