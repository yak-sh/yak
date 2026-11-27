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
 *     not a 404. `/robots.txt` has the platform's last word the same way: the
 *     space's own apps say it first, and where none does, the platform's
 *     points search engines at the gallery's sitemap (workers/yak seo.ts).
 *  5. Every other path is a missing page: a 404 where the space has no home
 *     app, and where it has one, the home app's own answer.
 *
 * Rungs 3 and 5 are one call. That is what makes the home app the space's
 * router: a worker that sees every path no other app claims, and answers 404
 * to pass, leaving the rest to its files.
 *
 * `rung` is where an address stops. Inside an app, `door` is which of its
 * doors a request goes to for whoever is asking, `behind` what answers its
 * page once its own worker was asked, and `indexes` whether that answer gives
 * way to rung 4.
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
import { type Level, type Mode, mode, reads } from '@yaks/member'
import { decoded } from './files.ts'
import { type Host, spaceHost, url } from './host.ts'
import { PLATFORM_STORE } from './names.ts'
import { MEMBER } from './refused.ts'
import { MANAGE, movedFor, OURS, route, spaced } from './routes.ts'

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
  transferred?: (
    space: Space<R>,
    app: string,
  ) => Promise<{ space: string; slug: string } | null>
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
  /** a person's spaces and account, at the apex (./routes.ts `managed`,
   * `spaced`) */
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
  /** the old builder door, forwarded to the Operator */
  | ({ to: 'build' } & At<R>)
  /** the space's index, at `/` */
  | ({ to: 'index' } & At<R>)
  /** the platform's robots file, at `/robots.txt` */
  | ({ to: 'robots' } & At<R>)
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

/** The old builder door: a space's own address, ahead of every app in it
 * (workers/yak router.ts PLATFORM_PATHS `/api/*`), which a page drawn before
 * the New app screen asked the Operator still posts its line to. */
export let BUILD = '/api/build'

/** What the space says, rather than an app of it, at the addresses where it
 * has the last word (rung 4): its index at `/`, and its robots file. */
export type Last = 'index' | 'robots'

