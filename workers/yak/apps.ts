import { browsersOf } from './attribution.ts'
import { refuse as refusedOptions, waits, writeOptions } from '@yaks/api'
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
// writes the same `exception` entity a route that threw does. Rate-limited
// per app: a page in a loop is a bug to see once, not a write flood. What the
// door refused on purpose never becomes one (unseen.ts `refusal`): a
// signed-out visitor sent to sign in is the platform working.
import { apex, type Host, url as hostUrl } from '@yaks/platform/host'
import { r2Objects } from './lib/objects.ts'
import { logoBytes, logoIcon } from './logo.ts'
import { BUILD, joining, NOBODY, NOT_A_WRITER, posting } from './build-door.ts'
import { browserImmutable, immutable } from './cache.ts'
import { client } from './sheets.ts'
import {
  apiOut,
  assetMaps,
  assetPath,
  assetUrl,
  linked,
  LOADS,
  releaseId,
} from './asset_url.ts'
import * as files from './files.ts'
import { parse as parseRedirects, sentOn } from './redirects.ts'
import { inside, prefixOf, VERSION } from './files.ts'
import { door as publicDoor, served as publicFile } from './public-files.ts'
import { blobPrefix, servable, uploadPrefix } from './blob-key.ts'
import {
  type Access,
  type App,
  appStore,
  daysLeft,
  directory,
  META,
  offered,
  type Role,
  type Space,
  storeAt,
  storeName,
  url as urlOf,
} from './directory.ts'
import * as dirPart from './directory.ts'
import { ahead, bearing, granted, itsApp, ran } from './dispatch.ts'
import { bound, type Env } from './env.ts'
import { pageAt, pilled, standing } from './gallery-row.ts'
import { buying, type Product } from './sell.ts'
import {
  addressed,
  Gone,
  mimeOf,
  parts,
  representation,
  represents,
  type Served,
  servedVia as fencedVia,
  Wrong,
} from '@yaks/blob'
import { contentType } from '@yaks/blob/identify'
import { declarationOf } from './declaration.ts'
import { KERNEL, type Meta, metaOf, minted } from './meta.ts'
import { Pending } from './writes.ts'
import {
  acceptsOf,
  admit,
  belowFloor,
  blobKey,
  described,
  type File,
  Untaken,
  uploaded,
  useOf,
} from './uploads.ts'
import { batched, lined, receipt, resend } from './wire.ts'
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
  chatPath,
  hostOf,
  MANAGE,
  manageAt,
  MOUNT,
  movedFor,
  OURS,
  paged as pagePath,
  route,
  signInAt,
} from '@yaks/platform/routes'
import { covers, platformPath } from './router.ts'
import {
  browsing,
  nobody,
  sessionPerson,
  titling,
  vouched,
  type Who,
  whoIs,
} from './session.ts'
import { asking } from './asking.ts'
import {
  borrowed,
  homed,
  local,
  queried,
  sources,
  vocabulary,
} from './page-graph.ts'
import { pageSocket } from './page-socket.ts'
import {
  DATA_ASSETS,
  DATA_SCRIPT,
  dataAsset,
  dataPath,
  webAsset,
  webPage,
  webPath,
} from './web.ts'
import { admitted, pageScript, type Scripts } from './page-script.ts'
import type { Bundle } from '@yaks/graph'
import { Refused, Stale } from '@yaks/graph/errors'
import { mistaken } from './mistake.ts'
import { token } from '@yaks/graph/sha256'
import { edits, mode, reads, writes } from '@yaks/member'
import { type Door, USES } from './door.ts'
import { type Clock, clock, timed } from './timing.ts'
import {
  asked,
  keep,
  keepable,
  passed,
  shown,
  told,
  unkept,
} from './page-cache.ts'
import { type Alone, CLIENT, fixed, NAMED_CLIENT } from './kept-page.ts'
import { cookieValue } from '@yaks/platform/cookie'
import { noted, refusal, serving } from './unseen.ts'
import { broken } from '@yaks/tracker/report'
import { flood } from './lib/flood.ts'
import { isVerifiedBot } from '@yaks/platform/bots'
import { ADDRESS } from '@yaks/platform/routes'
import { background, caught, defect, refusing, stopped } from './defects.ts'
import {
  barOf,
  born,
  crowded,
  due,
  MOVED,
  onSample,
  ownOf,
  type Release,
  releaseFor,
  tellBorn,
  toldStores,
  used,
  visitable,
  type Visiting,
  visiting,
} from './visit.ts'
import { full, fullFiles } from './usage.ts'
import { free } from './meter.ts'
import { scheduleBy } from './used.ts'
import { sha256 } from './versions.ts'
import { seen } from './views.ts'
import { refuse } from './tool.ts'
import { routes as commandRoutes } from '@yaks/tools/routes'
import { commandIn, commandsIn } from './app-command.ts'
import { type Limiter, source, tooMany, within } from './rate.ts'
import {
  bearerOf,
  lasting,
  paged,
  paging,
  sandboxed,
  stored,
  tokenOf,
  walled,
} from './installed.ts'

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
  ['operator', async () => (await import('./app-operator.ts')).tell],
  ['form', async () => (await import('./forms.ts')).forms],
])
// The form door's paths, whose forms are the app's own whoever asks.
let formPath = (path: string, req: Request) =>
  path.startsWith('/api/form/') ||
  (path == '/api/blob' && req.method == 'POST' &&
    new URL(req.url).searchParams.has('form'))

// A refusal is read — by the page that catches it, and by the person's agent
// after that — so it answers a sentence beside its code (C-32574 item 2, where
// a club member's vote showed them `{"error":{"code":"not_a_writer"}}`). The
// code is the machine's half and never moves; the message is what someone is
// told. When signing in is the way through it also answers `signIn`, the
// address that does it and comes back (T-32593).
let SAYS: Record<string, string> = {
  method_not_allowed: 'that door does not answer this method',
  too_many_reports: 'this app has reported too many breaks this minute',
  expected_websocket: 'the live door takes a websocket upgrade',
  // Names no doors: `api` below is their one list.
  not_found: "no such door under this app's api",
  not_a_writer: 'sign in to change this app',
  not_a_reader: 'sign in to see this app',
  // Join, by somebody the app's own rows do not list (join.ts).
  not_listed: 'only the people this app lists may join it',
  no_bytes: 'an upload needs a body: post the file itself',
  upload_gone: 'that upload is no longer under way — begin it again',
  too_large: 'that file is bigger than this app takes',
  unsupported_media_type: 'this app does not take that kind of file',
  no_such_file: 'no file at that address in this app',
  // What the store said no to — an unknown component, a `$was` that moved, a
  // dead entity. Its own sentence rides in `message`; this is the fallback.
  refused: 'the app store would not take that',
  // A stranger's first write, when no store of their own can be made for it
  // (visit.ts): too many made from one place, or the app holds all it keeps.
  sign_up: 'sign up to keep your own copy of this app: too many people are ' +
    'trying it right now to keep one in this browser',
}

// The same refusals to someone who is signed in: signing in is no longer the
// way through, so the sentence says whose it is to grant.
let MEMBER: Record<string, string> = {
  not_a_writer: 'you can read this app but not change it — its owner can ' +
    'make you an editor',
  not_a_reader: "this app is its owner's — they can let you in",
}

// Signed in and refused, with an invitation they have not accepted: the owner
// already let them in, and the one thing left is the click in the letter,
// which no page of the app may make for them (invite.ts). A viewer's
// invitation does not lift a refusal to write, so it is not mentioned there.
let WAITING = 'you have an invitation to this app waiting — accept it from ' +
  'the letter yaks.app sent you, then come back'

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

