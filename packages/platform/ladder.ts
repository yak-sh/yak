/**
 * `@yaks/platform/ladder` — what an address under a space answers, decided
 * rung by rung (D-34197), the first rung that answers winning. Its host does
 * the reading: the directory's view of the address, the moves a rename left
 * behind, a cache that already keeps the page. The ladder only says which
 * answer that reading makes, and the host makes it.
 *
 * For a request to `<space>.yaks.app<path>`, which is also every request a
 * custom domain carries, whether it names the space or one app mounted at its
 * root (workers/yak index.ts `aimed`):
 *
 *  1. Platform paths are the kernel's and no app routes them: `/.well-known/`
 *     on a hostname of ours (./routes.ts `platform`, decided before this), an
 *     app's `/<app>/api/…` store doors, and the directory's own space, which
 *     nothing is served at to anyone.
 *  2. An app's slug owns the first path segment: `/<app>/…` is that app, its
 *     own worker first where it has one and its files behind it, whatever the
 *     home app has at the same address. A former slug is sent on.
 *  3. The home app answers every path no app claims, at the bare hostname,
 *     asked exactly the way rung 2 asks an app.
 *  4. The space's index is `/`'s last word, where the space has no home app
 *     or the home app has nothing there, so a space that exists is a door and
 *     not a 404.
 *  5. Every other path is a missing page: a 404 where the space has no home
 *     app, and where it has one, the home app's own answer.
 *
 * Rungs 3 and 5 are one call. That is what makes the home app the space's
 * router: a worker that sees every path no other app claims, and answers 404
 * to pass, leaving the rest to its files.
 *
 * ```ts
 * import { rung } from '@yaks/platform/ladder'
 * import { assertEquals } from '@std/assert'
 * let menu = { slug: 'menu', home: false, trashed: null }
 * let space = { slug: 'ada', trashed: null }
 * let step = await rung(
 *   { host: 'ada.yaks.app', method: 'GET', pathname: '/menu/soup', search: '' },
 *   {
 *     kept: async () => null,
 *     page: async () => ({ space, app: menu, home: null }),
 *     formerly: async () => null,
 *     former: async () => null,
 *   },
 * )
 * assertEquals(step.to == 'app' && [step.path, step.bare], ['/soup', '/menu/'])
 * ```
 *
 * @module
 */
import { type Host, spaceHost, url } from './host.ts'
import { PLATFORM_STORE } from './names.ts'
import { MANAGE, movedFor, OURS, route } from './routes.ts'

/** A space as the ladder reads it. */
export type Spaced = { slug: string; trashed?: unknown }
/** An app as the ladder reads it: whether it is its space's front page. */
export type Apped = { slug: string; home: boolean; trashed?: unknown }

/** What the directory says of an address: the space its hostname names, the
 * app its first segment names, and the space's front page. */
export type Reading = {
  space: Spaced | null
  app: Apped | null
  home: Apped | null
}

/** What the ladder asks its host to read, each only on the rung that needs
 * it. */
export type Looks<R extends Reading> = {
  /** the page a cache already keeps for this address, for anyone */
  kept: () => Promise<Response | null>
  /** the directory's reading of the space and of the app, if a segment named
   * one */
  page: (space: string, app: string | null) => Promise<R>
  /** the space that answered at this name before a rename moved it */
  formerly: (space: string) => Promise<{ slug: string } | null>
  /** the app of `space` that answered at this slug before a rename moved it */
  former: (space: Space<R>, app: string) => Promise<{ slug: string } | null>
}

/** A request as the ladder reads it. `mount` is the root a custom domain
 * mounts its app at (./routes.ts `MOUNT`). */
export type Asked = {
  host: string
  method: string
  pathname: string
  search: string
  mount?: string | null
}

type Space<R extends Reading> = NonNullable<R['space']>
type App<R extends Reading> = NonNullable<R['app']>
// A rung reached once the space is read: the space answering, and the whole
// reading its host asked for.
type At<R extends Reading> = { space: Space<R>; read: R }