/** The space's last word at `pathname`, if it has one there. */
/// last('/') -> 'index'
/// last('/robots.txt') -> 'robots'
/// last('/about') -> null
export let last = (pathname: string): Last | null =>
  pathname == '/' ? 'index' : pathname == '/robots.txt' ? 'robots' : null

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
    return pathname == MANAGE || pathname.startsWith(`${MANAGE}/`) ||
        spaced(pathname)
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
  // The old builder door, before the home app is looked for, since a space
  // with none would be a 404 at every path but `/`.
  if (pathname == BUILD) return { to: 'build', ...at }
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
  if (!app && r.app && reading(method)) {
    let moved = await looks.transferred?.(space, r.app)
    if (moved) {
      return {
        to: 'sent',
        href: `https://${spaceHost(env, moved.space)}/${moved.slug}${
          r.path || '/'
        }${search}`,
        status: 302,
        ...at,
      }
    }
  }
  if (!app) {
    // No front page at all, the ordinary state of a space: rung 4 at the bare
    // address and the robots file, rung 5's 404 anywhere else.
    if (!home || kernels(space.slug, home.slug)) {
      let word = last(pathname)
      return word == 'index'
        ? { to: 'index', ...at }
        : word == 'robots'
        ? { to: 'robots', ...at }
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

/** Who is asking, as an app's doors read them: a person or nobody, the level
 * they hold here, and whether that level is a guest's grant on this one app
 * rather than a seat in its space. */
export type Asking = {
  person: string | null
  role: Level | null
  guest?: boolean
}

/** Whether a visitor may see an app's page: `page`, else `sign-in` for
 * nobody, else `nothing` for a person who is nobody here. */
export type Seen = 'page' | 'sign-in' | 'nothing'

// The app's data editor, a person's page, and its script and assets.
let DATA = '/_web/data'
let DATA_SCRIPT = '/_web/data.js'
let DATA_ASSETS = '/_web/assets/'
/** The platform's telemetry door beside each mounted editor. */
export let DATA_TIMING = 'interaction'
/** Where an app's page says it ran, from the app's root (yaks.app's
 * views.ts `pageRan`). */
export let SEEN = '/_web/seen'
let INSPECT = ['/_web/inspect/app.js', '/_web/inspect/styles.css']

/** Which of an app's doors a request inside it goes to. */
export type Door =
  /** refused in the JSON every refusal speaks; `signIn` where signing in
   * would open it, and `says` where it is not the code's own sentence
   * (./refused.ts `SAYS`) */
  | {
    to: 'refused'
    status: number
    code: string
    says?: string
    signIn?: true
  }
  /** the data editor, or its script or an asset of its skin by `name`, else
   * the sign-in or the nothing a page would meet */
  | {
    to: 'data'
    part: 'sign-in' | 'nothing' | 'script' | 'editor' | 'interaction'
  }
  | { to: 'data'; part: 'asset'; name: string }
  /** a page of the app saying it ran, from a visitor who may see it */
  | { to: 'seen' }
  /** the app's @yaks/web page, or its `asset` */
  | { to: 'web'; asset?: string }
  /** one of the app's store doors, `door` from its `/api` */
  | { to: 'api'; door: string }
  /** the page, as the visitor may see it, once the store says it holds the
   * `form` the page shows */
  | { to: 'page'; seen: Seen; form?: string }

/**
 * Who may open an app's page. Its members, and anyone at all where the app is
 * public; the app's own worker coming back through its grant (`itself`) on any
 * app. A stranger to a private app is sent to sign in and handed back to the
 * page; someone signed in who is nobody there gets the same nothing-here a
 * wrong address gets, whether the app exists being its owner's to tell.
 */
export let seen = (access: Mode, who: Asking, itself = false): Seen =>
  itself || reads(mode(access), who.role)
    ? 'page'
    : who.person
    ? 'nothing'
    : 'sign-in'

/** Which door `path`, from an app's root, goes to for `who`, on an app of
 * `access`; `itself` where the app's own worker is asking. */
export let door = (
  { path, method, who, access, itself = false }: {
    path: string
    method: string
    who: Asking
    access: Mode
    itself?: boolean
  },
): Door => {
  if (webPath(path)) {
    if (method == 'POST' && path == DATA_ASSETS + DATA_TIMING) {
      return { to: 'data', part: 'interaction' }
    }
    if (
      method == 'POST' && path == SEEN && seen(access, who, itself) == 'page'
    ) {
      return { to: 'seen' }
    }
    if (!reading(method)) {
      return { to: 'refused', status: 405, code: 'method_not_allowed' }
    }
    // The data editor is a person's page, not a machine door: anyone who
    // holds a level on this app opens it, a guest included, and it writes
    // only what the store lets them. Everyone else meets what a page would
    // tell them.
    if (path == DATA || path == DATA_SCRIPT || path.startsWith(DATA_ASSETS)) {
      if (!who.person) return { to: 'data', part: 'sign-in' }
      if (!who.role || !reads(mode(access), who.role)) {
        return { to: 'data', part: 'nothing' }
      }
      if (path == DATA_SCRIPT) return { to: 'data', part: 'script' }
      return path == DATA
        ? { to: 'data', part: 'editor' }
        : { to: 'data', part: 'asset', name: path.slice(DATA_ASSETS.length) }
    }
    // The @yaks/web page is a member's: a guest of one app holds no seat in
    // the space its page reads.
    if (!who.person) {
      return { to: 'refused', status: 401, code: 'not_a_reader', signIn: true }
    }
    if (!who.role || who.guest || !reads(mode(access), who.role)) {
      return {
        to: 'refused',
        status: 403,
        code: 'not_a_reader',
        says: MEMBER.not_a_reader,
      }
    }
    if (path.startsWith('/_web/web/')) {
      return { to: 'web', asset: path.slice('/_web/web/'.length) }
    }
    if (INSPECT.includes(path)) {
      return { to: 'web', asset: path.slice('/_web/'.length) }
    }
    return { to: 'web' }
  }
  // The `/api/` doors stay the kernel's, always, and keep their own refusals,
  // which speak.
  if (path.startsWith('/api/')) return { to: 'api', door: path.slice(4) }
  let page = seen(access, who, itself)
  let form = /^\/form\/([^/]+)$/.exec(path)
  if (!form) return { to: 'page', seen: page }
  let name = decoded(form[1])
  return name
    ? { to: 'page', seen: page, form: name }
    : { to: 'refused', status: 404, code: 'not_found' }
}

/** What answers an app's page once its own worker was asked: the worker's
 * answer; else the `files`, which the visitor may see, and where they hold
 * nothing the worker's 404, else nothing; else the worker's 404 where the
 * files the visitor may not see hold nothing either (`pass`); else the
 * sign-in or the shut door the visitor meets. `worker` is what the worker
 * said: an `answer`, a 404 (its `pass`), or `none` where it was not asked.
 * `held` says whether the files hold the path, asked only where the worker
 * passed and the files are shut to this visitor.
 *
 * A private app hides its page too, not only its data: its files are part of
 * what its members see. Its own worker is the exception, both ways round. It
 * runs ahead of this gate, so on a private app the worker is the gatekeeper:
 * `access` is one word about the whole store, and a rule finer than that can
 * only live in the app's own code. And a request coming back from it passes
 * the gate (`seen`'s `itself`), so it reads the app's pages where a stranger
 * asking directly is refused. A stranger is sent to sign in for a page the
 * app has, never for one it does not. */
export let behind = async (
  { worker, seen, held }: {
    worker: 'answer' | 'pass' | 'none'
    seen: Seen
    held: () => Promise<boolean>
  },
): Promise<'worker' | 'files' | 'pass' | 'sign-in' | 'shut'> => {
  if (worker == 'answer') return 'worker'
  if (seen == 'page') return 'files'
  if (worker == 'pass' && !await held()) return 'pass'
  return seen == 'sign-in' ? 'sign-in' : 'shut'
}

/** Which of its space's last words a page's answer gives way to (rung 4): a
 * 404 at `/` or `/robots.txt`, addresses only the home app can be at, so its
 * worker passed and its files have neither. Any other path keeps the 404: an
 * address inside a space that nothing answers is nothing, not a listing. */
/// indexes('/', 404) -> 'index'
/// indexes('/robots.txt', 404) -> 'robots'
/// indexes('/about', 404) -> null
/// indexes('/', 200) -> null
export let indexes = (pathname: string, status: number): Last | null =>
  status == 404 ? last(pathname) : null
