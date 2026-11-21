import { browsersOf } from './attribution.ts'
import {
  refuse as refusedOptions,
  waits,
  whoDoor,
  writeOptions,
} from '@yaks/api'
import { decodedPath } from './request-path.ts'
import { serves, stamped } from './site-data.ts'
import { BINARY } from '@yaks/vocab/wire'
import { copyOf } from './directory-copy.ts'
import { APP, type Preview } from './link-preview.ts'
import { previewed } from './preview-html.ts'
// The app-serving part: `<space>.yaks.app/<app>/…` — the deploy seam's first
// hosted implementation (D-32318 §v1 sequencing). One fetch handler: it
// reads the hostname and path (@yaks/platform/routes), resolves the space and app through
// the directory part (directory.ts, in-process or across a binding), verifies
// the session (session.ts), and serves the app's files out of its blob store
// with the graph API for its (space, app) store beside them —
// `/api/{apply,query,me,graph}` mapped onto the Store object's doors, the store
// named from the route, never by the client. `PUT /api/files/<path>` stages a
// member's file for app_deploy, and
// `/api/blob` is the door for a page's own bytes — a photo a visitor picks —
// content-addressed into the same bucket and named by a row in the app's
// store (T-32677). An app's own Worker answers before the files do, where it
// deployed one (dispatch.ts `ran`, T-32778): the same `vouched` headers, a
// 404 from it falling back to the files, and `/api/` never its. It answers
// ahead of the `private` gate as well (T-34303) — an app with a worker is one
// whose gatekeeper is its own code, and `env.APP` is what that code writes
// with.
//
// A page's own breaks come back here too (T-32486), without the page asking:
// every HTML response is rewritten on its way out to carry the reporter
// script (public/report.js), every app response carries `Reporting-Endpoints`
// and `NEL` so the browser itself reports CSP violations, crashes,
// deprecations and network errors, and both land on `POST /api/report`, which
// writes the same `exception` entity a route that threw does, by the rules
// every page's report door keeps (@yaks/tracker/report `door`). Rate-limited
// per app: a page in a loop is a bug to see once, not a write flood. What the
// door refused on purpose never becomes one (unseen.ts `refusal`): a
// signed-out visitor sent to sign in is the platform working.
import { type Host, url as hostUrl } from '@yaks/platform/host'
import { r2Objects } from './lib/objects.ts'
import { logoIcon } from './logo.ts'
import { monogram } from '@yaks/platform/monogram'
import { forwarded, NOBODY, NOT_A_WRITER } from './build-door.ts'
import { client } from './sheets.ts'
import { apiOut, assetMaps, assetUrl, linked, LOADS } from './asset_url.ts'
import { assetPath, releaseId } from '@yaks/platform/versions'
import * as files from './files.ts'
import * as fence from '@yaks/platform/files'
import { parse as parseRedirects, sentOn } from './redirects.ts'
import { prefixOf, VERSION } from './files.ts'
import { appCopy, type Copy, filled } from './page-copy.ts'
import { door as publicDoor, served as publicFile } from './public-files.ts'
import {
  type App,
  appStore,
  daysLeft,
  type Directory,
  directory,
  type Role,
  type Space,
  storeName,
  url as urlOf,
} from './directory.ts'
import * as dirPart from './directory.ts'
import {
  ahead,
  bearing,
  granted,
  grantedStore,
  itsApp,
  ran,
  type Visitor,
} from './dispatch.ts'
import { bound, type Env } from './env.ts'
import { pilled, standing } from './gallery-row.ts'
import { buying } from './sell.ts'
import { addressed } from '@yaks/blob'
import { declarationOf } from './declaration.ts'
import { KERNEL, metaOf } from './meta.ts'
import { Pending } from '@yaks/api/log'
import { belowFloor, blobDoor } from './uploads.ts'
import {
  batched,
  lined,
  lineOf,
  minted,
  receipt,
  resend,
} from '@yaks/platform/page-wire'
import {
  binned,
  editor,
  invitedTo,
  joinable as joinPage,
  nothingHere,
  spaceBinned,
  spaceIndex,
} from './pages.ts'
import { join, joinable } from './join.ts'
import {
  API_AT,
  chatPath,
  hostOf,
  manageAt,
  managePath,
  MANIFEST,
  MOUNT,
  paged as pagePath,
  signInAt,
} from '@yaks/platform/routes'
import { covers, platformPath } from './router.ts'
import {
  browsing,
  nobody,
  sessionPerson,
  sessionReading,
  titling,
  vouched,
  type Who,
  whoIs,
} from './session.ts'
import { asking } from './asking.ts'
import { queried } from './page-graph.ts'
import { local } from './homes.ts'
import { dataAsset, webAsset, webPage } from './web.ts'
import {
  appApi,
  behind,
  door,
  indexes,
  kernels,
  rung,
  webPath,
} from '@yaks/platform/ladder'
import { pageScript, type Scripts } from './page-script.ts'
import {
  admitted,
  badged,
  based,
  baseOf,
  hasBase,
  intoHead,
  manifesting,
  pinned,
} from '@yaks/platform/woven'
import { json, MEMBER, SAYS, WAITING } from '@yaks/platform/refused'
import { Refused } from '@yaks/graph/errors'
import { mistaken } from './mistake.ts'
import { digest } from '@yaks/graph/sha256'
import { edits, mode, reads, writes } from '@yaks/member'
import { ACROSS } from './door.ts'
import { type Clock, clock, timed } from './timing.ts'
import { asked, keep, shown, told, unkept } from './page-cache.ts'
import {
  type Alone,
  browserImmutable,
  CLIENT,
  fixed,
  immutable,
  keepable,
  NAMED_CLIENT,
  passed,
  uploaded,
} from '@yaks/platform/kept'
import { sessionCookie } from './browser-cookie.ts'
import { noted, refusal, serving } from './unseen.ts'
import { door as reportDoor, flood } from '@yaks/tracker/report'
import { writer } from '@yaks/platform/app-authority'
import { ADDRESS } from '@yaks/platform/routes'
import { FORM } from '@yaks/forms/routes'
import { background, caught, defect, failing, refusing } from './defects.ts'
import {
  atApp,
  barOf,
  births,
  crowded,
  due,
  onSample,
  revisited,
  unborn,
  used,
  type Visit,
  visitable,
  type Visiting,
  visiting,
  visitOf,
} from '@yaks/platform/visits'
import {
  born,
  ledgerOf,
  offeredSource,
  ownOf,
  type Release,
  releaseFor,
  tellBorn,
  toldStores,
} from './visit.ts'
import { MOVED } from '@yaks/sync'
import { full } from './usage.ts'
import { scheduleBy } from './used.ts'
import { seen } from './views.ts'
import { refuse } from './tool.ts'
import type { PoolCtx } from './declared.ts'
import { CallError } from '@yaks/tools/errors'
import { routes as commandRoutes } from '@yaks/tools/routes'
import { commandIn, commandsIn } from './app-command.ts'
import type { Reply } from '@yaks/platform/app-command'
import { type Limiter, source, tooMany, within } from '@yaks/workerd/rate'
import {
  bearerOf,
  sandboxed,
  stored,
  tokenOf,
  walled,
} from '@yaks/platform/installs'
import { lasting, paged, paging } from './page-token.ts'

// The runtime's streaming HTML rewriter, the slice this file asks for, so
// `deno check` reads the Worker without @cloudflare/workers-types (env.ts).
type Html = { html: boolean }
type Rewriter = {
  on(
    selector: string,
    handlers: {
      element(el: {
        getAttribute(name: string): string | null
        setAttribute(name: string, value: string): void
        prepend(s: string, o: Html): void
        before(s: string, o: Html): void
      }): void
    },
  ): Rewriter
  onDocument(
    handlers: { end(end: { append(s: string, o: Html): void }): void },
  ): Rewriter
  transform(res: Response): Response
}
declare let HTMLRewriter: { new (): Rewriter }

/** An app's platform door, within its /api/ prefix. */
export type Asked = {
  env: Env
  req: Request
  path: string
  space: Space
  app: App
  who: Who
  refuse: (what?: string) => Promise<Response>
  json: (status: number, code: string, says?: string) => Response
}

/** An app door, or null when the path belongs elsewhere. */
export type Answer = (
  asked: Asked,
) => Promise<Response | null> | Response | null

// The app's platform doors under its /api/ prefix, by the first segment of
// the path each owns, loaded when a request first reaches one so serving a
// page compiles none of them (T-148886). Each still answers null to a path of
// its segment it does not serve.
let DOORS = new Map<string, () => Promise<Answer>>([
  ['drafts', async () => (await import('./draft-door.ts')).draftDoor],
  ['pay', async () => (await import('./sale-door.ts')).saleDoor],
  ['stats', async () => (await import('./views.ts')).stats],
  ['connections', async () => (await import('./connections.ts')).own],
  ['env', async () => (await import('./outbound.ts')).envDoor],
  ['fetch', async () => (await import('./outbound.ts')).fetchDoor],
  ['tunneled', async () => (await import('./tunnel.ts')).reach],
  ['documents', async () => (await import('./document-search.ts')).documents],
  ['pdf', async () => (await import('./pdf.ts')).pdfDoor],
  ['ai', async () => {
    let { modelRun, recovery } = await import('./models.ts')
    return async (asked) => await modelRun(asked) ?? await recovery(asked)
  }],
  ['speech', async () => {
    let [{ speechDoor }, { listenDoor }] = await Promise.all([
      import('./speech.ts'),
      import('./listen.ts'),
    ])
    return async (asked) => await listenDoor(asked) ?? await speechDoor(asked)
  }],
  ['rtc', async () => (await import('./rtc.ts')).voice],
  ['notices', async () => (await import('./notices.ts')).notices],
  ['operator', async () => {
    let { send, tell } = await import('./app-operator.ts')
    return async (asked) => await send(asked) ?? await tell(asked)
  }],
  ['form', async () => (await import('./forms.ts')).forms],
  ['line', async () => (await import('./app-texts.ts')).lineAnswer],
])
// The form door's paths, whose forms are the app's own whoever asks.
let formPath = (path: string, req: Request) =>
  path.startsWith('/api/form/') ||
  (path == '/api/blob' && req.method == 'POST' &&
    new URL(req.url).searchParams.has('form'))

// Whether the owner already let `person` in and an invitation waits for them
// to accept (invite.ts), which is what a refusal then tells them
// (@yaks/platform/refused `WAITING`).
export let waiting = async (
  dir: Pick<ReturnType<typeof directory>, 'invite'>,
  space: Space,
  app: App,
  person: string,
  what: string,
) => {
  let [mine, all] = await Promise.all([
    dir.invite(app.eid, person),
    dir.invite(space.eid, person),
  ])
  let held = mine ?? all
  return held && (what == 'not_a_reader' || held.role != 'viewer')
}

/** What a signed-in person is told when an app refuses them: the click in
 * their letter if the owner already let them in, else who can let them in. */
export let refusedSaid = async (
  dir: Parameters<typeof waiting>[0],
  space: Space,
  app: App,
  person: string,
  what: string,
) => await waiting(dir, space, app, person, what) ? WAITING : MEMBER[what]

/** Whether a page asking who is looking (`/who`) hears that an invitation
 * waits for them: signed in, unable to write here, and let in by the owner,
 * so the page can say so before they type. */
export let invitedHere = async (
  dir: Parameters<typeof waiting>[0],
  space: Space,
  app: App,
  person: string | null,
  mayRead: boolean,
  mayPost: boolean,
) =>
  !!person && !mayPost &&
  !!await waiting(
    dir,
    space,
    app,
    person,
    mayRead ? 'not_a_writer' : 'not_a_reader',
  )

/** The page for a signed-in person an app's pages are shut to: that their
 * invitation waits, if the owner let them in, else Join where the app's own
 * rows list them (join.ts), else that nothing is here. `at` is the app's
 * address as served, where its join door is. */
export let shut = async (
  env: Env,
  dir: Parameters<typeof waiting>[0] & Parameters<typeof joinable>[1],
  space: Space,
  app: App,
  who: { person: string; role: Role | null; guest?: boolean },
  at: string,
) => {
  if (await waiting(dir, space, app, who.person, 'not_a_reader')) {
    return invitedTo(app.title || app.slug, env)
  }
  let role = await joinable(env, dir, space, app, who)
  return role
    ? joinPage(
      { title: app.title || app.slug, role, action: `${at}api/join` },
      env,
    )
    : nothingHere(env)
}

// The wait an error asks for (a stopped store's), as the header a page reads.
export let waited = (error: unknown): Record<string, string> => {
  let wait = waits(error)
  return wait == null ? {} : { 'retry-after': String(wait) }
}

// A refusal, or a store's answer it relays, keeps its HTTP status through the
// page's error envelope, and the wait it asks for. A failure raised here is
// reported with the door's tags and thrown on, never answered as the page's
// mistake (defects.ts `refusing`).
let rejection = (error: unknown, tags: Record<string, string>) =>
  Response.json({
    error: {
      code: 'refused',
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error ? { name: error.name } : {}),
    },
  }, { status: refusing(error, tags), headers: waited(error) })