/** Where an address stops. */
export type Rung<R extends Reading> =
  /** the dashboard, at the apex */
  | { to: 'manage' }
  /** what the cache keeps for it */
  | { to: 'kept'; page: Response }
  /** nothing; `kept` where it is the same nothing for everyone until the
   * space routes anew */
  | ({ to: 'nothing'; kept?: true } & Partial<At<R>>)
  /** sent on, with `status` */
  | ({ to: 'sent'; href: string; status: number } & Partial<At<R>>)
  /** the space is in the trash: its owner is shown how to bring it back */
  | ({ to: 'closed' } & At<R>)
  /** the app is in the trash: its owner is told where it went */
  | ({ to: 'binned'; app: App<R> } & At<R>)
  /** the builder's socket, or its `script` */
  | ({ to: 'build'; script: boolean } & At<R>)
  /** the space's index */
  | ({ to: 'index' } & At<R>)
  /** `/<app>` sent to its slash, kept as the app's own pages are */
  | ({ to: 'slash'; href: string; app: App<R> } & At<R>)
  /** the app answers `path` from its own root, mounted for the browser at
   * `bare`; `front` where it is the space's front page */
  | ({
    to: 'app'
    app: App<R>
    path: string
    front: boolean
    bare: string
  } & At<R>)

/** The builder's door: a space's own address, ahead of every app in it
 * (workers/yak router.ts PLATFORM_PATHS `/api/*`), because a person with no
 * app yet is exactly who the builder is for. */
export let BUILD = '/api/build'

/** Whether `path`, under an app's root, is the app's @yaks/web page. */
/// webPath('/_web') -> true
/// webPath('/_web/data') -> true
/// webPath('/_webby') -> false
export let webPath = (path: string): boolean =>
  path == '/_web' || path.startsWith('/_web/')

/** Whether `pathname` is a machine door of an app, even where it names no
 * app: what is missing there is answered in the refusals' JSON, never a page.
 * `/api/query` is read as an app called `api`, so the raw pathname is read. */
/// appApi('/api/query') -> true
/// appApi('/menu/api/query') -> true
/// appApi('/menu/_web') -> true
/// appApi('/menu/soup') -> false
export let appApi = (pathname: string): boolean =>
  /^(?:\/[^/]+)?\/(?:api\/|_web(?:\/|$))/.test(pathname)

/** Whether `app` of `space` is the directory's own store: kernel data, not
 * an app, served at its address to nobody, owner included. The kernel's parts
 * read it directly, and its owner's door to it is the graph tier. */
/// kernels('yak', 'platform') -> true
/// kernels('yak', 'menu') -> false
export let kernels = (space: string, app: string | null): boolean =>
  `${space}/${app}` == PLATFORM_STORE

let reading = (method: string) => method == 'GET' || method == 'HEAD'

// An address something has left, answered as the move it was. Permanent, so a
// link someone holds heals itself: 301 for a read, 308 for everything else,
// because a 301 is retried as a GET and a page writing to its old
// `/api/apply` would land on the new one as a read.
let moving = (method: string, href: string) => ({
  to: 'sent' as const,
  href,
  status: reading(method) ? 301 : 308,
})