/** Whether a page asking who is looking (`/me`) hears that an invitation
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

export let json = (
  status: number,
  code: string,
  says = SAYS[code],
  signIn?: string,
) =>
  Response.json(
    { error: { code, message: says ?? code, ...(signIn ? { signIn } : {}) } },
    { status },
  )

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

// A blob its store could not say how to serve: a stopped store's refusal
// keeps its status and wait, and anything else is reported and unavailable.
let unavailable = (error: unknown, tags: Record<string, string>) => {
  if (stopped(error)) return rejection(error, tags)
  caught(error, tags)
  return json(503, 'blob_unavailable')
}

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

// An app's API is a machine door even when the address names no app. Keep
// its missing answer in the same JSON envelope as every refusal below; the
// human-facing HTML 404 belongs only to pages. The raw pathname is used
// because `/api/query` is parsed as an app called `api`, while
// `/<app>/api/query` carries `/api/query` as that app's path.
let appApi = (pathname: string) =>
  /^(?:\/[^/]+)?\/(?:api\/|_web(?:\/|$))/.test(pathname)

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

// The store client under a name of its bytes (sheet-assets.ts), which never
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
// that policy admit the scripts by their hashes (page-script.ts `admitted`),
// so its own rules hold for everything else. A `<meta>` policy governs only
// what follows it, and the tags come first.
//
// A page of a space on the free plan wears the badge too (public/badge.js,
// `badgeOf`), and a visitor's page their bar (public/visit.js, `barOf`):
// decided as it is served, so every version and release an app serves wears
// them, and none of their files change.
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
let hasBase = (html: string) => /<base[\s>][^>]*\bhref\b/i.test(html)
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

// Where the parser will read a tag the kernel weaves in: inside the head if
// the page has one, else after the doctype, which must stay the document's
// first thing or the browser reads the whole page in quirks mode. A page with
// neither gets it in front of everything. The base and the links below are
// placed by this one rule.
let intoHead = (page: string, tag: string) => {
  let head = /<head[^>]*>/i.exec(page)
  if (head) return page.replace(head[0], `${head[0]}${tag}`)
  let doctype = /^\s*<!doctype[^>]*>/i.exec(page)
  return doctype ? page.replace(doctype[0], `${doctype[0]}${tag}`) : tag + page
}

// An app's own files must not name the app. The code is copied under
// whatever address the installer took it at (`app_install`), so a page
// written with `/chores/api/client.js` in it is a 404 the moment the copy
// lands at `/chore-chart/` — which is how a shared app rendered as bare HTML,
// no stylesheet and no script, and nothing said so (C-32905 item 1). Every
// page the kernel serves is given a `<base href>` at the app's own address
// instead, so `./api/client.js` and `./style.css` resolve from wherever the
// page is opened, pretty paths included. An absolute `/<app>/…` a page
// already carries is untouched — a base moves relative URLs only.
//
// A page carrying its own `<base>` keeps it, and is given none: the first in
// tree order is the document's, and an author who wrote one meant it.
// declared.ts hands a view to an MCP host by the same rule, at that app's
// absolute address.
export let based = (href: string, page: string) =>
  hasBase(page) ? page : intoHead(page, `<base href="${href}">`)

// Whether the page already names a tag — one token of the attribute that
// says what it IS, so `rel="shortcut icon"` and `rel="apple-touch-icon-
// precomposed"` both count as the author having answered, and a `<meta
// name="theme-color">` is asked the same way a `<link rel="manifest">` is:
// one test, parameterised on the tag and the attribute that names it.
let declares = (page: string, tag: string, attr: string, value: string) =>
  new RegExp(
    `<${tag}\\b[^>]*\\b${attr}\\s*=\\s*['"]?[^'">]*\\b${value}\\b`,
    'i',
  ).test(page)

// The platform's own palette (@yaks/ui's linen theme: `--accent`, `--bg`), for an
// app that never set its own (T-33055): the one look a generated manifest and
// the tags beside it can give honestly, since the browser's grey chrome and
// blank splash read as broken while a borrowed brand at least reads as
// intentional. An app carries its own instead (directory.ts `App.theme`, set
// through `app_set`), and this is only ever the fallback.
export let PLATFORM_THEME = '#4c773e'
export let PLATFORM_BACKGROUND = '#fdf7ee'

// The colour this app's chrome paints with: its own, if its owner set one
// (`app_set(theme_color: …)`), else the platform's. A stored colour is woven
// straight into a `<meta content>` attribute and the manifest JSON below, so it
// must be safe here, not only where app_set wrote it — the generic graph_apply
// tier can set the `theme` component past that validator. The charset (the twin
// of tools.ts `CSS_COLOR`, kept in step) admits hex, rgb()/hsl() and named
// colours but no quote, angle bracket or backslash, so a value that fails it is
// junk or an injection attempt: fall back to the platform's rather than emit it.
let CSS_COLOR = /^[#a-zA-Z0-9(),.%\s-]{1,64}$/
let safeColor = (v: string | null | undefined, fallback: string) =>
  v && CSS_COLOR.test(v) ? v : fallback
let themeColorOf = (app: App) =>
  safeColor(app.theme?.themeColor, PLATFORM_THEME)
let backgroundColorOf = (app: App) =>
  safeColor(app.theme?.backgroundColor, PLATFORM_BACKGROUND)

// The tags an app added to a home screen needs, and almost no app writes
// (T-34493, T-33055). iOS takes its icon from `<link rel="apple-touch-icon">`
// and nowhere else — Apple's *Configuring Web Applications*: a page names
// its icon there, 180×180 for current displays, `sizes` only when it offers
// several, and the smallest icon larger than the device wants is the one
// scaled, so one square file serves every device. Every other platform reads
// the manifest's `icons` instead, at the address the manifest link names.
// `mobile-web-app-capable` is the standard word for the same (Chrome warns
// on the Apple one alone), and the Apple one stays for iOS Safari.
// `apple-mobile-web-app-capable` is what makes iOS open the page as a window
// rather than a browser tab at all, and `apple-mobile-web-app-status-bar-
// style` is the one Apple still reads past `theme-color` for its own status
// bar. A page written here has none of it unless its agent thought of all
// five, so an app somebody kept on their phone came out blank or grey —
// owner, 2026-09-06: "the app's PWAs aren't getting icons (i tested iOS),
// even when the site itself has an image icon."
//
// So a page is given every tag it did not write, at the app's own root: the
// icon, the manifest (`manifest.webmanifest`, generated below), the chrome
// colour, and the two Apple words. Each is decided on its own — a page naming
// one gets the other four still — and what the page declares is never
// touched, because a second answer beside the author's own is a second
// answer to a question they already answered. The one exception is how the
// browser fetches a manifest (`credentialed` below), which no author chose.
//
// The hrefs are absolute at the mount, like the reporter's, rather than
// relative: a page carrying its own `<base>` keeps it (`based` above), and a
// relative `icon.png` would then resolve against the author's base instead of
// against the app.
export let pinned = (at: string, page: string, app: App) => {
  let tags =
    (declares(page, 'link', 'rel', 'apple-touch-icon')
      ? ''
      : `<link rel="apple-touch-icon" href="${at}icon.png">`) +
    (declares(page, 'link', 'rel', 'manifest')
      ? ''
      : `<link rel="manifest" href="${at}manifest.webmanifest" ` +
        `crossorigin="${local(app) ? 'anonymous' : 'use-credentials'}">`) +
    (declares(page, 'meta', 'name', 'theme-color')
      ? ''
      : `<meta name="theme-color" content="${themeColorOf(app)}">`) +
    (declares(page, 'meta', 'name', 'mobile-web-app-capable')
      ? ''
      : '<meta name="mobile-web-app-capable" content="yes">') +
    (declares(page, 'meta', 'name', 'apple-mobile-web-app-capable')
      ? ''
      : '<meta name="apple-mobile-web-app-capable" content="yes">') +
    (declares(page, 'meta', 'name', 'apple-mobile-web-app-status-bar-style')
      ? ''
      : '<meta name="apple-mobile-web-app-status-bar-style" content="default">')
  return credentialed(tags ? intoHead(page, tags) : page, !local(app))
}

// A browser fetches the manifest a page links without the person's cookies
// unless the link says `crossorigin="use-credentials"`, and the door of an
// app that is not public answers nobody without them: it sends the fetch to
// sign in, on yaks.app's own origin, where it fails. So every manifest link
// on the app's own origin is given that attribute, the platform's and the
// author's alike, and on a public app it costs nothing. A link naming a
// `crossorigin` of its own keeps it, and one to another origin is left as
// written, since that origin admits credentials only if it says so.
let elsewhere = /^\s*(?:[a-z][a-z\d+.-]*:|\/\/)/i
let hrefOf = (tag: string) =>
  /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag)
    ?.slice(1).find((v) => v != null) ?? ''
let credentialed = (page: string, cookies = true) =>
  page.replace(
    /<link\b[^>]*>/gi,
    (tag) =>
      declares(tag, 'link', 'rel', 'manifest') &&
        !/\scrossorigin\b/i.test(tag) && !elsewhere.test(hrefOf(tag))
        ? tag.replace(
          /^<link/i,
          `<link crossorigin="${cookies ? 'use-credentials' : 'anonymous'}"`,
        )
        : tag,
  )

// What an app's manifest says when the app wrote none: its name, its own root
// as the scope a standalone window stays inside, the icon at the two sizes an
// installer looks for, and the two colours — the app's own, or the platform's
// (`themeColorOf`/`backgroundColorOf` above). The same icon file at both
// sizes — one square png, the app's own or its icon.svg drawn at 512
// (raster.ts), and resizing it at the edge would be a second set of bytes to
// serve and cache for an installer that scales anyway.
export let manifesting = (app: App, at: string) => ({
  name: app.title || app.slug,
  short_name: app.title || app.slug,
  start_url: at,
  scope: at,
  display: 'standalone',
  background_color: backgroundColorOf(app),
  theme_color: themeColorOf(app),
  icons: ['512x512', '192x192'].map((sizes) => ({
    src: `${at}icon.png`,
    type: 'image/png',
    sizes,
  })),
})

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
let pageTag = async (page: string) =>
  `W/"${(await sha256(new TextEncoder().encode(page))).slice(0, 32)}"`

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
// (T-34493), so the links `pinned` wove in are never dead. Both are the
// fallback and nothing more: an app with its own `icon.png` or its own
// `manifest.webmanifest` is served that, and one with an icon.svg is served
// its drawing (files.ts `icon`), because this is only reached where the files
// door had nothing.
//
// The icon is its space's logo, drawn square (logo.ts `logoIcon`, T-151744),
// so a church's or a shop's apps wear its picture; or, in a space without
// one, the platform's connector tile — opaque, square, 512 (site_test) — so
// an app on a home screen wears the platform's face rather than the browser's
// blank sheet. iOS fills a transparent icon with black, which is why the tile
// that carries its own ground is the right one to fall back to. A display
// mark (?display) keeps the original logo's alpha, or the transparent yak.
export let unwritten = async (
  req: Request,
  env: Env,
  space: Space,
  app: App,
  path: string,
  at: string,
) => {
  if (path == '/icon.png') {
    let display = new URL(req.url).searchParams.has('display')
    let bytes = display && space.logo
      ? await logoBytes(env, space, space.logo.sha)
      : null
    let logo = display
      ? bytes ? { bytes, type: space.logo!.type } : null
      : await logoIcon(env, space, app.eid)
    if (logo) {
      return new Response(logo.bytes as Uint8Array<ArrayBuffer>, {
        headers: { 'content-type': logo.type, 'cache-control': keeping(app) },
      })
    }
    let tile = await env.ASSETS.fetch(
      new Request(
        new URL(display ? '/yak.webp' : '/connector-512.png', req.url),
      ),
    )
    if (!tile.ok) return null
    return new Response(tile.body, {
      headers: {
        'content-type': display ? 'image/webp' : 'image/png',
        'cache-control': keeping(app),
      },
    })
  }
  if (path != '/manifest.webmanifest') return null
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

/**
 * Who may open an app's page. Its members, and anyone at all where the app is
 * public; the app's own worker coming back through its grant (`itself`) on any
 * app. A stranger to a private app is sent to sign in and handed back to the
 * page; someone signed in who is nobody there gets the same nothing-here a
 * wrong address gets, whether the app exists being its owner's to tell.
 */