// A store's answer read as `read` reads it, or, where it refused, the answer
// itself to relay as it came: its status, and a stopped store's wait.
let readOr = <T>(read: (res: Response) => Promise<T>) =>
async (
  res: Response,
): Promise<{ read: T } | { failed: Response }> =>
  res.ok
    ? { read: await read(res) }
    : { failed: new Response(await res.text(), res) }

// What the page's own code got wrong, as the store refused it: a break in the
// app, filed here at its door because the page may catch the refusal and the
// browser reporter deliberately files no 4xx (unseen.ts `refusal`). The page
// still hears the refusal as it always has. It names the release the page
// ran, which client.js sends, else the one serving.
let mistake = async (
  req: Request,
  env: Env,
  space: Space,
  app: App,
  e: unknown,
  entrypoint: 'query' | 'apply',
) => {
  try {
    await mistaken(req, e, entrypoint, {
      version: () => serving(env, space, app),
      note: (report) =>
        noted(report, { env, space, app, request: req, entrypoint }),
    })
  } catch (why) {
    caught(why, {
      request: `report ${entrypoint} failure`,
      space: space.slug,
      app: app.slug,
    })
  }
}

let nothingAt = (pathname: string, env: Env) =>
  appApi(pathname)
    ? json(404, 'not_found', 'no app at that address')
    : nothingHere(env)

// Where a refusal sends someone who has not signed in (@yaks/platform/routes `signInAt`).
// At the file door the page to return to is the request itself; at an `/api/`
// door — nowhere to return to — it is the Referer, and the request's own
// address when the browser sent none.

export let redirect = (to: string, status = 302) =>
  new Response(null, { status, headers: { location: to } })

// An address the app has left, answered as the move it was. Permanent, so a
// link someone holds heals itself — 301 for a read, 308 for everything else,
// because a 301 is retried as a GET and a page writing to its old `/api/apply`
// would land on the new one as a read (C-32574 item 4).
export let moved = (req: Request, to: string) =>
  new Response(null, {
    status: req.method == 'GET' || req.method == 'HEAD' ? 301 : 308,
    headers: { location: to },
  })

// One of the platform's own scripts, from its assets, asked the way the
// browser asked: its validators ride along, so a page that already holds the
// file is answered 304 and no bytes, where a bare request re-sent the whole
// file on every load.
let platformFile = (req: Request, env: Env, path: string) =>
  env.ASSETS.fetch(
    new Request(new URL(path, req.url), {
      method: req.method,
      headers: [...req.headers].filter(([name]) => name.startsWith('if-')),
    }),
  )

// The store client under a name of its bytes (assets.ts), which never
// changes under it, so the browser keeps it. A page held from before a deploy
// names one this deploy no longer holds, and is sent to the client it has.
let namedClient = async (req: Request, env: Env, path: string) => {
  let file = await platformFile(req, env, `/_yak/_${path.slice(1)}`)
  if (file.status == 404) {
    await file.body?.cancel()
    return new Response(null, {
      status: 302,
      headers: { location: 'client.js' },
    })
  }
  let headers = new Headers(file.headers)
  headers.set('cache-control', immutable['cache-control'])
  return new Response(file.body, { status: file.status, headers })
}

// The reporter, into every page the kernel serves (page-script.ts), wherever
// the page has a place to put it ahead of its own code: first inside
// `<head>`, else first inside `<body>`, else before the page's first script,
// else at the end of a document with none of them. A page needs neither tag,
// and one without them that threw in its first script went unreported when
// the reporter landed after it. Streaming — the bytes are never held — and
// once, whichever came first.
//
// It is told the app's address as served (`at`), where it finds its doors: at
// the app's prefix normally, at the root for a front page or a custom domain,
// where the prefix is an address the browser asking cannot reach (T-33040).
//
// A page answered with a policy of its own (an app's worker can send one) has
// that policy admit the scripts by their hashes (@yaks/platform/woven
// `admitted`), so its own rules hold for everything else. A `<meta>` policy
// governs only what follows it, and the tags come first.
//
// A page of a space on the free plan wears the badge too (public/badge.js,
// @yaks/platform/woven `badgeOf`), and a visitor's page their bar
// (public/visit.js, `barOf`): decided as it is served, so every version and
// release an app serves wears them, and none of their files change.
let appPreview = (app: App, at: string): Preview =>
  app.access == 'private' ? APP : {
    title: app.title || app.slug,
    description: app.published?.about,
    image: app.screenshot ? `${at}api/blob/${app.screenshot}` : undefined,
  }

export let reported = async (
  env: Env,
  at: string,
  page: Response,
  version: number,
  scripts: Scripts,
  preview: Preview = APP,
  address = hostUrl(env, at),
) => {
  page = previewed(env, page, address, preview)
  let { tags, hashes } = await pageScript(env.ASSETS, at, version, scripts)
  let done = false
  let once = (put: (s: string, o: { html: boolean }) => void) => {
    if (done) return
    done = true
    put(tags, { html: true })
  }
  let policy = page.headers.get('content-security-policy')
  if (policy) {
    let headers = new Headers(page.headers)
    headers.set('content-security-policy', admitted(policy, hashes))
    page = new Response(page.body, {
      status: page.status,
      statusText: page.statusText,
      headers,
    })
  }
  return new HTMLRewriter()
    .on('head', { element: (el) => once((s, o) => el.prepend(s, o)) })
    .on('body', { element: (el) => once((s, o) => el.prepend(s, o)) })
    .on('script', { element: (el) => once((s, o) => el.before(s, o)) })
    .onDocument({ end: (end) => once((s, o) => end.append(s, o)) })
    .transform(page)
}

// A page stays mutable, but its local static files belong to its immutable
// release. CSS URLs and module imports then resolve below the same release
// address without rewriting their contents. Authenticated API calls and page
// navigation keep their ordinary addresses.
let mapped = (
  html: string,
  at: string,
  bare: string,
  source: string | null | undefined,
  base = at,
) => {
  let id = releaseId(source)
  return id && !hasBase(html)
    ? assetMaps(html, at, bare, id, platformPath, base, client())
    : html
}
let released = (
  page: Response,
  html: string,
  at: string,
  bare: string,
  source: string | null | undefined,
  base = at,
) => {
  let id = releaseId(source)
  if (!id || hasBase(html)) return page
  let rewrite = new HTMLRewriter()
  let move = (attr: string) => ({
    element: (el: {
      getAttribute(name: string): string | null
      setAttribute(name: string, value: string): void
    }) => {
      let ref = el.getAttribute(attr)
      if (!ref) return
      let next = assetUrl(ref, at, bare, id, platformPath, base)
      if (next != ref) el.setAttribute(attr, next)
    },
  })
  for (let [tag, attr] of LOADS) rewrite.on(`${tag}[${attr}]`, move(attr))
  rewrite.on('link[href]', {
    element: (el) => {
      if (linked(el.getAttribute('rel') ?? '', el.getAttribute('as') ?? '')) {
        move('href').element(el)
      }
    },
  })
  return rewrite.transform(page)
}

// What the browser may keep, and for how long. A new release moves the source
// pointer, so nothing here may be held past a revalidation: `no-cache` is
// "ask every time", not "do not store", and with an ETag beside it that ask
// is answered by a 304 carrying no bytes. `private` on an app that is not
// public keeps its pages out of every shared cache between here and the
// person reading them, which is the whole of the rule: a private app's bytes
// belong to its members and to no proxy.
//
// A file's validator is its content, and a page's is the document as sent
// (`woven`).
export let keeping = (app: App) =>
  `${app.access == 'public' ? 'public' : 'private'}, ` +
  'no-cache'

// The tag for a file's bytes, whose version arrives from files.ts (`VERSION`).
let etagOf = (version: string) => `"${version}"`

// The tag for a page: a hash of the document as sent, never of the bytes it
// was woven from. A page is its bytes plus what the platform weaves in at this
// mount (its base, its release's asset addresses, the app's colours, the
// platform's own tags), and any of those can move while the bytes stay put.
// Hashing what is sent is what keeps a refresh from being told it already
// holds a page it does not.
let pageTag = async (page: string) => `W/"${(await digest(page)).slice(0, 32)}"`

let unchanged = (req: Request, etag: string) =>
  (req.headers.get('if-none-match') ?? '').split(',')
    .some((t) => t.trim().replace(/^W\//, '') == etag.replace(/^W\//, ''))

let media = async (
  req: Request,
  got: Response,
  cache: string,
  whole: () => Promise<Response>,
) => {
  let type = got.headers.get('content-type') ?? 'application/octet-stream'
  let etag = etagOf(got.headers.get(VERSION) ?? '')
  let headers = { 'content-type': type, 'cache-control': cache, etag }
  if (unchanged(req, etag)) {
    await got.body?.cancel()
    return new Response(null, { status: 304, headers })
  }
  let ifRange = req.headers.get('if-range')
  if (got.status != 200 && ifRange && ifRange != etag) {
    await got.body?.cancel()
    got = await whole()
    if (got.status != 200) return null
    type = got.headers.get('content-type') ?? type
    etag = etagOf(got.headers.get(VERSION) ?? '')
    headers = { 'content-type': type, 'cache-control': cache, etag }
  }
  let length = got.headers.get('content-length')
  return new Response(got.status == 416 ? null : got.body, {
    status: got.status,
    headers: {
      ...headers,
      'accept-ranges': 'bytes',
      ...(length ? { 'content-length': length } : {}),
      ...(got.headers.has('content-range')
        ? { 'content-range': got.headers.get('content-range')! }
        : {}),
    },
  })
}

// The two addresses the kernel answers for an app that wrote neither file
// (T-34493), so the links @yaks/platform/woven `pinned` wove in are never
// dead. Both are the fallback and nothing more: an app with its own `icon.png`
// or its own `manifest.webmanifest` is served that, and one with an icon.svg
// is served its drawing (files.ts `icon`), because this is only reached where
// the files door had nothing.
//
// The icon is its space's logo, drawn square (logo.ts `logoIcon`, T-151744),
// so a church's or a shop's apps wear its picture on a home screen; or, in a
// space without one, the platform's connector tile — opaque, square, 512
// (site_test) — so an app on a home screen wears the platform's face rather
// than the browser's blank sheet. iOS fills a transparent icon with black,
// which is why the tile that carries its own ground is the right one to fall
// back to. A display mark (?display), what a list of apps shows beside each
// name, is the app's own first letter instead (@yaks/platform/monogram): a
// list of a space's apps all wearing its logo, often its owner's photo, tells
// none of them apart (T-2259).
export let unwritten = async (
  req: Request,
  env: Env,
  space: Space,
  app: App,
  path: string,
  at: string,
) => {
  if (path == '/icon.png') {
    if (new URL(req.url).searchParams.has('display')) {
      return new Response(monogram(app.title || app.slug, app.eid), {
        headers: {
          'content-type': 'image/svg+xml',
          'cache-control': keeping(app),
        },
      })
    }
    let logo = await logoIcon(env, space, app.eid)
    if (logo) {
      return new Response(logo.bytes as Uint8Array<ArrayBuffer>, {
        headers: { 'content-type': logo.type, 'cache-control': keeping(app) },
      })
    }
    let tile = await env.ASSETS.fetch(
      new Request(new URL('/connector-512.png', req.url)),
    )
    if (!tile.ok) return null
    return new Response(tile.body, {
      headers: { 'content-type': 'image/png', 'cache-control': keeping(app) },
    })
  }
  if (path != `/${MANIFEST}`) return null
  // The app's own colours (`app.theme`, set through `app_set`), or the
  // platform's where it named none — `manifesting` decides, off the row
  // already in hand, so this needs no trip to the app's own front page.
  return new Response(JSON.stringify(manifesting(app, at), null, 2), {
    headers: {
      'content-type': 'application/manifest+json',
      'cache-control': keeping(app),
    },
  })
}

// A folder asked for without its slash, sent to it: the location is relative,
// so it holds at any mount, and the query goes with it.
export let folderMove = (to: string, search: string, cache: string) =>
  new Response(null, {
    status: 307,
    headers: { location: to + search, 'cache-control': cache },
  })

// An app's `_redirects` (redirects.ts) answering a page's address: the visitor
// is sent on, to a path of the app at whatever mount it has, or to an address
// elsewhere. Read as any file is, through the cache, so an app with none costs
// a cached miss; its file answers by its own name, or the app's 404 or index
// did, which is no rules.
let redirected = async (
  req: Request,
  env: Env,
  app: App,
  prefix: string,
  path: string,
  at: string,
) => {
  let got = await files.fileBytes(
    env,
    app.eid,
    prefix,
    '/_redirects',
    app.source ?? '',
  )
  let rules = got.status == 200 && got.headers.get(files.FILE) == '_redirects'
    ? parseRedirects(await got.text())
    : (await got.body?.cancel(), [])
  let to = sentOn(rules, path, new URL(req.url).search)
  return to && new Response(null, {
    status: to.status,
    headers: {
      location: to.to.startsWith('/') ? at + to.to.slice(1) : to.to,
      'cache-control': keeping(app),
    },
  })
}

// The platform's scripts a page wears as the files door hands it: none when
// an app's worker asked for it, since what the worker answers is woven on its
// way out (`reported`), and the browser would run each script twice.
// Otherwise its badge is @yaks/platform/woven `badgeOf` and its bar `barOf`.
export let worn = (
  req: Request,
  space: Space,
  app: App,
  env: Host,
  who: Who,
): Scripts | null => bearing(req) ? null : wearing(req, space, app, env, who)

// What every page the door serves this caller wears. The release listener's
// and the pencil's doors are the app's own `api/` under its mount, unless the
// router said they are elsewhere for this browser (@yaks/platform/routes
// `API_AT`).
export let wearing = (
  req: Request,
  space: Space,
  app: App,
  env: Host,
  who: Who,
): Scripts => {
  let api = req.headers.get(API_AT)
  return {
    ...badged(space, app, env),
    ...cornerOf(space, app, env, who),
    ...api ? { api } : {},
    bar: barOf(env, app, who),
  }
}

/** The Operator's chat for this app, which the corner of its pages offers
 * with its note and pencil (public/edit.js), or null where it wears none: for whoever the file
 * door would not let write the app's files (`api`'s `/files/`). */
export let editOf = (space: Space, app: App, env: Host, who: Who) =>
  writes(who.role) && !who.guest && !sandboxed(app)
    ? `${hostUrl(env, chatPath(space.slug))}?app=${
      encodeURIComponent(app.slug)
    }`
    : null

/** What the corner of this app's pages offers (public/edit.js): the
 * Operator's chat for the app, which its pencil's edit mode asks in, and the
 * note, a page of yaks.app's own (operator-page.ts `notePage`), for whoever
 * {@link editOf} offers the chat. */
export let cornerOf = (space: Space, app: App, env: Host, who: Who) => {
  let edit = editOf(space, app, env, who)
  return {
    edit,
    note: edit &&
      `${hostUrl(env, managePath('operator', space.slug))}?note=${
        encodeURIComponent(app.slug)
      }`,
  }
}

/** Whether the person `req`'s session names would wear the pencil on the app
 * at `at` (`editOf`), from one read of the directory, the read a page of it
 * makes: Site serves such a person a page of the home app as it is served
 * them (site.ts `forward`), and everyone else the page it keeps. */
export let editing = async (
  req: Request,
  env: Env,
  at: { space: { slug: string }; app: { slug: string } },
) => {
  let person = await sessionPerson(req, env)
  if (!person) return false
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env), {
    copy: copyOf(env),
    time: env.CLOCK,
  })
  let [{ space, app, role }] = await Promise.all([
    dir.page(at.space.slug, at.app.slug, person),
    sessionReading(req, env, dir),
  ])
  if (!space || !app) return false
  let who = await whoIs(
    req,
    env,
    () => Promise.resolve(role ?? null),
    space.eid,
    dir,
  )
  return !!editOf(space, app, env, who)
}