/** Where `asked` stops, by what `looks` reads. */
export let rung = async <R extends Reading>(
  { host, method, pathname, search, mount = null }: Asked,
  looks: Looks<R>,
  env: Host = {},
): Promise<Rung<R>> => {
  let r = route(host, pathname, env)
  if (r.space == null) {
    return pathname == MANAGE || pathname.startsWith(`${MANAGE}/`)
      ? { to: 'manage' }
      : { to: 'nothing' }
  }
  // A page any visitor could be sent is answered from the cache, with no wait
  // on the directory.
  let kept = await looks.kept()
  if (kept) return { to: 'kept', page: kept }
  let read = await looks.page(r.space, r.app)
  let space = read.space as Space<R> | null
  // Not a space here, but it may be where one used to be: a rename keeps the
  // old name pointing at it, whole path and query, as a renamed app's old
  // path does one level down.
  if (!space) {
    let was = await looks.formerly(r.space)
    return was
      ? moving(
        method,
        `https://${spaceHost(env, was.slug)}${pathname}${search}`,
      )
      : { to: 'nothing', kept: true }
  }
  if (kernels(space.slug, r.app)) return { to: 'nothing' }
  let at = { space, read }
  // The whole space in the trash: every address of it answers nothing, and
  // its owner the page that brings it back.
  if (space.trashed) {
    return appApi(pathname) ? { to: 'nothing', ...at } : { to: 'closed', ...at }
  }
  // Where the dashboard was before it moved to the apex: letters still carry
  // these addresses, so each view is sent on to its new one, query and all. A
  // form posted from a page left open since has nothing to land on and is
  // sent to the page instead.
  if (pathname == OURS || pathname.startsWith(`${OURS}/`)) {
    let path = movedFor(MANAGE + pathname.slice(OURS.length), space.slug)
    if (!path) return { to: 'nothing', ...at }
    let to = new URL(path, url(env))
    for (let [k, v] of new URLSearchParams(search)) to.searchParams.append(k, v)
    return {
      to: 'sent',
      href: to.href,
      status: reading(method) ? 301 : 303,
      ...at,
    }
  }
  // The builder's socket, and the live half of its chat, served here so a
  // space's page needs no asset of the apex. Before the home app is looked
  // for, since a space with none would be a 404 at every path but `/`.
  if (pathname == `${BUILD}.js`) return { to: 'build', script: true, ...at }
  if (pathname == BUILD) return { to: 'build', script: false, ...at }
  let app = read.app as App<R> | null
  let home = read.home as App<R> | null
  // In the trash: the address is held for it and answers nothing while it
  // waits. Not a 410 and not a redirect: to the web this is an address with
  // nothing at it, which is what a delete has always meant.
  if (app?.trashed) {
    return appApi(pathname)
      ? { to: 'nothing', ...at }
      : { to: 'binned', app, ...at }
  }
  if (r.app && !app) {
    let was = await looks.former(space, r.app)
    if (was) {
      return {
        ...moving(method, `/${was.slug}${r.path || '/'}${search}`),
        ...at,
      }
    }
  }
  if (!app) {
    // No front page at all, the ordinary state of a space: rung 4 at the bare
    // address, rung 5's 404 anywhere else.
    if (!home || kernels(space.slug, home.slug)) {
      return pathname == '/'
        ? { to: 'index', ...at }
        : { to: 'nothing', kept: true, ...at }
    }
    // `/<x>/api/…` named an app that is not here. That is a wrong address,
    // not one of the front page's own paths: a page asking a store there has
    // to hear a 404, never a page of HTML it cannot parse.
    if (r.app && (r.path.startsWith('/api/') || webPath(r.path))) {
      return { to: 'nothing', ...at }
    }
    return {
      to: 'app',
      app: home,
      path: pathname,
      front: true,
      bare: mount ?? '/',
      ...at,
    }
  }
  // The home app's own `/<app>/` forwards to the bare hostname, so its address
  // is that and nothing else. Temporary, since which app is home is a word the
  // owner moves, and a 301 a browser cached would outlive the move. A custom
  // domain already mounts it at its own root, where the forward would land
  // back on the address that arrived.
  if (!mount && app.home && (r.path == '' || r.path == '/')) {
    return { to: 'sent', href: `/${search}`, status: 302, ...at }
  }
  // `/<app>` itself, sent to its slash, which is how a link is often shared.
  if (r.path == '') {
    return { to: 'slash', href: `${pathname}/${search}`, app, ...at }
  }
  return {
    to: 'app',
    app,
    path: r.path,
    front: app.home,
    bare: mount ?? (app.home ? '/' : `/${app.slug}/`),
    ...at,
  }
}