export let pageDoor = (
  access: Access,
  who: Pick<Who, 'person' | 'role'>,
  itself: boolean,
): 'page' | 'sign-in' | 'nothing' =>
  itself || reads(mode(access), who.role)
    ? 'page'
    : who.person
    ? 'nothing'
    : 'sign-in'

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

// What the badge on an app's page opens (public/badge.js, T-131901), or null
// for no badge, which is the Plus plan's. A published app's badge opens its
// own page on yaks.app (app-page.ts), where whoever followed it can open the
// app and make their own copy; an app that is not published opens yaks.app.
export let badgeOf = (space: Space, app: App, env: Host) =>
  !free(space)
    ? null
    : app.published?.name
    ? pageAt(app.published.name, env)
    : hostUrl(env, '/')

// The badge and what it says of a site's preview (newcomer.ts
// `previewing`): every plan's preview wears it, saying whose site it is not.
export let badged = (space: Space, app: App, env: Host): Scripts => {
  let preview = app.preview
    ? URL.parse(app.preview.site)?.hostname.replace(/^www\./, '') ?? null
    : null
  return preview
    ? { badge: badgeOf(space, app, env) ?? hostUrl(env, '/'), preview }
    : { badge: badgeOf(space, app, env) }
}

// The platform's scripts a page wears as the files door hands it: none when
// an app's worker asked for it, since what the worker answers is woven on its
// way out (`reported`), and the browser would run each script twice.
// Otherwise its badge is `badgeOf` and its bar `barOf`.
export let worn = (
  req: Request,
  space: Space,
  app: App,
  env: Host,
  who: Who,
): Scripts | null => bearing(req) ? null : wearing(space, app, env, who)