/** Whom a page is the same for, where it is not everyone (page-cache.ts
 * `keep`): every stranger, or every person signed in with no seat here, who
 * are shown only what a stranger is. A member's page is theirs alone (a
 * writer's wears the pencil), so it is never kept. */
export let aloneOf = (who: Pick<Who, 'person' | 'role'>): Alone | null =>
  !who.person ? 'stranger' : !who.role ? 'outsider' : null

// A page served from a release compiled by a toolkit this platform has moved
// on from asks for that release to be made again as itself (toolkit.ts,
// remake.ts), after the page is answered: a later page imports the shared
// modules the toolkit makes now. Asked once per release by a kernel
// deployment (its assets binding); an ask that failed is asked again by the
// next page, so a release is never left stale by one refused write (a Store
// still on the last deploy's code refuses the remake's words until it moves).
let remakes = new WeakMap<Env['ASSETS'], Map<string, Promise<void>>>()
export let refresh = (
  env: Env,
  space: Space,
  app: App,
): Promise<void> | undefined => {
  let source = app.source
  if (!source) return
  let refreshed = remakes.get(env.ASSETS) ?? new Map<string, Promise<void>>()
  remakes.set(env.ASSETS, refreshed)
  if (refreshed.has(source)) return refreshed.get(source)
  // A refusal here is the platform's own write refused: every failure is ours.
  let work = (async () => {
    let { stale } = await import('./toolkit.ts')
    if (await stale(env, source)) {
      await (await import('./remake.ts')).ask(env, { app: app.eid, source })
    }
  })().catch((e) => {
    refreshed.delete(source)
    defect(e, { request: 'toolkit refresh', space: space.slug, app: app.slug })
  })
  refreshed.set(source, work)
  for (let old of refreshed.keys()) {
    if (refreshed.size <= 512) break
    refreshed.delete(old)
  }
  background(work)
  return work
}

// Whether the app's files hold `path` — a file, or a folder to send it to —
// asked of the bucket without reading the bytes. The app's own 404.html is
// not a page at the address asked.
let held = async (env: Env, space: Space, app: App, path: string) => {
  let decoded = decodedPath(path)
  if (decoded == null || fence.inside(decoded)) return false
  let got = await files.fileBytes(
    env,
    app.eid,
    prefixOf(space, app),
    path,
    app.source ?? '',
    null,
    'HEAD',
  )
  await got.body?.cancel()
  return got.status != 404
}

let asset = async (
  req: Request,
  env: Env,
  space: Space,
  app: App,
  who: Who,
  path: string,
  // Where this app is mounted for the browser that asked, which is what its
  // pages resolve their relative URLs against: `/<app>/`, or `/` when it is
  // the space's front page (T-33040). A sandboxed app's carries its page
  // token as its last segment (installed.ts), and `bare` is the same address
  // without it — what a manifest names, since a home screen keeps it.
  at: string,
  c: Clock,
  // The app's copy its page is filled with, read beside the page's bytes, or
  // null when it fills none (not a page, or a page its own worker asked for).
  copy: Promise<Copy | null> | null,
  bare = at,
  // A sandboxed app's page is woven these tags too: its storage (installed.ts
  // `stored`), asked for only once the file turns out to be a page.
  sandbox?: () => Promise<string>,
) => {
  let prefix = prefixOf(space, app)
  let decoded = decodedPath(path)
  if (decoded == null || fence.inside(decoded)) return nothingHere(env)
  // Asked beside the page's bytes, not before them: no page waits on it.
  let gone = fence.page(path)
    ? redirected(req, env, app, prefix, decoded, at)
    : null
  gone?.catch(() => {})
  let range = req.method == 'GET' ? req.headers.get('range') : null
  let got = await c.time(
    'bytes',
    () =>
      files.fileBytes(
        env,
        app.eid,
        prefix,
        path,
        app.source ?? '',
        range,
        req.method,
      ),
    // Whether that trip stopped at the edge or went on to the bucket, in the
    // same Server-Timing entry as the time it took: a slow `bytes` stage and a
    // fast one are the same call, and this is the word for which happened.
    (r) => r.headers.get('cf-cache-status'),
  )
  if (
    !['HIT', 'UPDATING', 'STALE'].includes(
      got.headers.get('cf-cache-status') ?? '',
    )
  ) {
    c.include(got.headers.get('server-timing'))
  }
  let sent = await gone
  if (sent) {
    await got.body?.cancel()
    return sent
  }
  // A folder asked for without its slash is sent to it (files.ts `resolve`),
  // keeping the query: the location is relative, so it holds at any mount.
  let to = got.status == 307 ? got.headers.get('location') : null
  if (to) {
    await got.body?.cancel()
    return folderMove(to, new URL(req.url).search, keeping(app))
  }
  // The app's own 404.html answering a page that is not there. With none,
  // the files hold nothing here, and the answer is the caller's: null.
  let lost = got.status == 404 && got.headers.has(files.FILE)
  if (![200, 206, 416].includes(got.status) && !lost) {
    await got.body?.cancel()
    return await unwritten(req, env, space, app, path, bare) ??
      (got.status == 404 ? null : nothingHere(env))
  }
  let type = got.headers.get('content-type') ?? 'application/octet-stream'
  if (!type.startsWith('text/html')) {
    return await media(
      req,
      got,
      keeping(app),
      () => files.fileBytes(env, app.eid, prefix, path, app.source ?? ''),
    ) ?? nothingHere(env)
  }
  // A sandboxed page is woven its person's saved keys (installed.ts
  // `stored`) and carries a token for them: it is sent whole every time, and
  // no cache on the way may keep it.
  //
  // A page an app's worker asked for (its own `env.FILES`, or the home app's
  // router passing a path on) reaches the browser inside the worker's answer,
  // which is woven the platform's scripts on its way out (`served`), so it
  // gets none here, or the browser would run each of them twice.
  let base = baseOf(at, got.headers.get(files.FILE) ?? '', !!app.rooted)
  refresh(env, space, app)
  let page = await c.time('render', async () =>
    woven(
      env,
      await got.text(),
      at,
      bare,
      app,
      sandbox ? await sandbox() : '',
      worn(req, space, app, env, who),
      base,
      req.headers.get(ADDRESS) ?? req.url,
      await copy,
    ))
  if (sandbox) {
    return new Response(page, {
      status: got.status,
      headers: { 'content-type': type, 'cache-control': 'private, no-store' },
    })
  }
  if (lost) {
    return new Response(req.method == 'HEAD' ? null : page, {
      status: 404,
      headers: { 'content-type': type, 'cache-control': keeping(app) },
    })
  }
  let headers = {
    'content-type': type,
    'cache-control': keeping(app),
    etag: await pageTag(page),
  }
  // The browser already has this page, so it is told so and sent none.
  if (unchanged(req, headers.etag)) {
    return new Response(null, { status: 304, headers })
  }
  return new Response(req.method == 'HEAD' ? null : page, { headers })
}

// The copy an app's pages are filled from: the copy.json of the files it
// serves, its release's, or in a preview its draft's (page-copy.ts). One that
// could not be read is reported, and the page is served as written.
export let copyFor = (env: Env, space: Space, app: App) =>
  appCopy(env, app.eid, prefixOf(space, app), app.source ?? '').catch((e) => {
    defect(e, { request: 'page copy', space: space.slug, app: app.slug })
    return null
  })

// A page as the browser gets it: the app's address before its own first
// relative URL, the tags a home screen needs, its release's asset addresses,
// any tags the caller adds, its copy filled in (page-copy.ts), and the
// platform's scripts (`worn`), left out when `scripts` is null. The weaving is
// done here rather than behind the cache because the same file is a different
// document at each mount, and one cached copy of the bytes serving every mount
// beats one copy per mount.
export let woven = async (
  env: Env,
  original: string,
  at: string,
  bare: string,
  app: App,
  tags: string,
  scripts: Scripts | null,
  base = at,
  address = hostUrl(env, at),
  copy: Copy | null = null,
) => {
  let own = pinned(
    at,
    mapped(original, at, bare, app.source, base),
    app,
    !local(app),
  )
  let page = filled(
    released(
      new Response(based(base, tags ? intoHead(own, tags) : own)),
      original,
      at,
      bare,
      app.source,
      base,
    ),
    copy,
  )
  if (scripts) {
    page = await reported(
      env,
      at,
      page,
      app.version ?? 0,
      scripts,
      appPreview(app, bare),
      address,
    )
  } else page = previewed(env, page, address, appPreview(app, bare))
  return await page.text()
}

let versionedAsset = async (
  req: Request,
  env: Env,
  app: App,
  source: string,
  path: string,
  c: Clock,
) => {
  let decoded = decodedPath(path)
  if (decoded == null || fence.inside(decoded)) {
    return json(404, 'no_such_file')
  }
  let range = req.method == 'GET' ? req.headers.get('range') : null
  let got = await c.time(
    'bytes',
    () =>
      files.fileBytes(env, app.eid, source, path, source, range, req.method),
    (r) => r.headers.get('cf-cache-status'),
  )
  if (![200, 206, 416].includes(got.status)) {
    await got.body?.cancel()
    return json(404, 'no_such_file')
  }
  if ((got.headers.get('content-type') ?? '').startsWith('text/html')) {
    await got.body?.cancel()
    return json(404, 'no_such_file')
  }
  return await media(
    req,
    got,
    browserImmutable,
    () => files.fileBytes(env, app.eid, source, path, source),
  ) ?? json(404, 'no_such_file')
}

// Where the browser sends what it notices on its own: the app's own report
// door at the address the browser asked (a custom domain's, carried here),
// named as an endpoint group, with nel asking for the failures that never
// reached us at all.
// A site's preview (newcomer.ts `previewing`) asks too that no search engine
// index or follow any of it.
let reporting = (
  res: Response,
  req: Request,
  at: string,
  app: Pick<App, 'preview'> | null,
) => {
  // A socket is not a page: the 101 carries the runtime's own `webSocket`,
  // which no Response constructor here can copy, and nothing about it reports.
  if (res.status == 101) return res
  let headers = new Headers(res.headers)
  if (app?.preview) headers.set('x-robots-tag', 'noindex, nofollow')
  headers.set(
    'reporting-endpoints',
    `yak="${
      new URL(`${at}api/report`, req.headers.get(ADDRESS) ?? req.url).href
    }"`,
  )
  headers.set(
    'nel',
    '{"report_to":"yak","max_age":86400,"success_fraction":0,' +
      '"failure_fraction":1}',
  )
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}

// Reports per app per minute (@yaks/tracker/report `flood`): a page in a
// render loop that throws every frame must not write a thousand entities a
// second.
let over = flood(30)
let flooding = (space: Space, app: App) => over(`${space.eid}/${app.eid}`)

/** Whether a request reads one of the app's files by its address: an upload
 * (`/api/blob/<sha>` or `/api/blob/<sha>/<representation>`), a release's
 * asset (`/api/assets/<release>/<path>`) or a platform module its pages
 * import (@yaks/platform/kept `fixed`). Bytes, not the app's data. */
let fileRead = (req: Request, path: string) =>
  (req.method == 'GET' || req.method == 'HEAD') &&
  (path.startsWith('/api/blob/')
    ? !!addressed(path.slice('/api/blob/'.length))
    : fixed(path))

/** Whether the API door admits a request before any store traffic. Addressed
 * files are static reads, even when this stranger has exhausted API_RATE. */
export let apiAllowed = (
  req: Request,
  path: string,
  person: string | null,
  itself: boolean,
  limit: Limiter | undefined,
): Promise<boolean> =>
  itself || person || fileRead(req, path)
    ? Promise.resolve(true)
    : within(limit, source(req), failing('rate limit'))

// What to call this person, for the store to write beside their rows: the
// write door's half of the vouch (session.ts `titling`), over this door's own
// directory. An app writing as itself (dispatch.ts `owning`, `env.APP`) is not
// a person, so the directory is not asked to name one — the store knows the
// app it holds and writes no person row for it (graph.ts `#vouching`).
export let named = (env: Env, who: Who, app?: App) =>
  app && itsApp(who, app)
    ? Promise.resolve({} as Record<string, string>)
    : titling(
      directory(bound(env.DIRECTORY, dirPart.fetch, env), {
        copy: copyOf(env),
        time: env.CLOCK,
      }),
      who.person,
    )

// What a write answers, either way it was routed: the entities it touched, and
// the aliases the batch minted for the `$alias` names it was written with. One
// shape for both paths, so a caller never has to know which one ran.
type Wrote = { entities: string[]; aliases: Record<string, string> }

// The app's two acts, as one person: what a page does through the doors
// below, without a page. An app's own MCP tools are templates over exactly
// these (@yaks/tools/declared, T-32685), so a tool call goes the page's way — the
// app's `access` decides it, the vouched headers name the writer, the listing
// rule shapes the answer — and a refusal is the sentence a page would read.
// Anything a tool can do here, the person calling it could do on the page.
export let acting = (env: Env, space: Space, app: App, who: Who) => {
  let store = appStore(env.STORE, space, app, env)
  // Signed in and refused, it is the owner's to grant, so the sentence says
  // so; nobody reaches this door signed out, since the agent door has an
  // identity before it has a call (mcp.ts).
  let no = (what: string): never => {
    throw refuse('access', who.person ? MEMBER[what] : SAYS[what])
  }
  return {
    apply: async (mutation: unknown) => {
      if (!edits(mode(app.access), who.role)) no('not_a_writer')
      // A word this app uses lives in another app's store (T-32728), and
      // its store splits a bundle naming one the way the agent door does: the
      // borrowed word to its home, everything else there (graph.ts `#across`).
      let applied = await metaOf(store).apply(
        batched(mutation),
        { ...vouched(who), ...await named(env, who), [ACROSS]: '1' },
      )
      return {
        entities: [...new Set(applied.map((b) => b.entity.eid))],
        aliases: minted(applied),
      }
    },
    query: (line: string) => {
      if (!reads(mode(app.access), who.role)) no('not_a_reader')
      return queried(env, space, app, who, lined(line))
    },
  }
}

// These routes use the directory app and the caller's standing there.
let appDoor = async (
  asked: Asked,
  dir: ReturnType<typeof directory>,
  c: Clock,
  mount: string,
  worker: (req: Request) => Promise<Response | null>,
): Promise<Response | null> => {
  let { env, req, path, space, app, who, refuse, json } = asked
  let mayUse = reads(mode(app.access), who.role)
  let versioned = assetPath(path)
  if (versioned) {
    if (req.method != 'GET' && req.method != 'HEAD') {
      return json(405, 'method_not_allowed')
    }
    // A release's module asking for `./api/client.js` is sent back out to the
    // app's API. Where it is sent never changes for that address, so the
    // browser keeps the hop instead of asking again on every load.
    let out = apiOut(versioned.path)
    if (out) {
      return new Response(null, {
        status: 302,
        headers: {
          location: out + new URL(req.url).search,
          'cache-control': browserImmutable,
        },
      })
    }
    let source = `${space.store}/.releases/${app.eid}/${versioned.release}`
    // On a private app the worker is the gatekeeper (T-34303): a page it
    // serves to someone who may not read the app was woven these addresses,
    // and its files are the worker's to give or refuse at their own path, as
    // that page would have asked before its addresses were the release's.
    // The release a published app offers is anyone's, as installing it hands
    // it out (`offered`), so Site can keep it (@yaks/platform/kept
    // `keepable`). Every other release is its own people's, a stranger's
    // sample visit included.
    if (!mayUse && source != await offeredSource(dir, app)) {
      let url = new URL(req.url)
      url.pathname = url.pathname.slice(0, -`/api${path}`.length) +
        versioned.path
      let own = await c.time('worker', () => worker(new Request(url, req)))
      if (own && own.status != 404) return own
      await own?.body?.cancel()
      return refuse('not_a_reader')
    }
    if (mayUse && source != app.source && !await dir.released(app, source)) {
      return json(404, 'no_such_file')
    }
    return versionedAsset(req, env, app, source, versioned.path, c)
  }
  if (path == '/release') {
    if (req.method != 'GET') return json(405, 'method_not_allowed')
    if (!mayUse && !app.published) return refuse('not_a_reader')
    let value = new URL(req.url).searchParams.get('version')
    let version = value == null || !/^[0-9]+$/.test(value) ? NaN : Number(value)
    if (!Number.isSafeInteger(version)) return json(400, 'invalid_version')
    let { releaseStatus } = await import('./release-status.ts')
    let said = await releaseStatus(env, dir, app, version, !mayUse)
    if (!said) return json(404, 'no_such_release')
    return Response.json(said, { headers: { 'cache-control': 'no-store' } })
  }
  if (path == '/service' || path.startsWith('/service/')) {
    if (!mayUse && !(path == '/service/verify' && itsApp(who, app))) {
      return refuse('not_a_reader')
    }
    let { serviceRoute } = await import('./service-api.ts')
    return serviceRoute(req, env, dir, { space, app }, who, path)
  }
  // `at` names a source outside the app (an MCP server, a connection, an app
  // service): the pool uses the person's grants and the connections the
  // app's space opened to this caller (declared.ts `grants`).
  let sourced = async () => {
    if (who.service) {
      throw new CallError('access', 'Sign in to use what you connected')
    }
    let { listCommands, runCommand } = await import('./declared.ts')
    let ctx: PoolCtx = {
      env,
      dir,
      person: who.person,
      app: { space, app, level: who.role },
    }
    return {
      list: (at: string) => listCommands(ctx, at),
      run: (at: string, name: string, args: Record<string, unknown>) =>
        runCommand(ctx, at, name, args),
    }
  }
  // Where an app sends the person using it to allow it what they connected:
  // their own connections page at the platform's address, which asks them
  // at its top, since the app's own address may not grant itself anything.
  // It names no hash: that page's hash is the address of a dialog.
  if (path == '/allow') {
    let to = new URL(hostUrl(env, '/manage/connections'))
    to.searchParams.set('grant', app.eid)
    to.searchParams.set('at', new URL(req.url).searchParams.get('at') ?? 'mcp:')
    return Response.redirect(to.href, 303)
  }
  if (path == '/commands') {
    if (req.method != 'GET') return json(405, 'method_not_allowed')
    if (!mayUse) return refuse('not_a_reader')
    let at = new URL(req.url).searchParams.get('at')
    if (at == null) return Response.json(await commandsIn(env, space, app, who))
    try {
      return Response.json(await (await sourced()).list(at))
    } catch (e) {
      return rejection(e, {
        request: 'GET /api/commands',
        space: space.slug,
        app: app.slug,
      })
    }
  }
  if (path == '/command') {
    if (!mayUse) return refuse('not_a_reader')
    // A page reads what the command said; whether an Operator hears it as
    // outsiders' words (`heard`) is the Operator's alone.
    let said = ({ text, value }: Reply) => ({ text, value })
    let [route] = commandRoutes({
      command: async (name, args, at) =>
        at != null ? await (await sourced()).run(at, name, args) : said(
          await commandIn(
            env,
            space,
            app,
            who,
            name,
            args,
            acting(env, space, app, who),
          ),
        ),
    })
    return route.handle(req)
  }
  let door = DOORS.get(path.split('/')[1])
  let mine = door && await (await door())(asked)
  if (mine) return mine
  // Taking money (sell.ts, T-34525). A read door as far as this app is
  // concerned — it reads the products the cart names and writes nothing — so it
  // asks `mayUse` and not a writer's level: a public shop sells to a stranger,
  // which is what a shop is, and a private one sells to its members. It is
  // keyed on the app like the doors above, so a visit holds no level here: the
  // store a visit reads is a copy whose prices the visitor may have written.
  // The price comes off the app's own rows, never off the request, so what a
  // who can do here is buy what the seller put on the shelf at the price
  // the seller wrote.
  if (path == '/pay/checkout') {
    if (req.method != 'POST') return json(405, 'method_not_allowed')
    if (!mayUse) return refuse('not_a_reader')
    let body = await req.json().catch(() => null)
    return buying(
      env,
      {
        space,
        app: app.slug,
        root: urlOf(space, app),
        buyer: who.service?.person ?? who.person,
        via: who.via,
        source: who.service?.app ?? app.eid,
        merchant: who.person == app.eid,
      },
      body,
    )
  }
  if (path.startsWith('/files/')) {
    if (req.method != 'PUT') return json(405, 'method_not_allowed')
    // The file door is never widened (public/docs/sharing.md): a guest of
    // this app writes its data and never its bytes, whatever level the grant
    // gave them. An app takes a guest's rows and never a guest's deploy.
    //
    // Nor is a sandboxed app's (installed.ts): its API hears only its page
    // token, and that token is the page's — writing the app's code stays a
    // member's act through the tools, never something its own page does.
    if (!writes(who.role) || who.guest || sandboxed(app)) return refuse()
    // Into the draft as app_files writes: a file the draft already holds as
    // sent is not sent again.
    let file = decodedPath(path.slice('/files/'.length))
    if (file == null) return nothingHere(env)
    try {
      let { drafted, fullAt, hashed } = await import('./tools.ts')
      let sent = await hashed([{
        path: file,
        bytes: new Uint8Array(await req.arrayBuffer()),
      }])
      let stopped = await fullAt(env, space, sent)
      if (stopped) return json(413, 'space_full', stopped)
      await drafted(env, space, app, who, sent)
    } catch (e) {
      return rejection(e, {
        request: 'PUT /api/files',
        space: space.slug,
        app: app.slug,
      })
    }
    return Response.json({ ok: true, key: file })
  }
  // Save in edit mode (save.ts): the person's drafted snippets set in the
  // app's copy.json and released, and Undo taking that release back. Writing
  // the app's files and releasing them is the file door's member's act, held
  // as that door holds it.
  if (path == '/save' || path == '/save/undo') {
    if (req.method != 'POST') return json(405, 'method_not_allowed')
    if (!writes(who.role) || who.guest || sandboxed(app)) return refuse()
    try {
      let sent = await req.json().catch(() => ({})) as {
        copy?: unknown
        version?: unknown
      }
      let { saved, snippets, undone } = await import('./save.ts')
      let ctx = { env, dir, person: who.person!, clock: c }
      let store = appStore(env.STORE, space, app, env)
      return Response.json(
        path == '/save'
          ? await saved(ctx, space, app, who, store, snippets(sent?.copy))
          : await undone(ctx, space, app, who, store, sent?.version),
      )
    } catch (e) {
      return rejection(e, {
        request: `POST /api${path}`,
        space: space.slug,
        app: app.slug,
      })
    }
  }
  // Publishing a file to anyone (public-files.ts) is the same member's act as
  // writing the app's files, and listing them is too: what this app put on
  // the public web is its members' business.
  if (path == '/public' || path.startsWith('/public/')) {
    if (!writes(who.role) || who.guest || sandboxed(app)) return refuse()
    return await publicDoor(
      { req, env, dir, space, app, at: mount },
      path.slice('/public'.length),
    )
  }
  return null
}

let apiAsk = (
  req: Request,
  env: Env,
  dir: ReturnType<typeof directory>,
  space: Space,
  app: App,
  path: string,
  who: Who,
): Asked => ({
  req,
  env,
  path,
  space,
  app,
  who,
  json,
  refuse: async (what = 'not_a_writer') =>
    who.person
      ? json(403, what, await refusedSaid(dir, space, app, who.person, what))
      : json(
        401,
        what,
        SAYS[what],
        signInAt(req.headers.get('referer') || req.url, env),
      ),
})