// What every page the door serves this caller wears.
export let wearing = (
  space: Space,
  app: App,
  env: Host,
  who: Who,
): Scripts => ({
  ...badged(space, app, env),
  bar: barOf(env, app, who),
})

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
  if (decoded == null || inside(decoded)) return false
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
  bare = at,
  // A sandboxed app's page is woven these tags too: its storage (installed.ts
  // `stored`), asked for only once the file turns out to be a page.
  sandbox?: () => Promise<string>,
) => {
  let prefix = prefixOf(space, app)
  let decoded = decodedPath(path)
  if (decoded == null || inside(decoded)) return nothingHere(env)
  // Asked beside the page's bytes, not before them: no page waits on it.
  let gone = files.page(path)
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
  let base = files.baseOf(at, got.headers.get(files.FILE) ?? '', !!app.rooted)
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

// A page as the browser gets it: the app's address before its own first
// relative URL, the tags a home screen needs, its release's asset addresses,
// any tags the caller adds, and the platform's scripts (`worn`), left out when
// `scripts` is null. The weaving is done here rather than
// behind the cache because the same file is a different document at each
// mount, and one cached copy of the bytes serving every mount beats one copy
// per mount.
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
) => {
  let own = pinned(at, mapped(original, at, bare, app.source, base), app)
  let page = released(
    new Response(based(base, tags ? intoHead(own, tags) : own)),
    original,
    at,
    bare,
    app.source,
    base,
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
  if (decoded == null || inside(decoded)) {
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
// door, named as an endpoint group, with nel asking for the failures that
// never reached us at all.
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
    `yak="${new URL(`${at}api/report`, req.url).href}"`,
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

// Reports per app per minute (lib/flood.ts): a page in a render loop that
// throws every frame must not write a thousand entities a second.
let over = flood(30)
let flooding = (space: Space, app: App) => over(`${space.eid}/${app.eid}`)

// What the upload says these bytes are, and what to call them. The mime is
// the request's own content-type, minus its parameters; the name rides
// `x-yak-name` percent-encoded, since a header is ASCII and a file's name is
// not (public/client.js encodes it).
let mimeSent = (req: Request) => {
  let said = (req.headers.get('content-type') ?? '').split(';')[0].trim()
    .slice(0, 120)
  return said && said.toLowerCase() != 'application/octet-stream'
    ? said
    : mimeOf(nameSent(req))
}

let nameSent = (req: Request) => {
  let sent = req.headers.get('x-yak-name')
  if (!sent) return ''
  try {
    return decodeURIComponent(sent).slice(0, 200)
  } catch {
    return sent.slice(0, 200)
  }
}

// Untaken, as a page reads it.
let untaken = (e: unknown) => {
  if (e instanceof Untaken) return json(e.status, e.code, e.message)
  throw e
}

// An upload's rows, written as the uploader through the app's own /apply, and
// the door's answer.
let recorded = async (
  graph: Meta,
  file: File,
  bytes: number,
  tags: Record<string, string>,
) => {
  try {
    await graph.apply(file.bundles, KERNEL)
  } catch (e) {
    // Kept by the store's write log (writes.ts): the bytes are stored and their
    // row lands when the app recovers, so the upload is not told it failed.
    if (!(e instanceof Pending)) return rejection(e, tags)
  }
  return answer(file, bytes)
}

// A page hands the app bytes and gets back an address (T-32677). The rows are
// the uploader's, written through the app's own /apply with them vouched for,
// so `.created` says who put it there.
let took = async (
  req: Request,
  env: Env,
  space: Space,
  app: App,
  store: Door,
  headers: Record<string, string>,
) => {
  let accepts = await acceptsOf(env, space, app)
  // A header is a claim, so the bytes are measured again once read (`filed`).
  admit(accepts, Number(req.headers.get('content-length') ?? 0))
  let bytes = new Uint8Array(await req.arrayBuffer())
  if (!bytes.byteLength) return json(400, 'no_bytes')
  let graph = metaOf(store, headers)
  let file: File
  try {
    file = await uploaded(env, space, app, graph, bytes, {
      mime: mimeSent(req),
      name: nameSent(req),
      accepts,
    })
  } catch (e) {
    if (e instanceof Untaken) throw e
    return rejection(e, {
      request: 'POST /api/blob',
      space: space.slug,
      app: app.slug,
    })
  }
  return answer(file, bytes.byteLength)
}

// What every upload door answers: the eid to point a row at, the address to
// read it from, and what it is.
export let answer = (file: File, bytes: number) =>
  Response.json({
    eid: file.sha,
    attachment: file.use,
    url: file.url,
    mime: file.mime,
    bytes,
    ...file.size,
  })

// The size of each part a file goes up in but the last (@yaks/blob `parts`),
// measured from this box and from a Worker (T-124790). At least 5 MiB, the
// least R2 takes.
export let PART = 8 * 1024 * 1024

// A file too big to send well in one request goes up in parts, resumably
// (@yaks/blob `parts`), addressed by its SHA-256 as a whole upload is:
//
//   POST blob/<sha> {bytes, name, mime}  where it stands: `{part, need}`, the
//                                        part size and the parts still to
//                                        send; once none are, it is finished
//                                        and answers as `POST blob` does
//   PUT  blob/<sha>/<n>                  part n, `part` bytes but the last,
//                                        `x-yak-state` the SHA-256 state the
//                                        bytes before it leave
//
// Every call is safe to send again, so a page that lost its connection, or
// its tab, asks where it stands and sends what is missing. What the app takes
// and the space's room are checked against the size it declares, and the
// parts' states must chain to the address before they are assembled, so what
// lands is what it said. Its type is read off the whole once assembled, and a
// whole the app does not take is deleted again. `writer` is whom the rows are
// written as, asked only when there are rows to write.
let inParts = async (
  req: Request,
  env: Env,
  space: Space,
  app: App,
  store: Door,
  writer: () => Promise<Record<string, string>>,
  path: string,
) => {
  let [sha, n, ...rest] = path.split('/')
  if (!/^[0-9a-f]{64}$/.test(sha) || rest.length) {
    return json(404, 'no_such_file')
  }
  let key = blobKey(space, app, sha)
  let up = parts(r2Objects(env.BLOBS), env.BLOBS, {
    key,
    sha,
    ledger: uploadPrefix(app),
    part: PART,
  })
  try {
    if (n != null) {
      if (req.method != 'PUT') return json(405, 'method_not_allowed')
      if (!/^[1-9][0-9]*$/.test(n)) return json(404, 'no_such_file')
      await up.put(
        Number(n),
        req.body ?? new Response('').body!,
        Number(req.headers.get('content-length') ?? NaN),
        req.headers.get('x-yak-state') ?? undefined,
      )
      return Response.json({ n: Number(n) })
    }
    if (req.method != 'POST') return json(405, 'method_not_allowed')
    let said = await req.json().catch(() => ({})) as {
      bytes?: unknown
      name?: unknown
      mime?: unknown
    }
    let bytes = Number(said.bytes)
    if (!(Number.isInteger(bytes) && bytes > 0)) return json(400, 'no_bytes')
    let accepts = await acceptsOf(env, space, app)
    admit(accepts, bytes)
    // Bytes the app already holds count nothing (usage.ts `fullFiles`).
    let stopped = await fullFiles(env, space, [{ key, bytes }])
    if (stopped) return json(413, 'space_full', stopped)
    let { part, need, whole } = await up.post(bytes)
    if (!whole) return Response.json({ part, need })
    let graph = metaOf(store, await writer())
    let name = String(said.name ?? '').slice(0, 200)
    let mime = String(said.mime ?? '').split(';')[0].trim().slice(0, 120)
    let file = await described(
      graph,
      app,
      sha,
      whole.head,
      mime && mime.toLowerCase() != 'application/octet-stream'
        ? mime
        : mimeOf(name),
      name,
      whole.bytes,
    )
    try {
      admit(accepts, whole.bytes, file.mime)
    } catch (e) {
      if (whole.made) await r2Objects(env.BLOBS).delete(key)
      throw e
    }
    return recorded(graph, file, whole.bytes, {
      request: 'POST /api/blob/<sha>',
      space: space.slug,
      app: app.slug,
    })
  } catch (e) {
    if (e instanceof Gone) return json(409, 'upload_gone', e.message)
    if (e instanceof Wrong) return json(400, 'refused', e.message)
    return untaken(e)
  }
}

/** Whether the bytes are served at all, which is the store's to say
 * (`servable`). For an app anyone may read, Files keeps a yes (files.ts
 * `servedAs`), so a burst of image reads is not a burst of store reads; a no
 * from it, and every read of a private or sandboxed app's, is asked here as
 * the reader. A store that could not say throws. */
export let servedTo = async (
  env: Env,
  space: Space,
  app: App,
  graph: Pick<Meta, 'query'>,
  sha: string,
  eid: string,
) => {
  let read = () => servable((q) => graph.query(q), app, sha, eid)
  return !sandboxed(app) && mode(app.access) != 'private'
    ? await files.servableOf(env, app, storeAt(space, app, env), sha, eid) ??
      await read()
    : await read()
}

/** Whether a request reads one of the app's files by its address: an upload
 * (`/api/blob/<sha>` or `/api/blob/<sha>/<representation>`), a release's
 * asset (`/api/assets/<release>/<path>`) or a platform module its pages
 * import (kept-page.ts `fixed`). Bytes, not the app's data. */
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
    : within(limit, source(req))

// The bare hash is the current attachment; the second path segment names an
// immutable representation. Only the bare address reads mutable metadata.
// The reader's browser keeps what it was given, the redirect for a week: every
// representation of one sha is the same bytes, so a kept redirect at worst
// names a file by an older name, and a removed file's representation is gone
// as its bare address is.
let REDIRECT = 'private, max-age=604800'
let gave = async (
  req: Request,
  env: Env,
  space: Space,
  app: App,
  store: Door,
  headers: Record<string, string>,
  path: string,
) => {
  let address = addressed(path)
  if (!address) return json(404, 'no_such_file')
  let { sha, eid } = address
  let graph = metaOf(store, headers)
  let blobs = r2Objects(env.BLOBS)
  if (!eid) {
    let current = async () => {
      let rows = await graph.query(`.entity.eid=${await useOf(sha)},${sha}&*`)
      let file = (rows as {
        attachment?: { mime?: string; name?: string }
      }[]).find((r) => r.attachment)?.attachment
      let artifact = (rows as { artifact?: { media_type?: string } }[])
        .find((r) => r.artifact)?.artifact
      if (!file && !artifact) return null
      let mime = file?.mime ?? artifact?.media_type ?? ''
      let name = file?.name ?? ''
      let rep = representation(app.eid, sha, mime, name)
      if ((await graph.query(`.entity.eid=${rep.eid}`)).length) return rep
      let bytes = await blobs.read(blobKey(space, app, sha))
      if (!bytes) return null
      let fixed = await contentType(bytes, mime)
      rep = representation(app.eid, sha, fixed, name)
      let bundles: Bundle[] = [{
        entity: { eid: rep.eid },
        representation: rep.row,
      }]
      if (fixed != mime) {
        if (file) {
          bundles.push({
            entity: { eid: await useOf(sha) },
            attachment: { mime: fixed },
            $was: {
              attachment: {
                blob: token(sha),
                mime: token(file.mime),
                name: token(file.name),
              },
            },
          })
        } else if (artifact) {
          bundles.push({
            entity: { eid: sha },
            artifact: { media_type: fixed },
            $was: { artifact: { media_type: token(artifact.media_type) } },
          })
        }
      }
      let applied = await graph.apply(bundles, KERNEL)
      if (
        !applied.some((b) =>
          b.entity.eid == rep.eid && b.representation &&
          represents(rep.eid, b.representation as typeof rep.row)
        )
      ) {
        throw new Error(
          `blob representation write was not applied: ${rep.eid}`,
        )
      }
      return rep
    }
    let rep
    try {
      try {
        rep = await current()
      } catch (e) {
        if (!(e instanceof Stale)) throw e
        rep = await current()
      }
    } catch (e) {
      return unavailable(e, {
        request: 'GET /api/blob',
        space: space.slug,
        app: app.slug,
      })
    }
    if (!rep) return json(404, 'no_such_file')
    let to = new URL(req.url)
    to.pathname += `/${rep.eid}`
    return new Response(null, {
      status: 302,
      headers: { location: to.href, 'cache-control': REDIRECT },
    })
  }
  let rep
  try {
    rep = await servedTo(env, space, app, graph, sha, eid)
  } catch (e) {
    return unavailable(e, {
      request: 'GET /api/blob',
      space: space.slug,
      app: app.slug,
    })
  }
  if (!rep) return json(404, 'no_such_file')
  let response: Served = {
    mime: rep.media_type,
    name: rep.name,
    etag: `"${eid}"`,
    cache: 'browser',
  }
  return blobResponse(
    (seek) =>
      files.blobBytes(
        env,
        app,
        blobPrefix(space, app),
        sha,
        seek.headers.get('range'),
        seek.method,
      ),
    sha,
    response,
    req,
    { request: 'GET /api/blob', space: space.slug, app: app.slug },
  )
}

// The public blob answer after access and representation selection: only
// byte failures become the uncached unavailable response.
export let blobResponse = async (
  read: (seek: Request) => Promise<Response>,
  sha: string,
  response: Served,
  req: Request,
  tags: Record<string, string>,
): Promise<Response> => {
  try {
    let bytes = await fencedVia(read, response, req)
    if (bytes.status == 404) {
      await bytes.body?.cancel()
      caught(new Error(`missing blob ${sha}`), tags)
      return json(404, 'no_such_file')
    }
    if (![200, 206, 304, 416].includes(bytes.status)) {
      await bytes.body?.cancel()
      throw new Error(`blob bytes answered ${bytes.status}`)
    }
    return bytes
  } catch (e) {
    caught(e, tags)
    return json(503, 'blob_unavailable')
  }
}

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
      let mine = { space, app, who }
      let homes = await borrowed(env, space, app, who)
      let bundles = batched(mutation)
      // A word this app uses lives in another app's store (T-32728), so a
      // bundle naming one is split the way the agent door splits it: the
      // borrowed word to its home, everything else here. One logical batch —
      // every part is admitted before any of them commits.
      if (homes.length) {
        let out = await (await import('./reach.ts')).written(
          env,
          [mine, ...homes],
          mine,
          bundles,
          await named(env, who),
        )
        return {
          entities: [...new Set(out.bundles.map((b) => b.entity.eid))],
          aliases: out.aliases,
        }
      }
      let applied = await metaOf(store).apply(
        bundles,
        { ...vouched(who), ...await named(env, who) },
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

// The graph API, and the file door beside it. Who may do what to the store is
// the app's own `access` (T-32504): `public` reads to anyone and writes to a
// member, `open` writes to anyone with the link, `private` neither without a
// role — 401 to nobody, 403 to a member who may not. The file door is not
// part of that bargain: writing an app's bytes is always a member's, whatever
// the app lets its visitors save. Every internal request is built here, so the
// store sees the vouched headers and never the cookie.
export let api = async (
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
  // The store client an app's pages import (public/client.js), served beside
  // the doors it wraps so a page needs no address but its own. One file for
  // every app, so it comes from the platform's assets, not the app's blobs.
  // It is served as one module, its parts bundled in (client-assets.ts).
  if (path == '/client.js') return platformFile(req, env, '/_client.js')
  if (NAMED_CLIENT.test(path)) return namedClient(req, env, path)
  if (CLIENT.includes(path)) return platformFile(req, env, path)
  let store = appStore(env.STORE, space, app, env)
  // What the page (or the browser itself) says broke. Anyone may report —
  // a break belongs to whoever was looking at the page, and asking a
  // stranger to sign in first would lose exactly the breaks nobody sees.
  if (path == '/report') {
    if (req.method != 'POST') return json(405, 'method_not_allowed')
    // A page a verified bot renders, nobody is looking at (@yaks/platform/bots). It
    // loads on budgets and through proxies of its own, which drop loads our
    // doors answered, so a miss it reports is the bot's: filed, it reads as
    // the app's break, and a module it cut off would roll the release back
    // (tools.ts `recoverRelease`). Taken before the flood ceiling, so a bot's
    // render never spends the reports a person's page may need.
    if (isVerifiedBot(req)) {
      await req.body?.cancel()
      return new Response(null, { status: 204 })
    }
    if (flooding(space, app)) return json(429, 'too_many_reports')
    // A no somebody answered on purpose is not a break, whoever answered it:
    // the platform's own doors, or the app's worker relaying an outside
    // service's refusal (unseen.ts `refusal` is the one rule).
    let reports = broken(await req.text(), refusal)
    // The injected reporter names the page that ran, not the newest release.
    // Older reporters and the browser's Reporting API have no page version;
    // keep their serving-version fallback, read past the directory's cache.
    let version = reports.some((broke) => broke.version == null)
      ? await serving(env, space, app)
      : null
    for (let broke of reports) {
      await noted(
        { ...broke, version: broke.version ?? version },
        { env, space, app, request: req },
      )
      try {
        await (await import('./tools.ts')).recoverRelease(
          { env, dir, person: '' },
          space,
          app,
          broke,
          req.headers.get(ADDRESS) ?? req.url,
          mount,
        )
      } catch (e) {
        caught(e, {
          request: 'recover release',
          space: space.slug,
          app: app.slug,
        })
      }
    }
    return new Response(null, { status: 204 })
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
  // Signed out, the way through is to sign in (SAYS); signed in, it is the
  // owner's to grant, so the sentence says so, unless the owner already did.
  let refused = async (what = 'not_a_writer') =>
    who.person
      ? json(
        403,
        what,
        await refusedSaid(dir, space, app, who.person, what),
      )
      : json(
        401,
        what,
        SAYS[what],
        signInAt(req.headers.get('referer') || req.url, env),
      )
  let mayRead = reads(mode(app.access), who.role)
  let mayPost = edits(mode(app.access), who.role)
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
    // On a private app the worker is the gatekeeper (T-34303): a page it
    // serves to someone who may not read the app was woven these addresses,
    // and its files are the worker's to give or refuse at their own path, as
    // that page would have asked before its addresses were the release's.
    // A published app's release files are anyone's, as installing it hands
    // them out (`offered`), so Site can keep them (page-cache.ts `keepable`).
    if (!mayRead && !offered(app)) {
      let url = new URL(req.url)
      url.pathname = url.pathname.slice(0, -`/api${path}`.length) +
        versioned.path
      let own = await c.time(
        'worker',
        () => ran(env, space, app, new Request(url, req), who),
      )
      if (own && own.status != 404) return own
      await own?.body?.cancel()
      return refused('not_a_reader')
    }
    let source = `${space.store}/.releases/${app.eid}/${versioned.release}`
    if (source != app.source && !await dir.released(app, source)) {
      return json(404, 'no_such_file')
    }
    return versionedAsset(req, env, app, source, versioned.path, c)
  }
  if (path == '/release') {
    if (req.method != 'GET') return json(405, 'method_not_allowed')
    if (!mayRead) return refused('not_a_reader')
    let value = new URL(req.url).searchParams.get('version')
    let version = value == null || !/^[0-9]+$/.test(value) ? NaN : Number(value)
    if (!Number.isSafeInteger(version)) return json(400, 'invalid_version')
    try {
      let { releaseStatus } = await import('./release-status.ts')
      return Response.json(await releaseStatus(env, dir, app, version), {
        headers: { 'cache-control': 'no-store' },
      })
    } catch (e) {
      if (e instanceof Error && e.message == 'no_such_release') {
        return json(404, 'no_such_release')
      }
      throw e
    }
  }
  if (path == '/service' || path.startsWith('/service/')) {
    let { serviceRoute } = await import('./service-api.ts')
    return serviceRoute(req, env, dir, { space, app }, who, path)
  }
  if (path == '/commands') {
    if (req.method != 'GET') return json(405, 'method_not_allowed')
    if (!mayRead) return refused('not_a_reader')
    return Response.json(await commandsIn(env, space, app, who))
  }
  if (path == '/command') {
    if (!mayRead) return refused('not_a_reader')
    let [route] = commandRoutes({
      command: (name, args) =>
        commandIn(
          env,
          space,
          app,
          who,
          name,
          args,
          acting(env, space, app, who),
        ),
    })
    return route.handle(req)
  }
  // Who is looking, before the first write (T-32679). A page could only learn
  // this from a refusal, which is too late twice over: on an `open` app a
  // signed-out write has no `created.by`, so the page must ask a guest their
  // name and nothing said so; on a `public` one the sign-in bounce arrives
  // after the guest typed, and their work goes with them (C-32675 items 5 and
  // 6). `person` is null signed out, `via` is this browser's vouched instrument,
  // `name` is what to call them (never an
  // address — T-32654), `reads`/`writes` are this app's own access answered
  // for this caller, and `signIn` is where a signed-out visitor signs in,
  // holding this page as its return address — null once they are in.
  // `invited` is what a refusal would tell a signed-in friend the owner let in
  // (WAITING): their way through is the click in the letter, so the page
  // can say so before they type rather than offer them nothing (T-124071).
  // `visit` is null unless this is a stranger served the app from its sample
  // or a store of their own (visit.ts), when `kept` says whether that store is
  // an app of theirs yet: an app can word its own prompt to keep what they
  // made, beside the platform's bar.
  // Answered to anyone: a stranger learning they must sign in is the point.
  if (path == '/me') {
    let person = who.person
    // Asked together, so they travel as one trip (directory-copy.ts
    // `gathered`): each in turn was a round trip of the page's first wait.
    let [name, invited, join] = await Promise.all([
      person ? dir.nameAt(person) : null,
      invitedHere(dir, space, app, person, mayRead, mayPost),
      // The role pressing Join gives them, where the app's own rows list
      // them and it is more than they hold (join.ts), else null.
      joinable(env, dir, space, app, who),
    ])
    return Response.json({
      person,
      via: who.via ?? null,
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
    })
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
  // The app's platform doors use the same refusals as its store doors.
  let asked: Asked = { env, req, path, space, app, who, refuse: refused, json }
  let door = DOORS.get(path.split('/')[1])
  let mine = door && await (await door())(asked)
  if (mine) return mine
  // Taking money (sell.ts, T-34525). A read door as far as this app is
  // concerned — it reads the products the cart names and writes nothing — so it
  // asks `mayRead` and not `mayPost`: a public shop sells to a stranger, which
  // is what a shop is, and a private one sells to its members. The price comes
  // off the rows, never off the request, so what a caller can do here is buy
  // what the seller put on the shelf at the price the seller wrote.
  if (path == '/pay/checkout') {
    if (req.method != 'POST') return json(405, 'method_not_allowed')
    if (!mayRead) return refused('not_a_reader')
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
      async (line) => await metaOf(store, headers).query(line) as Product[],
      body,
    )
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
  // The vocabulary a page's local graph loads: this store's words and the
  // borrowed words its own manifest uses, from their component homes.
  if (path == '/vocab') {
    if (req.method != 'GET') return json(405, 'method_not_allowed')
    if (!mayRead) return refused('not_a_reader')
    let wire = await store.consume(
      '/api/vocab',
      readOr(async (res) =>
        (await res.json() as { keywords: unknown[] }).keywords
      ),
      {},
      headers,
    )
    if ('failed' in wire) return wire.failed
    let docs = await vocabulary(env, space, app, who, headers)
    if (!docs.ok) return docs
    return Response.json({ docs: await docs.json(), keywords: wire.read })
  }
  if (path == '/vocab.json') {
    if (!mayRead) return refused('not_a_reader')
    return vocabulary(env, space, app, who, headers)
  }
  if (path == '/query') {
    if (!mayRead) return refused('not_a_reader')
    // The page writes its filter as the query string itself and the Store takes
    // the whole line as one parameter (wire.ts `lined`). The ask then carries
    // the listing's own screen (listing.ts `asking`), so what a count counts is
    // what a list lists.
    try {
      let url = new URL(req.url)
      let live = url.searchParams.get('live') == '1'
      let line = live || url.searchParams.has('q')
        ? url.searchParams.get('q')
        : lined(url.search.slice(1))
      if (line == null) throw new Refused('/query needs a query: ?q=…')
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
  // A page with only its own words listens straight to its store. A page that
  // uses another app's word listens to every component home through one
  // socket (page-socket.ts); each frame answers its filters with the same
  // ownership rule as /query. The handshake is a read, and writes use /apply.
  if (path == '/ws') {
    if (req.headers.get('upgrade') != 'websocket') {
      return json(426, 'expected_websocket')
    }
    if (!mayRead) return refused('not_a_reader')
    // One round trip: the store answers the socket, or says which words the
    // app uses from other homes (graph.ts `/ws`), and only then are they read.
    let answer = await store(
      local(app) ? '/ws' : '/ws?uses=1',
      req,
      headers,
    )
    let uses = answer.status == 204 ? answer.headers.get(USES) : null
    if (uses == null) return answer
    let graph = await c.time(
      'uses',
      () => homed(env, space, app, who, JSON.parse(uses)),
    )
    if (graph.reach.length > 1) {
      return pageSocket(req, env, space, app, graph, headers)
    }
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
    // answers the resend as it answered the first (writes.ts `first`) rather
    // than keeping a second copy that its guards refuse once the first lands.
    // Each wire in, the same wire out (wire.ts): the page's envelope is
    // answered `{ok, aliases, bundles}`, and the Store's bare array, which a
    // page keeping its own copy sends, is answered with the batch as applied.
    let sent: unknown
    try {
      sent = JSON.parse(body)
      let graph = await sources(env, space, app, who, headers)
      let as = {
        ...(await named(env, who, app)),
        ...resend(req),
      }
      let applied = graph.reach.length > 1 || check
        ? (await (await import('./reach.ts')).written(
          env,
          graph.reach,
          graph.reach[0],
          batched(sent),
          as,
          check,
        )).bundles
        : await metaOf(store).apply(batched(sent), { ...headers, ...as })
      return Response.json(
        receipt(sent, applied),
      )
    } catch (e) {
      // Kept by the store's write log (writes.ts): the page's edit is safe
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
  if (path == '/blob') {
    if (req.method != 'POST') return json(405, 'method_not_allowed')
    let form = new URL(req.url).searchParams.has('form')
    if (form) {
      let denied = await (await import('./forms.ts')).formUpload(req, store)
      if (denied) return denied
    } else {
      if (!mayPost) return refused()
      let below = await unfloored()
      if (below) return below
    }
    return await took(req, env, space, app, store, {
      ...headers,
      ...(form ? KERNEL : await named(env, who, app)),
    }).catch(untaken)
  }
  if (
    path.startsWith('/blob/') && (req.method == 'POST' || req.method == 'PUT')
  ) {
    if (!mayPost) return refused()
    let below = await unfloored()
    if (below) return below
    return inParts(
      req,
      env,
      space,
      app,
      store,
      async () => ({ ...headers, ...(await named(env, who, app)) }),
      path.slice('/blob/'.length),
    )
  }
  if (path.startsWith('/blob/')) {
    if (req.method != 'GET' && req.method != 'HEAD') {
      return json(405, 'method_not_allowed')
    }
    if (!mayRead) return refused('not_a_reader')
    return gave(
      req,
      env,
      space,
      app,
      store,
      headers,
      path.slice('/blob/'.length),
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
    if (!writes(who.role) || who.guest || sandboxed(app)) return refused()
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
  // Publishing a file to anyone (public-files.ts) is the same member's act as
  // writing the app's files, and listing them is too: what this app put on
  // the public web is its members' business.
  if (path == '/public' || path.startsWith('/public/')) {
    if (!writes(who.role) || who.guest || sandboxed(app)) return refused()
    return await publicDoor(
      { req, env, dir, space, app, at: mount },
      path.slice('/public'.length),
    )
  }
  return json(404, 'not_found')
}

// The directory store is the platform's own — people, addresses, sign-in
// codes, memberships — and it is kernel data, not an app (T-32585). Nothing
// is served at its address to anyone, owner included: the kernel's parts read
// it directly through `storeOf` (directory.ts), and the owner's door to it is
// the MCP graph tier. `yak/platform` is an entity in the directory so the
// directory can describe its own store; it is not an app this handler serves.
export let kernels = (space: Space, app: string | null) =>
  space.slug == META.space && app == META.app

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
  let here = apps.filter((a) => !kernels(space, a.slug))
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
): Promise<{ page: Response; alone: Alone | null }> => {
  let who = await whoIs(req, env.SESSION_SECRET, seatOf, space.eid)
  let { all, mine } = shelf(apps, space, who)
  let owner = who.role == 'owner'
  let alone: Alone | null = !who.person
    ? 'stranger'
    : !who.role
    ? 'outsider'
    : null
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
    env.SESSION_SECRET,
    (p) => dir.role(space, p),
    space.eid,
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

/** An address as Site keeps it (page-cache.ts): served to nobody, fresh. */
export let edged = async (req: Request, env: Env) => {
  let copied = false
  let c = clock()
  let answer = await c.counting(async () =>
    timed(
      await served(req, env, c, true, () => {
        copied = true
      }),
      c,
      'site_',
    )
  )
  if (copied) answer.headers.set('x-yak-directory-copy', '1')
  return answer
}

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
    // Bytes the same for everyone (kept-page.ts `fixed`) set none either: a
    // cookie would keep them out of every cache, and no door of theirs uses
    // the instrument.
    // The browser's own cookies are kept, and told which stores it holds
    // (visit.ts `ownOf`), only where it is the browser asking.
    let remember = !pagePath(new URL(req.url).pathname) && !bearing(req) &&
      !req.headers.has('authorization') && !fixed(new URL(req.url).pathname)
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

// Serving an app, with the stopwatch running (timing.ts): every stage below
// that waits is named, so `Server-Timing` on the answer says where the time
// went — the directory, the app's own worker, the bytes — instead of leaving
// a second to guess at (T-33176).
//
// The order, and it is a rule rather than an accident (D-34197). For a
// request to `<space>.yaks.app<path>` — which is also every request a custom
// domain carries, whether it names the space or one app mounted at its root
// (index.ts `aimed`, T-34596) — five rungs, the first that answers winning:
//
//  1. Platform paths are the kernel's and no app routes them: `/.well-known/`
//     on a hostname of ours, where a site grants authority over a name that
//     is not the space's (@yaks/platform/routes `platform`, decided before this part), an
//     app's `/<app>/api/…` store doors, and the directory's own space, which
//     nothing is served at to anyone (T-32585).
//  2. An app's slug owns the first path segment: `/<app>/…` is that app — its
//     own worker first where it has one, its files behind it — whatever the
//     home app has at the same address, so a home page that wants `/garden`
//     has to be in a space where no app is called garden. A former slug
//     redirects here.
//  3. The home app answers every path no app claims, at the bare hostname,
//     asked exactly the way rung 2 asks an app: its worker first, its files
//     behind it. `/photo.png` is its file, `/about` its page.
//  4. The space's index is `/`'s last word — a space with no home app, or a
//     home app whose worker passed and which has no index.html — so a space
//     that exists is a door and not a 404 (pages.ts `spaceIndex`).
//  5. Every other path is a missing page: a 404 where the space has no home
//     app, and where it has one, the home app's own answer for an address with
//     no file (files.ts `resolve`, which follows its `not_found_handling`).
//
// Rungs 3 and 5 are one call. That is what makes the home app the space's
// router — a worker that sees every path no other app claims, and answers 404
// to pass (dispatch.ts `ran`), leaving the rest to its files.
//
// And one rung is opted into, between 1 and 2: the paths the home app named
// in `home.first` are its worker's before they are the owning app's
// (`firstly` below). Empty for almost every space, and it can only ever move
// a path from the app that owns it to the home app — never off the platform's
// own (rung 1), and never onto a space that asked for nothing.
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
): Promise<Response> => {
  let url = new URL(req.url)
  let r = route(hostOf(req, env), url.pathname, env)
  if (r.space == null) {
    return url.pathname == MANAGE || url.pathname.startsWith(`${MANAGE}/`)
      ? (await import('./manage.ts')).manage(req, env)
      : nothingAt(url.pathname, env)
  }
  // A page any visitor could be sent is answered from Site's cache, with no
  // wait on the directory. Only a pass needs a directory read here: Site
  // already resolved the address of every page it answers, including a 404.
  let direct = bound(env.DIRECTORY, dirPart.fetch, env)
  let dir = directory(direct, {
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
  // The space, the app at the address, the front page and the seat of the
  // person the cookie names, in one read of the directory: every rung below
  // asks one of them, and asking each in turn was a round trip apiece.
  // Site's request carries a cookie only at a session's own key (kept-page.ts
  // `visitor`), where it serves the person their own copy of a stranger's page.
  let [cookied, authenticated] = await Promise.all([
    sessionPerson(req, env.SESSION_SECRET),
    !edge && req.headers.has('authorization') && !bearing(req) &&
      url.pathname.includes('/api/')
      ? asking(env, req)
      : null,
  ])
  let person = authenticated?.who?.person ?? cookied
  if (!edge) {
    let session = cookied && cookieValue(req.headers.get('cookie'))
    let page = await asked(visitor, env, c, session || null)
    if (page) return page
  }
  let routing = c.time('route', () => dir.page(r.space!, r.app, person))
  // What `/me` tells a person beside their standing (api `/me`), asked with
  // the route so a page's first question waits on that one trip.
  if (person && !edge && url.pathname.endsWith('/api/me')) {
    dir.nameAt(person).catch(() => {})
  }
  let reading = routing.then((route) => route.space)
  // A seat, from that read for the person it asked about, else the directory.
  let seatOf = async (p: string) => {
    let { role } = await routing
    return p == person && role !== undefined ? role : dir.role(space!, p)
  }
  let space = await reading
  // Not a space here — but it may be where one used to be (T-34658): a rename
  // moves `space.slug` and keeps the old subdomain pointing at it, whole path
  // and query, the way a renamed app's old path does one level down. A
  // permanent move, because a space's address is on more links than an app's
  // and every one of them should heal itself.
  if (!space) {
    let was = await c.time('moved', () => dir.formerly(r.space!))
    if (was) {
      return moved(
        req,
        `https://${was.slug}.${apex(env)}${url.pathname}${url.search}`,
      )
    }
    let none = nothingAt(url.pathname, env)
    return edge ? keep(none, null, null) : none
  }
  if (kernels(space, r.app)) return nothingAt(url.pathname, env)
  // Its pages tell the browser whose this hostname's storage is now
  // (site-data.ts), on their way out of `fetch` below.
  if (!edge) serves(visitor, space.store)
  // The whole space in the trash, before any rung of the order below: every
  // hostname of it answers nothing, and its owner is answered the page that
  // brings it back (`closed` above, T-34431).
  if (space.trashed) {
    return appApi(url.pathname)
      ? nothingAt(url.pathname, env)
      : closed(req, env, dir, space)
  }
  // Where the dashboard was before it moved to the apex (T-39354): letters
  // and answers still carry these addresses, so each view is sent on to its
  // new one, query and all. A form posted from a page left open since has
  // nothing to land on and is sent to the page instead.
  if (url.pathname == OURS || url.pathname.startsWith(`${OURS}/`)) {
    let path = movedFor(MANAGE + url.pathname.slice(OURS.length), space.slug)
    if (!path) return nothingHere(env)
    let to = new URL(path, hostUrl(env))
    for (let [k, v] of url.searchParams) to.searchParams.append(k, v)
    return req.method == 'GET' || req.method == 'HEAD'
      ? moved(req, to.href)
      : redirect(to.href, 303)
  }
  // The builder's socket (build.ts, T-34240). A space's door, not an app's:
  // the person it is for has no app yet, so it is answered here — before the
  // home app is looked for, since a space with none would be a 404 at every
  // path but `/`. It is a platform path (router.ts), so no app routes it.
  // The live half of that chat (public/build.js, T-34242), served here so a
  // space's page needs no asset of the apex — the same rule as the client an
  // app's pages import, one file for every space. Nobody's secret: it is the
  // page's own script, and the door it opens still asks who is asking.
  if (url.pathname == `${BUILD}.js`) {
    return platformFile(req, env, '/build.js')
  }
  if (url.pathname == BUILD) {
    let posts = req.method == 'POST'
    if (!posts && req.headers.get('upgrade') != 'websocket') {
      return json(426, 'expected_websocket')
    }
    let who = await c.time(
      'who',
      () => whoIs(req, env.SESSION_SECRET, seatOf, space!.eid),
    )
    if (!who.person) {
      return json(401, 'not_a_writer', NOBODY, signInAt(url.href, env))
    }
    if (!writes(who.role)) return json(403, 'not_a_writer', NOT_A_WRITER)
    // A form POST is the browser that ran no script (build.ts `posting`): one
    // line, the round waited for, and a page back.
    return posts
      ? posting(env, space, req, who)
      : joining(env, space.eid, req, who)
  }
  // The app at the address and the space's front page, in one read: every
  // rung below that needs the front page (rung 1½, rung 3) has it already.
  let { app, home } = await routing
  // In the trash (erase.ts, T-34430): the address is held for it and answers
  // nothing while it waits. Not a 410 and not a redirect — to the web this is
  // an address with nothing at it, which is what a delete has always meant —
  // and only the space's own people are told where the app went, since a
  // stranger learning that an app was deleted here learns something that is
  // not theirs.
  if (app?.trashed) {
    if (appApi(url.pathname)) {
      return nothingAt(url.pathname, env)
    }
    let who = await c.time(
      'who',
      () => whoIs(req, env.SESSION_SECRET, seatOf, space!.eid),
    )
    return who.role == 'owner'
      ? binned({
        space: space.slug,
        title: app.title || app.slug,
        days: daysLeft(app.trashed),
      }, env)
      : nothingHere(env)
  }
  if (r.app && !app) {
    // Not an app here — but it may be where one used to be (directory.ts
    // former): a rename moves the address and keeps the old one pointing at
    // it, files and `/api/…` alike.
    let was = await dir.former(space, r.app)
    if (was) return moved(req, `/${was.slug}${r.path || '/'}${url.search}`)
  }
  // The space's front page is served at its bare hostname (T-33040): rung 3
  // above. Before this the root answered a 302 into `/<app>/`, so the
  // sub-path was in the address bar and in every link anyone copied. On a
  // customer's own domain that is the whole point: her site has to be at
  // herbusiness.com (T-33035, index.ts `aimed`), and one rule serves both
  // hostnames.
  //
  // A custom domain arrives already mounted at its own root (index.ts
  // `aimed` sets the header): the app is the domain's `/` however the
  // platform's own address writes it, so it is not forwarded anywhere — the
  // forward would land back on the address that arrived — and its pages
  // resolve from that root.
  let mount = req.headers.get(MOUNT)
  let path = r.path
  let front = !!app && app.home
  // Site keeps what is the same for everyone (page-cache.ts `keepable`): the
  // own files of an app anyone may read (public or open), and the release
  // files of one anyone may install. From a directory copy a moment old it
  // keeps only a public app's.
  let keeps = (app: App, path: string) =>
    keepable(app, path) && !(dir.stale && app.access != 'public')
  if (!app) {
    // Which app is home is a directory read, so it was read above, where env
    // is, and not in @yaks/platform/routes, which is pure (index.ts `aimed`, same reason).
    // No front page at all — the ordinary state of a space, since being the
    // first app claims nothing (tools.ts `app_new`). Rung 4 at the bare
    // address, rung 5's 404 anywhere else: there is no home worker to be the
    // fall-through, so a path under such a space names nothing and says so.
    if (!home || kernels(space, home.slug)) {
      if (url.pathname != '/') {
        // The same 404 for everyone, kept until the space routes anew.
        let none = nothingAt(url.pathname, env)
        return edge ? keep(none, space, null) : none
      }
      // A stranger's view is the same for every stranger, so Site keeps it
      // for them, and a person is never answered it (kept-page.ts `asked`):
      // one with no seat here is answered their own, kept at their session's
      // key, and a member's is never kept.
      let { page, alone } = await index(
        req,
        env,
        space,
        (await routing).roster!,
        seatOf,
      )
      if (!edge) return page
      return alone ? marked(keep(page, space, null, [200], alone)) : passed()
    }
    // `/<x>/api/…` named an app that is not here. That is a wrong address,
    // not one of the front page's own paths: a page asking a store there has
    // to hear a 404, never a page of HTML it cannot parse (C-32574 item 4).
    if (r.app && (r.path.startsWith('/api/') || webPath(r.path))) {
      return nothingAt(url.pathname, env)
    }
    app = home
    front = true
    path = url.pathname
  } else if (!mount && front && (path == '' || path == '/')) {
    // The home app's own `/<app>/` forwards to the bare hostname, so its
    // address is that and nothing else, and links anybody already holds still
    // arrive. Temporary, not permanent — which app is home is a word the owner
    // moves from one app to another (tools.ts `app_set`), and a 301 a browser
    // cached would outlive the move.
    return redirect(`/${url.search}`)
  } else if (path == '') {
    // `/<app>` itself, sent to its slash, which is how a link is often
    // shared, its query with it. Site keeps the forward as it keeps the page
    // behind it, so a visitor following one waits on no directory read and is
    // given no cookie, and the visitor's query is put back on as it is served
    // (kept-page.ts `asked`).
    let slash = redirect(`${url.pathname}/${url.search}`)
    if (!edge) return slash
    return keeps(app, path) ? marked(keep(slash, space, app, [302])) : passed()
  }
  // The app's own worker, coming back through its service binding for its
  // store or its files (dispatch.ts): the grant says who it is acting as, so
  // there is no cookie to read — and a request holding one is never sent back
  // to the worker, which is what keeps `env.FILES.fetch('/index.html')` from
  // being a loop.
  // Where this app is mounted for the browser that asked: the prefix its
  // pages resolve relative URLs against, and where its reporter lives.
  let bare = mount ?? (front ? '/' : `/${app.slug}/`)
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
        open,
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
  let store = storeName(space, app)
  if (
    paper && (!env.SESSION_SECRET ||
      !await paged(paper.token, env.SESSION_SECRET, store))
  ) return json(401, 'not_a_reader', 'This page token does not open this app')
  // The app acting as itself (`owning`) has no seat: its standing is its own.
  let itself = await granted(
    req,
    env.SESSION_SECRET,
    store,
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
    ? await paged(bearerOf(req)!, env.SESSION_SECRET, store)
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
          ? presented(req, env, seatOf, space!, store, paper?.token, path)
          : whoIs(req, env.SESSION_SECRET, seatOf, space!.eid),
    )
  if (path.startsWith('/api/') && !itsApp(who, app)) {
    // The route read the cookie's person's claims; any other caller asks.
    let { browsers } = await routing
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
          page,
          early.app.version ?? 0,
          badged(space, early.app, env),
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
    let { grants } = await routing
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
  let stranger = { app, who, release: null as Release | null }
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
      ;({ app, who, visit } = visiting(space, app, who, own, release))
    }
    if (own && due(own.seen)) background(used(env, who.via!, app.eid))
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
  if (webPath(path)) {
    if (req.method != 'GET' && req.method != 'HEAD') {
      return json(405, 'method_not_allowed')
    }
    // The data editor is a person's page, not a machine door: anyone who holds
    // a level on this app opens it, a guest included, and it writes only what
    // the store lets them. Everyone else meets what a page would tell them.
    if (dataPath(path)) {
      if (edge) return passed()
      if (!who.person) return redirect(signInAt(req.url, env), 303)
      if (!who.role || !reads(mode(app.access), who.role)) {
        return nothingHere(env)
      }
      if (path == DATA_SCRIPT) return platformFile(req, env, '/data.js')
      if (path.startsWith(DATA_ASSETS)) return dataAsset(req, env, path)
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
    if (!who.person) {
      return json(
        401,
        'not_a_reader',
        SAYS.not_a_reader,
        signInAt(req.url, env),
      )
    }
    if (!who.role || who.guest) {
      return json(403, 'not_a_reader', MEMBER.not_a_reader)
    }
    if (!reads(mode(app.access), who.role)) {
      return json(403, 'not_a_reader', MEMBER.not_a_reader)
    }
    if (path.startsWith('/_web/web/')) {
      return webAsset(req, env, path.slice('/_web/web/'.length))
    }
    if (path == '/_web/inspect/app.js' || path == '/_web/inspect/styles.css') {
      return webAsset(req, env, path.slice('/_web/'.length))
    }
    return webPage(req, env, url.pathname.slice(0, -path.length), who.person)
  }
  // The `/api/` doors stay the kernel's, always, and keep their own refusals,
  // which speak.
  //
  // A sandboxed app's answers, every one, are walled (installed.ts).
  let wall = (res: Response) => walls ? walled(res) : res
  if (path.startsWith('/api/')) {
    // Site keeps an app's `fixed` bytes as it keeps its pages, the hop a
    // release's module takes back out to the API included; every other door
    // is the gateway's.
    if (edge) {
      if (!fixed(path)) return passed()
      return marked(
        keep(
          reporting(
            await api(req, env, dir, space, app, path.slice(4), who, c, at),
            req,
            at,
            app,
          ),
          space,
          app,
          [200, 302, 404],
        ),
      )
    }
    // A stranger's reads are held to a rate per source (rate.ts), here and
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
    let moved = visit == 'sample' && path == '/api/apply' &&
      req.method == 'POST'
    if (moved) {
      // A store costs the platform until it is installed, so a source makes
      // only so many a minute, and an app's strangers hold only so many.
      if (
        !await within(env.BIRTH_RATE, source(req)) ||
        await crowded(env, stranger.app.eid)
      ) {
        await req.body?.cancel()
        return wall(reporting(
          json(
            429,
            'sign_up',
            SAYS.sign_up,
            signInAt(req.headers.get('referer') || req.url, env),
          ),
          req,
          at,
          app,
        ))
      }
      let own = await c.time(
        'birth',
        () => born(env, space!, stranger.app, who.via!, who.person),
      )
      tellBorn(visitor, who.via!, stranger.app.eid)
      ;({ app, who, visit } = visiting(
        space,
        stranger.app,
        stranger.who,
        own,
        stranger.release,
      ))
    }
    let answer = await c.time(
      'api',
      () => api(req, env, dir, space!, app!, path.slice(4), who, c, at),
    )
    if (moved) {
      answer = new Response(answer.body, answer)
      answer.headers.set(MOVED, '1')
    }
    let apiPath = path.slice(4)
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
        apiPath.startsWith('/blob') || apiPath.startsWith('/files/'))
    ) scheduleBy(env, who, app.eid)
    return wall(reporting(answer, req, at, app))
  }
  // A private app hides its page too, not only its data (C-32607 item 5):
  // `access: private` says only its members can see it, and its files are
  // part of what they see. A stranger is sent to sign in and handed back to
  // the page (T-32593); someone signed in who is nobody here gets the same
  // nothing-here a wrong address gets — whether the app exists at all is its
  // owner's to tell.
  //
  // Its own worker is the exception, both ways round (T-34303). The worker
  // runs ahead of this gate, and a request coming back from it passes the gate
  // — `itself` is a grant the kernel minted for this store and this request,
  // which nothing but this app's own worker can hold, so `env.FILES` reads the
  // app's pages where a stranger asking directly is refused. On a private app
  // the worker is the gatekeeper: `access` is one word about the whole store,
  // and a rule finer than that — the invitation code that opens one
  // household's row and no other — can only live in the app's own code. What
  // that code may do as the app is `env.APP` and nothing else; its `env.STORE`
  // is still the visitor, so a worker that only passes a store read on refuses
  // exactly what the page would have.
  if (/^\/form\/[^/]+$/.test(path)) {
    if (edge) return passed()
    let name = decodedPath(path.slice('/form/'.length))
    if (!name) return json(404, 'not_found')
    // The store shows a form it holds (an empty 204 on code from before it
    // did), and only that it holds one matters here. The form is the app's
    // own, whatever store a stranger's visit serves the page from.
    let found = await appStore(env.STORE, space, stranger.app, env).consume(
      `/form?${new URLSearchParams({ name })}`,
      async (r) => {
        await r.body?.cancel()
        return r.ok ? null : r.status
      },
      {},
      KERNEL,
    )
    if (found) return json(found, 'not_found')
  }
  let door = pageDoor(app.access, who, !!itself)
  let mayRead = door == 'page'
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
      bare,
      walls ? () => storing(env, space!, app!, who, at) : undefined,
    )
    : null
  file?.catch(() => {})
  let own = itself
    ? null
    : await c.time('worker', () => ran(env, space!, app!, req, who))
  // The worker's 404 is its pass. The files answer behind it, and where they
  // hold nothing either, that 404 is the app's answer: a stranger is sent to
  // sign in for a page the app has, never for one it does not.
  let pass = own?.status == 404 ? own : null
  if (pass) own = null
  // The worker passed, and the files are not this visitor's to see.
  if (!own && !file && (!pass || await held(env, space, app, path))) {
    await pass?.body?.cancel()
    if (door == 'sign-in') return redirect(signInAt(req.url, env), 303)
    return await shut(
      env,
      dir,
      space,
      app,
      { person: who.person!, role: who.role, guest: who.guest },
      bare,
    )
  }
  // The worker's page, else the files', else the worker's 404.
  let page = own ?? (file && await file) ?? pass ?? nothingHere(env)
  if (page != pass) await pass?.body?.cancel()
  // File pages already pass through woven(). Worker pages use the same
  // reporter, without buffering or changing their navigation and asset URLs.
  if (
    (page == own || page == pass) && page.body &&
    page.headers.get('content-type')?.startsWith('text/html')
  ) {
    page = await reported(
      env,
      at,
      page,
      app.version ?? 0,
      wearing(space, app, env, who),
      appPreview(app, bare),
      req.headers.get(ADDRESS) ?? req.url,
    )
  }
  // Rung 4, and it is last rather than fourth in the code because rungs 3 and
  // 5 are the one call above: the space's index answers `/` when the home app
  // has nothing there — its worker passed and its files have no front page.
  // Only the home app can be at `/` (@yaks/platform/routes `route` names no app for it, so
  // this is the fall-through), which is why the home app is the whole of the
  // test. A path that is not `/` keeps the 404: an address inside a space that
  // nothing answers is nothing, not a listing.
  if (page.status == 404 && url.pathname == '/') {
    await page.body?.cancel()
    return edge
      ? passed()
      : (await index(req, env, space, (await routing).roster!, seatOf)).page
  }
  // Site's page is counted by the gateway that sends it (page-cache.ts).
  if (edge) return marked(keep(reporting(page, req, at, app), space, app))
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
): Promise<Who> => {
  let sent = token ?? bearerOf(req)
  if (!sent) {
    return path.startsWith('/api/')
      ? nobody
      : whoIs(req, env.SESSION_SECRET, roleOf, space.eid)
  }
  let p = env.SESSION_SECRET
    ? await paged(sent, env.SESSION_SECRET, store)
    : null
  if (!p) return whoIs(req, env.SESSION_SECRET, roleOf, space.eid)
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