let api = async (
  req: Request,
  env: Env,
  dir: ReturnType<typeof directory>,
  space: Space,
  served: { app: App; who: Who },
  source: { app: App; who: Who },
  path: string,
  c: Clock,
  mount: string,
) =>
  await appDoor(
    apiAsk(req, env, dir, space, source.app, path, source.who),
    dir,
    c,
    mount,
    // A rewritten asset path can still be the worker's own route, served
    // just as if the browser requested it directly.
    (request) => ran(env, space, served.app, request, served.who),
  ) ??
    await storeApi(req, env, dir, space, served.app, path, served.who, c, mount)

// The graph and its uploaded files use the store and standing of the visit.
export let storeApi = async (
  req: Request,
  env: Env,
  dir: ReturnType<typeof directory>,
  space: Space,
  app: App,
  path: string,
  who: Who,
  c: Clock,
  mount: string,
) => {
  // The store client and its named modules come from the platform's assets.
  if (path == '/client.js') return platformFile(req, env, '/_client.js')
  if (NAMED_CLIENT.test(path)) return namedClient(req, env, path)
  if (CLIENT.includes(path)) return platformFile(req, env, path)
  let { refuse: refused } = apiAsk(req, env, dir, space, app, path, who)
  let store = appStore(env.STORE, space, app, env)
  // What the page (or the browser itself) says broke, filed as the app's
  // (@yaks/tracker/report `door`). A no somebody answered on purpose is not a
  // break, whoever answered it: the platform's own doors, or the app's worker
  // relaying an outside service's refusal (unseen.ts `refusal` is the one
  // rule). A break whose page named no version ran the one serving, read past
  // the directory's cache.
  if (path == '/report') {
    return reportDoor({
      refusal,
      flooding: () => flooding(space, app),
      serving: () => serving(env, space, app),
      file: (broke) => noted(broke, { env, space, app, request: req }),
    })(req)
  }
  let headers = vouched(who)
  if (
    app.lenses &&
    ['/apply', '/query', '/ws', '/vocab', '/vocab.json'].includes(path)
  ) {
    try {
      Object.assign(
        headers,
        await c.time(
          'speaks',
          async () =>
            (await import('./lenses.ts')).pageSpeaks(
              req,
              dir,
              r2Objects(env.BLOBS),
              space,
              app,
              (await import('./vocab.ts')).appDoc,
            ),
        ),
      )
    } catch (e) {
      return rejection(e, {
        request: 'page vocabulary',
        space: space.slug,
        app: app.slug,
      })
    }
  }
  let mayRead = reads(mode(app.access), who.role)
  let mayPost = edits(mode(app.access), who.role)
  // Who is looking, before the first write (T-32679), as @yaks/api's `/who`
  // answers it: the actor the store signs this caller's writes as, and beside
  // it their standing here. A page could only learn this from a refusal,
  // which is too late twice over: on an `open` app a signed-out write has no
  // `created.by`, so the page must ask a guest their name and nothing said
  // so; on a `public` one the sign-in bounce arrives after the guest typed,
  // and their work goes with them (C-32675 items 5 and 6). `person` is null
  // signed out, `name` is what to call them (never an address — T-32654),
  // `reads`/`writes` are this app's own access answered for this caller, and
  // `signIn` is where a signed-out visitor signs in, holding this page as its
  // return address — null once they are in. `invited` is what a refusal would
  // tell a signed-in friend the owner let in (WAITING): their way through is
  // the click in the letter, so the page can say so before they type rather
  // than offer them nothing (T-124071). `visit` is null unless this is a
  // stranger served the app from its sample or a store of their own
  // (visit.ts), when `kept` says whether that store is an app of theirs yet:
  // an app can word its own prompt to keep what they made, beside the
  // platform's bar. Answered to anyone: a stranger learning they must sign in
  // is the point. `/me` is the same door by the name shipped pages ask it by
  // (@yaks/platform/client.js `me()` before it asked `who`, and store.md's).
  if (path == '/who' || path == '/me') {
    return await whoDoor({
      authenticate: () => writer(new Request(req.url, { headers })),
      standing: async () => {
        let person = who.person
        // Asked together, so they travel as one trip (directory-copy.ts
        // `gathered`): each in turn was a round trip of the page's first
        // wait.
        let [name, invited, join] = await Promise.all([
          person ? dir.nameAt(person) : null,
          invitedHere(dir, space, app, person, mayRead, mayPost),
          // The role pressing Join gives them, where the app's own rows list
          // them and it is more than they hold (join.ts), else null.
          joinable(env, dir, space, app, who),
        ])
        return {
          person,
          name,
          role: who.role,
          reads: mayRead,
          // A stranger reading the sample writes, and their first write gives
          // them a store of their own (visit.ts).
          writes: mayPost || onSample(app),
          signIn: person
            ? null
            : signInAt(req.headers.get('referer') || req.url, env),
          invited,
          join,
          visit: who.visit ?? null,
        }
      },
    })(req)
  }
  // Joining an app whose own rows list them (join.ts): signed in, and the
  // rows asked again here rather than taken from the page that offered it.
  // A browser's form lands back on the app; anything else hears the role.
  if (path == '/join') {
    if (req.method != 'POST') return json(405, 'method_not_allowed')
    if (!who.person) return await refused('not_a_reader')
    let role = await joinable(env, dir, space, app, who)
    if (!role) return json(403, 'not_listed')
    await join(env, dir, space, app, who.person, role)
    return req.headers.get('accept')?.includes('text/html')
      ? redirect(mount, 303)
      : Response.json({ joined: role })
  }
  if (path == '/graph') {
    if (!mayRead) return refused('not_a_reader')
    let r = await store.consume(
      '/graph',
      readOr((res) => res.json() as Promise<Record<string, unknown>>),
      {},
      headers,
    )
    if ('failed' in r) return r.failed
    return Response.json({ ...r.read, person: who.person, role: who.role })
  }
  if (path == '/trash' || path == '/trash/restore') {
    if (!who.person || !['owner', 'editor'].includes(who.role ?? '')) {
      return refused('not_a_writer')
    }
    let read = path == '/trash'
    if (req.method != (read ? 'GET' : 'POST')) {
      return json(405, 'method_not_allowed')
    }
    return store(
      path + new URL(req.url).search,
      read ? {} : {
        method: 'POST',
        body: req.body,
      },
      headers,
    )
  }
  // The vocabulary a page's local graph loads: this store's words and the
  // borrowed words its own manifest uses, from their component homes, as
  // documents (`vocab.json`) or with the keywords they are written in.
  if (path == '/vocab') {
    if (req.method != 'GET') return json(405, 'method_not_allowed')
    if (!mayRead) return refused('not_a_reader')
    return store('/api/vocab', {}, { ...headers, [ACROSS]: '1' })
  }
  if (path == '/vocab.json') {
    if (!mayRead) return refused('not_a_reader')
    return store('/vocab.json', {}, { ...headers, [ACROSS]: '1' })
  }
  if (path == '/query') {
    if (!mayRead) return refused('not_a_reader')
    // The page writes its filter as the query string itself, or escaped once
    // as `?q=`, and either way in the page's grammar (`id=`, `limit=`), which
    // @yaks/platform/page-wire `lineOf` turns into the Store's line. The ask
    // then carries the listing's own screen (listing.ts `asking`), so what a
    // count counts is what a list lists.
    try {
      let url = new URL(req.url)
      let line = lineOf(url)
      if (line == null) throw new Refused('/query needs a query: ?q=…')
      let live = url.searchParams.get('live') == '1'
      return Response.json(
        await queried(env, space, app, who, line, live, headers),
      )
    } catch (e) {
      // A page's query is app code, even when the store answers its invalid
      // grammar or unknown word with 400. Other refusals stay quiet; platform
      // failures keep their own reporting.
      await mistake(req, env, space, app, e, 'query')
      return rejection(e, {
        request: 'GET /api/query',
        space: space.slug,
        app: app.slug,
      })
    }
  }
  // A page listens to its store, which answers a watch of another app's word
  // across that word's home, told by the home of each commit (graph.ts
  // `#lending`). The handshake is a read, and writes use /apply.
  if (path == '/ws') {
    if (req.headers.get('upgrade') != 'websocket') {
      return json(426, 'expected_websocket')
    }
    if (!mayRead) return refused('not_a_reader')
    return store('/ws', req, headers)
  }
  if (path == '/choose') {
    if (req.method != 'POST') return json(405, 'method_not_allowed')
    // An open visitor can edit game rows, not pick the account's generated
    // media. This is the same editor-only door the connector offers.
    if (!who.person || !['owner', 'editor'].includes(who.role ?? '')) {
      return refused()
    }
    let body = await req.json() as { output?: unknown }
    if (typeof body.output != 'string') return json(400, 'output_required')
    try {
      let { callStored } = await import('./package-tools.ts')
      let [answer] = await callStored(
        store,
        'builder_choose',
        { output: body.output },
        who,
        { title: await named(env, who) },
      )
      return Response.json({
        output: (answer.content as { body: string }).body,
      })
    } catch (e) {
      return rejection(e, {
        request: 'POST /api/choose',
        space: space.slug,
        app: app.slug,
      })
    }
  }
  if (path == '/apply') {
    let check: boolean
    try {
      check = writeOptions(req).check
    } catch (e) {
      return refusedOptions(e)
    }
    if (req.method != 'POST') return json(405, 'method_not_allowed')
    if (!mayPost) return refused()
    if (req.headers.get('content-type')?.split(';')[0].trim() == BINARY) {
      let body = await req.arrayBuffer()
      let stopped = await full(env, space, body.byteLength)
      if (stopped) return json(413, 'space_full', stopped)
      return store(`/apply${check ? '?check=1' : ''}`, {
        method: 'POST',
        body,
        headers: { 'content-type': BINARY },
      }, { ...headers, ...resend(req), ...(await named(env, who, app)) })
    }
    let body = await req.text()
    // The free tier's byte ceiling (T-32758). Data costs money to hold, so
    // this is a refusal — one the page shows in the platform's own sentence,
    // the way it shows every other.
    let stopped = await full(env, space, body.length)
    if (stopped) return json(413, 'space_full', stopped)
    // A bulk load says so in its content-type: one bundle per line, applied in
    // chunks of 50 and answered a line at a time (@yaks/api `pour`). It is
    // handed to the store as it came and its answer handed back the same way —
    // the page's envelope is a shape for one batch, and this is a file. So this
    // door only counts the bytes, which is the one thing the store cannot.
    if ((req.headers.get('content-type') ?? '').includes('ndjson')) {
      return store(`/apply${check ? '?check=1' : ''}`, {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/x-ndjson' },
      }, { ...headers, ...(await named(env, who, app)) })
    }
    // A page that sends the write again after a 202 names it, and the store
    // answers the resend as it answered the first (@yaks/api/log `first`) rather
    // than keeping a second copy that its guards refuse once the first lands.
    // Each wire in, the same wire out (@yaks/platform/page-wire): the page's
    // envelope is answered `{ok, aliases, bundles}`, and the Store's bare
    // array, which a page keeping its own copy sends, is answered with the
    // batch as applied.
    let sent: unknown
    try {
      sent = JSON.parse(body)
      let applied = await metaOf(store).apply(batched(sent), {
        ...headers,
        ...(await named(env, who, app)),
        ...resend(req),
        [ACROSS]: '1',
      }, { check })
      return Response.json(
        receipt(sent, applied),
      )
    } catch (e) {
      // Kept by the store's write log (@yaks/api/log): the page's edit is safe
      // and lands when the app recovers, so it is not told it failed. Nothing
      // is applied yet, so the Store's wire hears an empty batch.
      if (e instanceof Pending) {
        return Response.json(
          Array.isArray(sent) ? [] : {
            ok: true,
            pending: true,
            message: e.message,
            aliases: {},
            bundles: [],
          },
          { status: 202, headers: waited(e) },
        )
      }
      // A write the store's words cannot keep is the page's code wrong about
      // its own vocabulary. Every other no here (a name somebody holds, a
      // bound the schema sets, access, a pace) was meant.
      await mistake(req, env, space, app, e, 'apply')
      return rejection(e, {
        request: 'POST /api/apply',
        space: space.slug,
        app: app.slug,
      })
    }
  }
  // What a sandboxed page keeps in localStorage (installed.ts,
  // public/storage.js): the person's own keys in this app's store, never
  // graph rows, which the app's other readers could query. Anybody who may
  // read the app keeps their own; a visitor who is not signed in keeps
  // theirs in the page alone.
  if (path == '/storage') {
    if (!who.person) return refused('not_a_reader')
    if (!mayRead) return refused('not_a_reader')
    if (req.method != 'GET' && req.method != 'POST') {
      return json(405, 'method_not_allowed')
    }
    return store('/storage', {
      method: req.method,
      body: req.method == 'POST' ? await req.text() : undefined,
    }, headers)
  }
  // The file door: bytes in, one content-addressed address out. Uploaded
  // bytes are app data, not the app's own files — a vote page's photo is the
  // visitor's, not the deploy's — so the app's `access` governs both halves:
  // its write rule the upload, its read rule the download. Deleting is the
  // content row's: its bytes follow it out (`delete_upload`), so whoever may
  // delete that row deletes the file, and this door takes no DELETE.
  // Who may upload (app-authority.ts `uploadFloor`), held here before any
  // bytes are kept, as the store's guard holds the rows that name them.
  let unfloored = async () => {
    let denied = await belowFloor(env, space, app, who)
    return denied
      ? rejection(
        denied,
        {
          request: 'POST /api/blob',
          space: space.slug,
          app: app.slug,
        },
      )
      : null
  }
  if (path == '/blob' || path.startsWith('/blob/')) {
    let writes = req.method == 'POST' || req.method == 'PUT'
    let looks = req.method == 'GET' || req.method == 'HEAD'
    if (path == '/blob' ? req.method != 'POST' : !writes && !looks) {
      return json(405, 'method_not_allowed')
    }
    // A form's uploads are the app's own, whoever sends them (forms.ts).
    let form = path == '/blob' && new URL(req.url).searchParams.has('form')
    if (form) {
      let denied = await (await import('./forms.ts')).formUpload(req, store)
      if (denied) return denied
    } else if (writes) {
      if (!mayPost) return refused()
      let below = await unfloored()
      if (below) return below
    } else if (!mayRead) return refused('not_a_reader')
    return await blobDoor(req, env, space, app, store, path, {
      reader: headers,
      writer: async () =>
        form ? headers : { ...headers, ...await named(env, who, app) },
    })
  }
  return json(404, 'not_found')
}

// The space's own address, listed: every app this person may open, and how
// many they may not. What a stranger must never learn is the name of a
// private app, so the filter is per app and it is `reads` — the same question
// the file door asks before it serves a page (T-33040).
//
// For its owner this is also where a fresh sign-in lands (T-34233), so it
// carries the two things the sign-in card stopped asking — what to call them
// and where their apps live — and the connect instructions, open until an
// agent has ever been let in as them (T-34236).
// A space's apps, the ones in the trash left in (only its owner is shown
// those), and the ones whoever is asking may open. An app before its first
// release answers nothing at its address (facets/pages-graph.ts), so only
// those who may write it are shown it.
export let shelf = (apps: App[], space: Space, who: Who) => {
  let here = apps.filter((a) => !kernels(space.slug, a.slug))
  let all = here.filter((a) =>
    !a.trashed && (writes(who.role) || !!a.version || !!a.publishing?.length)
  )
  let mine = all.filter((a) => reads(mode(a.access), who.role))
  return { here, all, mine }
}

// A space's front door at `/`, when no app answers there (rung 4): its apps,
// as whoever is asking may see them, and to its owner the way to its
// dashboard. The apps and the asker's seat are the route's own read
// (directory.ts `page`), so the listing waits on no directory read of its own.
// It says whom it is the same page for (page-cache.ts `keep`): every
// stranger, or every person signed in with no seat here, who are shown only
// what a stranger is; a member's is theirs.
export let index = async (
  req: Request,
  env: Env,
  space: Space,
  apps: App[],
  seatOf: (person: string) => Promise<Role | null>,
  dir?: Directory,
): Promise<{ page: Response; alone: Alone | null }> => {
  let who = await whoIs(req, env, seatOf, space.eid, dir)
  let { all, mine } = shelf(apps, space, who)
  let owner = who.role == 'owner'
  let alone = aloneOf(who)
  let page = spaceIndex({
    space: space.slug,
    title: space.title,
    // What the pill says about the gallery (gallery.ts, T-34476). Listed is
    // said to anybody — it is a public page — and waiting only to the owner,
    // who is the one it is news for.
    apps: mine.map((a) => ({
      eid: a.eid,
      slug: a.slug,
      title: a.title,
      home: a.home,
      access: a.access,
      gallery: owner || standing(a) == 'listed' ? pilled(standing(a)) : '',
    })),
    hidden: all.length - mine.length,
    role: who.role,
    person: !!who.person,
    signIn: signInAt(req.url, env),
    manage: owner ? manageAt(space.slug, 'apps', env) : undefined,
  }, env)
  return { page, alone }
}

// A space's robots file where none of its apps has one (rung 4): crawl it all,
// and read the sitemap that lists its listed apps (seo.ts `spaceRobots`).
let robotsOf = async (env: Env) =>
  new Response((await import('./seo.ts')).spaceRobots(env), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })

// A space in the trash, at any of its addresses (erase.ts, T-34431). Nothing
// under it serves — not an app, not a file, not a store door — so this stands
// ahead of every rung of `served` below, and what it answers is what a wrong
// address answers. Its owner is the exception: they are told where their
// space went and given the button back, because they are the only person the
// news belongs to.
//
// The restore button lands on a new chat in the space, at the apex: a custom
// domain of a space that was in the trash a second ago is a hostname that has
// to warm up again.
export let closed = async (
  req: Request,
  env: Env,
  dir: ReturnType<typeof directory>,
  space: Space,
): Promise<Response> => {
  let who = await whoIs(
    req,
    env,
    (p) => dir.role(space, p),
    space.eid,
    dir,
  )
  if (who.role != 'owner' || !who.person) return nothingHere(env)
  if (req.method != 'POST') {
    return spaceBinned({
      slug: space.slug,
      title: space.title,
      days: daysLeft(space.trashed!),
    }, env)
  }
  let form = await req.formData().catch(() => new FormData())
  if (String(form.get('restore-space') ?? '').trim() == space.slug) {
    await (await import('./erase.ts')).untrashSpace(env, dir, space, who)
  }
  return redirect(hostUrl(env, chatPath(space.slug)), 303)
}

// Rung 1½ (D-34197): the home app is the space's router, and `home.first`
// names the paths its worker sees before the app whose slug owns them. Null is
// "the order is unchanged" — no home app, no glob over this path, or a router
// that passed, threw or hung (dispatch.ts `ahead`, which fails open).
//
// The kernel's own paths are never routed, whatever the property holds
// (router.ts PLATFORM_PATHS): `app_set` refuses a glob that names one, and
// this is that same rule again at the door, since the graph tier writes the
// property too and a `/garden/*` an owner wrote in good faith already covers
// `/garden/api/query`.
//
// `home` is the app wearing `home`, globs and all, as routing read it beside
// the addressed app (directory.ts `routing`), and null for the spaces that
// have no front page at all.
// Whether the home app's router asked to see this path first (`home.first`),
// which it never may for a platform path.
let claims = (home: App | null, path: string): home is App =>
  !platformPath(path) &&
  !!home?.first.some((g) => covers(g, path))

let firstly = async (
  env: Env,
  space: Space,
  home: App | null,
  req: Request,
  who: Who,
  c: Clock,
) => {
  if (!claims(home, new URL(req.url).pathname)) return null
  // The app comes back beside the answer because the answer is the HOME app's
  // and the address is another app's: a page view is counted against whoever
  // actually served it (views.ts).
  let page = await c.time('first', () => ahead(env, space, home, req, who))
  if (page && page.status < 400) scheduleBy(env, who, home.eid)
  return page && { page, app: home }
}

/** An address as Site keeps it (page-cache.ts): served to nobody, fresh.
 * A page Site draws around it reads the directory through its own `view`,
 * so the two share one trip and one stall's deadline, and its staleness. */
export let edged = async (req: Request, env: Env, view?: Directory) => {
  let copied = false
  let c = clock()
  let answer = await c.counting(async () =>
    timed(
      await served(
        req,
        env,
        c,
        true,
        () => {
          copied = true
        },
        req,
        view,
      ),
      c,
      'site_',
    )
  )
  if (copied) answer.headers.set('x-yak-directory-copy', '1')
  return answer
}

// A release check (public/release.js, `/api/release`) reads which release is
// out and uses no instrument, so it hands none out: the home app's is asked
// at the apex (apex.ts), where a cookie would make every visitor one Site no
// longer treats as a stranger (@yaks/platform/kept `stranger`).
let checking = (path: string) => /^(?:\/[^/]+)?\/api\/release$/.test(path)

export let fetch = (req: Request, env: Env): Promise<Response> => {
  let c = clock()
  // Inside `counting`, so every store hop and bucket op the chain below makes
  // is counted on this request's own tally (hops.ts) and reported beside the
  // stages it took.
  return c.counting(async () => {
    // Every request gets a verified browser instrument before any app code
    // runs. Page tokens and machine credentials have their own instrument
    // and may arrive with the ambient cookie stripped: never replace that
    // unseen cookie with a signed-out one, even on a failed token or redirect.
    // Bytes the same for everyone (@yaks/platform/kept `fixed`) set none
    // either: a cookie would keep them out of every cache, and no door of
    // theirs uses the instrument.
    // Nor does a release check (`checking`).
    // The browser's own cookies are kept, and told which stores it holds
    // (visit.ts `ownOf`), only where it is the browser asking.
    let path = new URL(req.url).pathname
    let remember = !pagePath(path) && !bearing(req) &&
      !req.headers.has('authorization') && !fixed(path) && !uploaded(path) &&
      !checking(path)
    let res = await browsing(
      req,
      env,
      (r) => served(r, env, c, false, undefined, req),
      remember,
    )
    return timed(
      told(stamped(req, remember ? toldStores(req, res, env) : res), c),
      c,
    )
  })
}

// A store of a stranger's own, born for their first write (visit.ts `born`),
// or null where it costs too much now: a store costs the platform until it is
// installed, so a source makes only so many a minute, and an app's strangers
// hold only so many.
let birth = async (
  env: Env,
  req: Request,
  space: Space,
  app: App,
  { via, person }: Visitor,
): Promise<Visit | null> =>
  await within(env.BIRTH_RATE, source(req), failing('rate limit')) &&
    !await crowded(ledgerOf(env), app.eid)
    ? await born(env, space, app, via, person)
    : null

// Serving an app, with the stopwatch running (timing.ts): every stage below
// that waits is named, so `Server-Timing` on the answer says where the time
// went — the directory, the app's own worker, the bytes — instead of leaving
// a second to guess at (T-33176).
//
// The order is a rule rather than an accident (@yaks/platform/ladder, which
// decides where an address stops from what this reads for it). One rung is
// opted into, between 1 and 2: the paths the home app named in `home.first`
// are its worker's before they are the owning app's (`firstly` above). Empty
// for almost every space, and it can only ever move a path from the app that
// owns it to the home app — never off the platform's own (rung 1), and never
// onto a space that asked for nothing.
//
// `edge` is the same order served for Site's cache (page-cache.ts): an
// anonymous visitor, the directory read fresh, nothing counted, and every
// answer that is not the same page for everyone passed back unfinished,
// before any app's own code runs for it.
let served = async (
  req: Request,
  env: Env,
  c: Clock,
  edge = false,
  copied: () => void = () => {},
  visitor = req,
  view?: Directory,
): Promise<Response> => {
  let url = new URL(req.url)
  let direct = bound(env.DIRECTORY, dirPart.fetch, env)
  let dir = view ?? directory(direct, {
    copy: copyOf(env),
    time: env.CLOCK,
    public: edge,
    used: copied,
  })
  // What Site keeps from a directory copy says so, and is kept for now only
  // (site.ts).
  let marked = (answer: Response) => {
    if (dir.stale) answer.headers.set('x-yak-directory-copy', '1')
    return answer
  }
  // The person the cookie names, and a machine's bearer at an `/api/` door,
  // read once, when a hostname names a space. Site's request carries a cookie
  // only at a session's own key (@yaks/platform/kept `visitor`), where it
  // serves the person their own copy of a stranger's page.
  let ids: ReturnType<typeof identify> | undefined
  let identify = () =>
    Promise.all([
      sessionPerson(req, env),
      !edge && req.headers.has('authorization') && !bearing(req) &&
        url.pathname.includes('/api/')
        ? asking(env, req)
        : null,
    ]).then(([cookied, authenticated]) => ({
      cookied,
      authenticated,
      person: authenticated?.who?.person ?? cookied,
    }))
  let identity = () => ids ??= identify()
  let step = await rung({
    host: hostOf(req, env),
    method: req.method,
    pathname: url.pathname,
    search: url.search,
    mount: req.headers.get(MOUNT),
  }, {
    kept: async () => {
      let { cookied } = await identity()
      if (edge) return null
      let session = cookied && sessionCookie(req, env)
      return await asked(visitor, env, c, session || null)
    },
    // The space, the app at the address, the front page and the seat of the
    // person the cookie names, in one read of the directory: every rung asks
    // one of them, and asking each in turn was a round trip apiece.
    page: async (space, app) => {
      let { person } = await identity()
      let read = c.time('route', () => dir.page(space, app, person))
      let credential = sessionReading(req, env, dir)
      // The name `/who` tells a person beside their standing (api `/who`, and
      // `/me`, its shipped name), asked with the route so a page's first
      // question waits on that one trip.
      if (person && !edge && /\/api\/(?:who|me)$/.test(url.pathname)) {
        dir.nameAt(person).catch(() => {})
      }
      return (await Promise.all([read, credential]))[0]
    },
    formerly: (space) => c.time('moved', () => dir.formerly(space)),
    former: (space, app) => dir.former(space, app),
  }, env)
  if (step.to == 'manage') return (await import('./manage.ts')).manage(req, env)
  if (step.to == 'kept') return step.page
  // Its pages tell the browser whose this hostname's storage is now
  // (site-data.ts), on their way out of `fetch` below.
  if (step.space && !edge) serves(visitor, step.space.store)
  if (step.to == 'nothing') {
    let none = nothingAt(url.pathname, env)
    return edge && step.kept ? keep(none, step.space ?? null, null) : none
  }
  if (step.to == 'sent') return redirect(step.href, step.status)
  let { space, read: routing } = step
  let { person, authenticated } = await identity()
  // A seat, from that read for the person it asked about, else the directory.
  let seatOf = (p: string) =>
    p == person && routing.role !== undefined
      ? Promise.resolve(routing.role)
      : dir.role(space, p)
  // Site keeps what is the same for everyone (@yaks/platform/kept
  // `keepable`): the own files of an app anyone may read (public or open),
  // and the release
  // files of one anyone may install. From a directory copy a moment old it
  // keeps only a public app's.
  let keeps = (app: App, path: string) =>
    keepable(app, path) && !(dir.stale && app.access != 'public')
  if (step.to == 'closed') return closed(req, env, dir, space)
  // The space's old builder door, still posted to by a page drawn before
  // the New app screen asked the Operator (M-37853): its line is forwarded
  // into the person's conversation (build-door.ts `forwarded`). Its socket
  // is gone, so such a page's script falls back to posting the form.
  if (step.to == 'build') {
    if (req.method != 'POST') {
      return new Response(null, { status: 405, headers: { allow: 'POST' } })
    }
    let who = await c.time(
      'who',
      () => whoIs(req, env, seatOf, space.eid, dir),
    )
    if (!who.person) {
      return json(401, 'not_a_writer', NOBODY, signInAt(url.href, env))
    }
    if (!writes(who.role)) return json(403, 'not_a_writer', NOT_A_WRITER)
    return forwarded(env, space, req, who)
  }
  // Only the space's own people are told where a trashed app went, since a
  // stranger learning that an app was deleted here learns something that is
  // not theirs.
  if (step.to == 'binned') {
    let who = await c.time(
      'who',
      () => whoIs(req, env, seatOf, space.eid, dir),
    )
    return who.role == 'owner'
      ? binned({
        space: space.slug,
        title: step.app.title || step.app.slug,
        days: daysLeft(step.app.trashed!),
      }, env)
      : nothingHere(env)
  }
  if (step.to == 'robots') return edge ? passed() : await robotsOf(env)
  if (step.to == 'index') {
    // A stranger's view is the same for every stranger, so Site keeps it for
    // them, and a person is never answered it (kept-page.ts `asked`): one
    // with no seat here is answered their own, kept at their session's key,
    // and a member's is never kept.
    let { page, alone } = await index(
      req,
      env,
      space,
      routing.roster!,
      seatOf,
      dir,
    )
    if (!edge) return page
    return alone ? marked(keep(page, space, null, [200], alone)) : passed()
  }
  if (step.to == 'slash') {
    // Site keeps the forward as it keeps the page behind it, so a visitor
    // following one waits on no directory read and is given no cookie, and
    // the visitor's query is put back on as it is served (kept-page.ts
    // `asked`).
    let slash = redirect(step.href)
    if (!edge) return slash
    return keeps(step.app, '')
      ? marked(keep(slash, space, step.app, [302]))
      : passed()
  }
  let { front, bare } = step
  let { home } = routing
  let app = step.app
  let path = step.path
  // The app's own worker, coming back through its service binding for its
  // store or its files (dispatch.ts): the grant says who it is acting as, so
  // there is no cookie to read — and a request holding one is never sent back
  // to the worker, which is what keeps `env.FILES.fetch('/index.html')` from
  // being a loop.
  // A sandboxed app (installed.ts): its page's own requests arrive with its
  // page token leading the path, `/<app>/~<token>/…`. The segment is taken
  // off here, so everything below — the app's worker included — sees the
  // clean address. A top-level navigation to one (a link the page followed,
  // its own address copied) goes to the clean address instead, which loads
  // the page afresh and never shows a token in the address bar. On an app
  // that is not sandboxed the segment names nothing.
  let walls = sandboxed(app)
  // A file the app published (public-files.ts) answers its address before
  // anything of the app's own runs: the home router, the worker, the private
  // gate. The app's row, read above, lists the paths it published at, so a
  // request anywhere else asks nothing more. One at a listed path asks for
  // its row straight from the directory, so a walk over many addresses
  // leaves its serving copy alone. The same answer for everyone, so Site
  // keeps it whatever the app's access, even from a directory copy a moment
  // old: the file's own row is read fresh, and nothing of the app's access
  // decides it.
  let open = walls || !app.publishing?.length
    ? null
    : await c.time('public', () =>
      publicFile(
        {
          req,
          env,
          dir: directory(direct),
          space: space!,
          app: app!,
          at: bare,
        },
        path,
        dir.stale,
      ))
  if (open) {
    if (open.headers.get('content-type')?.startsWith('text/html')) {
      open = await reported(
        env,
        bare,
        filled(open, await copyFor(env, space!, app)),
        app.version ?? 0,
        badged(space, app, env),
        APP,
        req.headers.get(ADDRESS) ?? req.url,
      )
    }
    let page = reporting(open, req, bare, app)
    if (edge) return keep(page, space, app)
    shown(env, req, page, seen(space, app))
    return page
  }
  // Nor does the gateway ask Site about the addresses of an app it keeps
  // nothing of for a while.
  if (edge && !keeps(app, path)) return passed()
  if (!edge && !keepable(app)) unkept(req, env, bare, c)
  let calendarToken = /^\/calendar\/([a-zA-Z0-9_-]+)\.ics$/.exec(path)?.[1]
  if (path == '/calendar.ics' || calendarToken) {
    if (edge) return passed()
    // The app's own worker answers its feed first, as it answers every other
    // address of its own (rung 2): the township's adds its meetings. Its 404
    // passes to the platform's feed of the app's `event` rows, as a page's
    // passes to its files. Never the worker's own request coming back, which
    // would ask it again, and a sandboxed app's worker hears no cookie's
    // person: its page tokens are what open it.
    let own = bearing(req) ? null : await c.time('worker', async () =>
      ran(
        env,
        space!,
        app!,
        req,
        walls
          ? { person: null, role: null }
          : await whoIs(req, env, seatOf, space!.eid, dir),
      ))
    if (own && own.status != 404) return own
    await own?.body?.cancel()
    let { calendarOut } = await import('./calendar.ts')
    return calendarOut(req, env, space, app, calendarToken)
  }
  let paper = tokenOf(path)
  if (paper) {
    let reads = req.method == 'GET' || req.method == 'HEAD'
    if (reads && req.headers.get('sec-fetch-mode') == 'navigate') {
      return redirect(`${bare}${paper.rest.slice(1)}${url.search}`)
    }
    if (!walls) return nothingHere(env)
    let clean = new URL(url)
    clean.pathname = url.pathname.slice(0, -path.length) + paper.rest
    req = new Request(clean, req)
    url = clean
    path = paper.rest
  }
  let appHandle = storeName(space, app)
  let store = appHandle
  if (
    paper && (!env.SESSION_SECRET ||
      !await paged(paper.token, env, store))
  ) return json(401, 'not_a_reader', 'This page token does not open this app')
  // A stranger's visit is served from the sample or from a store of their
  // own, so the worker it ran comes back holding grants for that store and
  // not the app's: it is served as the visit was (visit.ts `revisited`).
  //
  // The sample is every stranger's at once, so nothing writes there. The
  // worker's first write for a stranger on it gives them a store of their
  // own, as the page's does (`moved`), and from then on the worker is served
  // from that store, its reads after the write included.
  let theirs = app
  let grant = bearing(req) && !walls
    ? await grantedStore(req, env.SESSION_SECRET)
    : null
  // The store the grant must name: the app's own, or the one it revisits.
  let minted = store
  let moving = false
  if (
    grant && grant.store != store &&
    revisited(storeName(space, app), app, grant.store)
  ) {
    let release = await releaseFor(dir, app)
    app = revisited(storeName(space, app), app, grant.store, release)!
    store = minted = grant.store
    let visitor = onSample(app) ? grant!.visitor : null
    let own = visitor
      ? await visitOf(ledgerOf(env), visitor.via, theirs.eid)
      : null
    if (!own && visitor && births(path, req.method)) {
      own = await c.time(
        'birth',
        () => birth(env, req, space!, theirs, visitor),
      )
      if (!own) {
        await req.body?.cancel()
        return unborn(req, env)
      }
    }
    if (own && !own.adopted) {
      app = revisited(storeName(space, theirs), theirs, own.store, release)!
      store = own.store
      moving = true
    }
  }
  // The app acting as itself (`owning`) has no seat: its standing is its own.
  let itself = await granted(
    req,
    env.SESSION_SECRET,
    minted,
    app.policy,
    (p) => p == app!.eid ? Promise.resolve('editor') : seatOf(p),
  )
  if (bearing(req) && !itself) {
    return json(
      401,
      'not_a_reader',
      'This worker grant does not open this app',
    )
  }
  // On the sample the worker reads and writes nothing, as the app no more
  // than as its visitor; in the visitor's own store both are its editors.
  if (itself && onSample(app)) itself.role = 'viewer'
  if (itself && moving) itself.role = 'editor'
  if (itself?.service) {
    let { verifyService } = await import('./service-call.ts')
    if (
      itself.service.service != app.eid ||
      itself.person != itself.service.person ||
      !await verifyService(env, dir, itself.service)
    ) {
      return json(403, 'access', 'This service authority was revoked')
    }
    itself.role = null
  }
  // Machine clients use the same login bearer as the connector. Verify it
  // at the app door too, before the cookie/page-token path, and read the
  // caller's membership live. A narrowed CLI grant never crosses spaces;
  // an invalid credential never falls back to a public read or a cookie.
  let bearer: Who | undefined
  // A sandboxed app already accepts its one-app page bearer. Keep that
  // credential on its existing path rather than treating it as a CLI login.
  let pageBearer = walls && env.SESSION_SECRET && bearerOf(req)
    ? await paged(bearerOf(req)!, env, store)
    : null
  if (
    !itself && !pageBearer && path.startsWith('/api/') &&
    req.headers.has('authorization')
  ) {
    let { who: caller } = authenticated ?? await asking(env, req)
    if (
      !caller ||
      (caller.spaceEid
        ? caller.spaceEid != space.eid
        : caller.space && caller.space != space.slug)
    ) {
      return json(401, 'not_a_reader', 'Sign in with yak login for this app')
    }
    bearer = {
      person: caller.person,
      role: await seatOf(caller.person),
      until: caller.until,
      ...(caller.instrument ? { via: caller.instrument } : {}),
    }
  }
  let who = itself ?? bearer ??
    await c.time(
      'who',
      () =>
        walls
          ? presented(req, env, seatOf, space!, store, paper?.token, path, dir)
          : whoIs(req, env, seatOf, space!.eid, dir),
    )
  if (path.startsWith('/api/') && !itsApp(who, app)) {
    // The route read the cookie's person's claims; any other caller asks.
    let { browsers } = routing
    who = who.person && who.person == person && browsers
      ? { ...who, browsers }
      : await browsersOf(env, who)
  }
  // And the page's own address for its relative URLs: a sandboxed page's
  // carries a token for whoever loaded it, dying with their cookie.
  let at = paper
    ? `${bare}~${paper.token}/`
    : walls && !path.startsWith('/api/') && env.SESSION_SECRET
    ? `${bare}~${await paging(
      env.SESSION_SECRET,
      store,
      who.person,
      lasting(who.until),
      who.via,
      who.session,
    )}/`
    : bare
  // Rung 1½: the home app's router, where it named this path. Ahead of the app
  // whose slug owns it — and ahead of that app's own access rule, since what
  // answers is the HOME app's page and not this one's. Not for the home app's
  // own addresses, where its worker is already what rungs 3 and 5 ask, and
  // never for a request an app's worker made: the router's own onward call
  // carries the grant it was handed, and without that guard it would arrive
  // back at the path it just intercepted (dispatch.ts `bearing`).
  //
  // Nor for a sandboxed page's own request: its token is its app's alone,
  // and the router would be acting as the person who holds it.
  if (!front && !bearing(req) && !paper && !webPath(path)) {
    if (edge && claims(home, url.pathname)) return passed()
    let early = await firstly(env, space, home, req, who, c)
    // The answer is the home app's, so it reports as the home app — and is
    // counted as the home app's page view — at the bare hostname, which is
    // where the home app is mounted.
    if (early) {
      shown(env, req, early.page, seen(space, early.app))
      let page = early.page
      if (
        page.body &&
        page.headers.get('content-type')?.startsWith('text/html')
      ) {
        page = await reported(
          env,
          '/',
          filled(page, await copyFor(env, space, early.app)),
          early.app.version ?? 0,
          {
            ...badged(space, early.app, env),
            ...cornerOf(space, early.app, env, who),
          },
          appPreview(early.app, '/'),
          req.headers.get(ADDRESS) ?? req.url,
        )
      }
      let res = reporting(page, req, '/', early.app)
      return sandboxed(early.app) ? walled(res) : res
    }
  }
  // A guest of this one app (T-37615). The roster is read space-wide, so
  // somebody invited to a single app holds no seat and the answer above is
  // null; what they hold is a grant on this app, and from here on they are
  // that level — the app's page, its data, its `me()`, and the vouch its store
  // mirrors. Here rather than beside the seat, because rung 1.5 above hands
  // `who` to the HOME app's router: a guest of one app must not arrive at
  // another app's worker wearing a level. Asked only of a signed-in caller
  // with no seat, so a member pays nothing for it and a stranger nothing.
  if (who.person && !who.role) {
    let { grants } = routing
    let held = who.person == person && grants
      ? grants.has(app.eid) ? { access: grants.get(app.eid)! } : null
      : await c.time('guest', () => dir.grant(app!, who.person!))
    if (held) who = { ...who, role: held.access, guest: true }
  }
  // A stranger at a private published app is served the app from its sample,
  // or from a store of their own once they have written (visit.ts, D-134327),
  // unless the owner already let them in: then their way through is the
  // click in the letter, as it was. So too for somebody the app's own rows
  // list (join.ts): theirs is the Join button, not a copy (T-153688). Never the app's own worker coming back,
  // nor a sandboxed app, whose page tokens each open one store, nor the form
  // door: a form is the app's own, shown and filled by anyone (forms.ts), and
  // a sample or a copy holds none of the app's forms.
  let visit: Visiting | null = null
  let stranger = { app: theirs, who, release: null as Release | null }
  if (!itself && !walls && !formPath(path, req) && visitable(app, who)) {
    let [own, release, invited] = await c.time('visit', () =>
      Promise.all([
        ownOf(env, visitor, who.via!, app!.eid),
        releaseFor(dir, app!),
        who.person
          ? Promise.all([
            waiting(dir, space!, app!, who.person, 'not_a_reader'),
            joinable(env, dir, space!, app!, who),
          ]).then(([letter, listed]) => !!letter || !!listed)
          : false,
      ]))
    if (!invited) {
      stranger.release = release
      ;({ app, who, visit } = visiting(
        storeName(space, app),
        app,
        who,
        own,
        release,
      ))
    }
    if (own && due(own.seen)) background(used(ledgerOf(env), who.via!, app.eid))
    // Their store is an app of their own now: the page they open is there.
    let mine = visit == 'kept' && req.method == 'GET' &&
        req.headers.get('sec-fetch-mode') == 'navigate'
      ? await dir.appAt(own!.adopted!)
      : null
    if (mine && !mine.app.trashed && !mine.space.trashed) {
      return redirect(
        `${urlOf(mine.space, mine.app, env)}${path.slice(1)}${url.search}`,
        303,
      )
    }
  }
  let to = door({
    path,
    method: req.method,
    who,
    access: app.access,
    itself: !!itself,
  })
  if (to.to == 'refused') {
    return json(
      to.status,
      to.code,
      to.says ?? SAYS[to.code],
      to.signIn ? signInAt(req.url, env) : undefined,
    )
  }
  if (to.to == 'data') {
    if (edge) return passed()
    if (to.part == 'sign-in') return redirect(signInAt(req.url, env), 303)
    if (to.part == 'nothing') return nothingHere(env)
    if (to.part == 'script') return platformFile(req, env, '/data.js')
    if (to.part == 'asset') return dataAsset(req, env, to.name)
    let at = bare.replace(/\/$/, '')
    return await reported(
      env,
      at || '/',
      editor(env, {
        app: app.title || app.slug,
        at,
        words: (await declarationOf(env, space, app)).vocab,
        version: env.CF_VERSION_METADATA?.id ?? '',
      }),
      app.version ?? 0,
      { badge: null },
    )
  }
  if (to.to == 'web') {
    return to.asset
      ? webAsset(req, env, to.asset)
      : webPage(req, env, url.pathname.slice(0, -path.length), who.person!)
  }
  // A sandboxed app's answers, every one, are walled (installed.ts).
  let wall = (res: Response) => walls ? walled(res) : res
  if (to.to == 'api') {
    let apiPath = to.door
    // A worker coming back with a grant for a visit's store holds no app
    // role, just like the browser it answered.
    let answerApi = () =>
      api(
        req,
        env,
        dir,
        space!,
        { app: app!, who },
        {
          app: theirs,
          who: minted == appHandle ? atApp(who) : { ...who, role: null },
        },
        apiPath,
        c,
        at,
      )
    // Upload representations get a short keep revalidated against their rows;
    // release assets and platform modules are kept as pages are.
    if (edge) {
      if (!fixed(path) && !uploaded(path)) return passed()
      return marked(
        keep(
          reporting(
            await answerApi(),
            req,
            at,
            app,
          ),
          space,
          app,
          uploaded(path) ? [200] : [200, 302, 404],
        ),
      )
    }
    // A stranger's reads are held to a rate per source (@yaks/workerd/rate), here and
    // before the store, so a refused one is never a store request the space's
    // meter counts. Not the space's people, and not the app's own worker,
    // which is already somebody's request.
    //
    // A file read by its address, an upload or a release's asset, is a static
    // file, like the app's own pages, which the rate never counted: a page of
    // three hundred thumbnails is one stranger's ordinary visit, and a refused
    // image is a broken page.
    if (
      !await apiAllowed(req, path, who.person, !!itself, env.API_RATE)
    ) {
      return wall(reporting(tooMany(), req, at, app))
    }
    // A stranger's first write gives their browser a store of its own, a copy
    // of the sample, and goes there; the answer tells the page's client to
    // open its socket again, which now reaches it.
    let moved = visit == 'sample' && births(path, req.method)
    if (moved) {
      let own = await c.time(
        'birth',
        () =>
          birth(env, req, space!, stranger.app, {
            via: who.via!,
            person: who.person,
          }),
      )
      if (!own) {
        await req.body?.cancel()
        return wall(reporting(unborn(req, env), req, at, app))
      }
      tellBorn(visitor, who.via!, stranger.app.eid)
      ;({ app, who, visit } = visiting(
        storeName(space, stranger.app),
        stranger.app,
        stranger.who,
        own,
        stranger.release,
      ))
    }
    let answer = await c.time('api', answerApi)
    if (moved) {
      answer = new Response(answer.body, answer)
      answer.headers.set(MOVED, '1')
    }
    if (
      (answer.ok || answer.status == 101) && !who.administrative &&
      ([
        '/query',
        '/apply',
        '/command',
        '/ws',
        '/storage',
        '/choose',
        '/pay/checkout',
      ].includes(apiPath) ||
        apiPath.startsWith('/blob') || apiPath.startsWith('/files/') ||
        apiPath.startsWith('/save'))
    ) scheduleBy(env, who, app.eid)
    return wall(reporting(answer, req, at, app))
  }
  if (to.form != null) {
    if (edge) return passed()
    // The store shows a form it holds, and only that it holds one matters
    // here. The form is the app's own, whatever store a stranger's visit
    // serves the page from.
    let found = await appStore(env.STORE, space, stranger.app, env).consume(
      `${FORM}${encodeURIComponent(to.form)}`,
      async (r) => {
        await r.body?.cancel()
        return r.ok ? null : r.status
      },
      {},
      KERNEL,
    )
    if (found) return json(found, 'not_found')
  }
  let mayRead = to.seen == 'page'
  // Both at once, because they are two halves of one answer and neither
  // needs the other's result (T-33176). The app's own worker answers first
  // where it has one and the file is what it falls back to, so asking the
  // dispatch namespace and only then the bucket cost two round trips end to
  // end — and almost every app has no worker at all, so almost every page
  // paid the first one purely to be told so. Started together, a page costs
  // the longer of the two rather than their sum.
  //
  // The wasted read is the rare case — an app whose worker answers — and it
  // is one small GET. The `catch` is there because a promise nobody awaits
  // must not surface as an unhandled rejection.
  // The page's copy, read once for whichever answers it: the files' page, or
  // the worker's, while it runs. A page the worker asked for is filled with
  // the worker's answer, so it is read none.
  let copy = !itself && fence.page(path) ? copyFor(env, space, app) : null
  let file = mayRead
    ? asset(
      req,
      env,
      space,
      app,
      who,
      path,
      at,
      c,
      copy,
      bare,
      walls ? () => storing(env, space!, app!, who, at) : undefined,
    )
    : null
  file?.catch(() => {})
  // The worker runs ahead of the page's gate (@yaks/platform/ladder `behind`).
  // What it may do as the app is `env.APP` and nothing else; its `env.STORE`
  // is still the visitor, so a worker that only passes a store read on
  // refuses exactly what the page would have.
  let own = itself
    ? null
    : await c.time('worker', () => ran(env, space!, app!, req, who))
  // A write the worker made for a stranger on the sample gave them a store of
  // their own (above): their browser is told it holds one, and the page that
  // asked that its store moved, as the page's own write tells them.
  if (own && visit == 'sample' && !['GET', 'HEAD'].includes(req.method)) {
    let mine = await visitOf(ledgerOf(env), who.via!, stranger.app.eid)
    if (mine && !mine.adopted) {
      tellBorn(visitor, who.via!, stranger.app.eid)
      own = new Response(own.body, own)
      own.headers.set(MOVED, '1')
    }
  }
  // The worker's 404 is its pass, and the files answer behind it.
  let answering = await behind({
    worker: !own ? 'none' : own.status == 404 ? 'pass' : 'answer',
    seen: to.seen,
    held: () => held(env, space, app, path),
  })
  if (answering == 'sign-in' || answering == 'shut') {
    await own?.body?.cancel()
    if (answering == 'sign-in') return redirect(signInAt(req.url, env), 303)
    return await shut(
      env,
      dir,
      space,
      app,
      { person: who.person!, role: who.role, guest: who.guest },
      bare,
    )
  }
  let page = answering == 'files' ? await file ?? own ?? nothingHere(env) : own!
  if (page != own) await own?.body?.cancel()
  // File pages already pass through woven(). Worker pages use the same
  // reporter, without buffering or changing their navigation and asset URLs.
  if (
    page == own && page.body &&
    page.headers.get('content-type')?.startsWith('text/html')
  ) {
    page = await reported(
      env,
      at,
      filled(page, await (copy ?? copyFor(env, space, app))),
      app.version ?? 0,
      wearing(req, space, app, env, who),
      appPreview(app, bare),
      req.headers.get(ADDRESS) ?? req.url,
    )
  }
  // Rung 4, and it is last rather than fourth in the code because rungs 3 and
  // 5 are the one call above.
  let word = indexes(url.pathname, page.status)
  if (word) {
    await page.body?.cancel()
    return edge
      ? passed()
      : word == 'robots'
      ? await robotsOf(env)
      : (await index(req, env, space, routing.roster!, seatOf, dir)).page
  }
  // Site's page is counted by the gateway that sends it (page-cache.ts). A
  // member's is never kept: it is woven for them (`wearing`).
  if (edge) {
    return marked(
      keep(
        reporting(page, req, at, app),
        space,
        app,
        undefined,
        aloneOf(who) ?? undefined,
      ),
    )
  }
  // Count the page served (views.ts, T-34496). Last, once, and only for
  // what an app answered: the `/api/` doors returned above, a file that is not
  // HTML is not a page, and the platform's own pages — the space index, the
  // trash, a wrong address — never come back through here.
  shown(env, req, page, seen(space, app))
  if (page.status < 400) scheduleBy(env, who, app.eid)
  return wall(reporting(page, req, at, app))
}

// Who a sandboxed app's request is (installed.ts). Its page token, from the
// path or a bearer, names the person, and their role is read live — the token
// carries none. Without one, the app's `/api/` hears nobody, whatever cookie
// came: only its page load reads the cookie, and that is what mints the token.
let presented = async (
  req: Request,
  env: Env,
  roleOf: (person: string) => Promise<Role | null>,
  space: Space,
  store: string,
  token: string | undefined,
  path: string,
  dir?: Directory,
): Promise<Who> => {
  let sent = token ?? bearerOf(req)
  if (!sent) {
    return path.startsWith('/api/')
      ? nobody
      : whoIs(req, env, roleOf, space.eid, dir)
  }
  let p = env.SESSION_SECRET ? await paged(sent, env, store) : null
  if (!p) return whoIs(req, env, roleOf, space.eid, dir)
  if (!p.person) {
    return {
      ...nobody,
      until: p.exp,
      ...(p.via ? { via: p.via } : {}),
    }
  }
  return {
    person: p.person,
    role: await roleOf(p.person),
    until: p.exp,
    ...(p.session ? { session: p.session } : {}),
    ...(p.via ? { via: p.via } : {}),
  }
}

// What a sandboxed page is given to keep things in (installed.ts `stored`):
// the person's saved keys, read from the app's own store, or none for a
// visitor who is not signed in, whose storage lasts as long as the page. A
// draft's preview is walled the same way (preview.ts), so it is given the
// same, from the preview's own store.
export let storing = async (
  env: Env,
  space: Space,
  app: App,
  who: Who,
  at: string,
) => {
  if (!who.person) return stored(at, {}, false)
  let keys = await appStore(env.STORE, space, app, env).consume(
    '/storage',
    async (r) => {
      if (r.ok) return await r.json() as Record<string, string>
      await r.body?.cancel()
      return {}
    },
    {},
    vouched(who),
  )
  return stored(at, keys, true)
}
