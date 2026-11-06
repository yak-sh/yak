import { refuse as refusedOptions, writeOptions } from '@yaks/api'
import { decodedPath } from './request-path.ts'
import { BINARY } from '@yaks/vocab/wire'
import { copyOf } from './directory-copy.ts'
// The app-serving part: `<space>.yaks.app/<app>/…` — the deploy seam's first
// hosted implementation (D-32318 §v1 sequencing). One fetch handler: it
// reads the hostname and path (route.ts), resolves the space and app through
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
import { apex, type Host, spaceHost, url as hostUrl } from './host.ts'
import { r2Objects, r2RawObjects } from './lib/objects.ts'
import { BUILD, joining, NOBODY, NOT_A_WRITER, posting } from './build-door.ts'
import { browserImmutable } from './cache.ts'
import {
  apiOut,
  assetMaps,
  assetPath,
  assetUrl,
  releaseId,
} from './asset_url.ts'
import * as files from './files.ts'
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
  paid,
  type Role,
  type Seat,
  type Space,
  storeAt,
  storeName,
  url as urlOf,
} from './directory.ts'
import * as dirPart from './directory.ts'
import { ahead, bearing, granted, itsApp, ran } from './dispatch.ts'
import { bound, type Env } from './env.ts'
import type { Mail } from './mail.ts'
import type { Beside } from './operator-page.ts'
import { pageAt, pilled, standing } from './gallery.ts'
import { billedTo, checkout, planCard, portal, wanted } from './billing.ts'
import { payments, plans } from './payments.ts'
import { connecting, connectionsOf, enabled } from './connections.ts'
import {
  buying,
  connect,
  disconnect,
  feeOf,
  type Product,
  rate,
  refusedSell,
  selling,
} from './sell.ts'
import {
  type Accepts,
  addressed,
  broken as undecoded,
  fits,
  Gone,
  mediaTypeOf,
  mimeOf,
  parts,
  representation,
  represents,
  type Served,
  servedVia as fencedVia,
  type Size,
  sizeOf,
  taken,
  takes,
  Wrong,
} from '@yaks/blob'
import { contentType } from '@yaks/blob/identify'
import { declarationOf } from './declaration.ts'
import { KERNEL, type Meta, metaOf, minted } from './meta.ts'
import { Pending } from './writes.ts'
import { batched, lined, receipt, resend } from './wire.ts'
import {
  binned,
  desk as deskPage,
  type DeskPage,
  editor,
  invitedTo,
  LOGO,
  nothingHere,
  sentence,
  spaceBinned,
  spaceIndex,
  type Visits,
} from './pages.ts'
import { allowed, placeOf, send } from './invite.ts'
import { peopleIn } from './people.ts'
import { CallError } from '@yaks/tools/errors'
import { untrash, untrashSpace } from './erase.ts'
import {
  type AccountView,
  accountView,
  chatPath,
  hostOf,
  landing,
  logoPath,
  MANAGE,
  manageAt,
  managed,
  managePath,
  type ManageView,
  MOUNT,
  movedFor,
  OURS,
  paged as pagePath,
  route,
  signInAt,
  SLUG,
  type SpaceView,
} from './route.ts'
import { covers, PLATFORM_PATHS } from './router.ts'
import {
  browsing,
  nobody,
  sessionPerson,
  titling,
  vouched,
  type Who,
  whoIs,
} from './session.ts'
import { asking } from './identity.ts'
import { nameOf } from './signin.ts'
import { written } from './reach.ts'
import {
  borrowed,
  homed,
  local,
  queried,
  sources,
  vocabulary,
} from './page-graph.ts'
import { pageSocket } from './page-socket.ts'
import { DATA_SCRIPT, dataPath, webAsset, webPage, webPath } from './web.ts'
import { releaseStatus } from './release-status.ts'
import { pageSpeaks } from './lenses.ts'
import { admitted, pageScript, type Scripts } from './page-script.ts'
import { appDoc } from './vocab.ts'
import type { Bundle } from '@yaks/graph'
import { Refused, Stale } from '@yaks/graph/errors'
import { mistaken } from './mistake.ts'
import { token } from '@yaks/graph/sha256'
import { callStored } from './package-tools.ts'
import { edits, mode, reads, writes } from '@yaks/member'
import { type Door, USES } from './door.ts'
import { type Clock, clock, timed } from './timing.ts'
import { asked, keep, keepable, passed, told, unkept } from './page-cache.ts'
import { CLIENT, fixed } from './kept-page.ts'
import {
  brokenIn,
  fault,
  noted,
  refusal,
  serving,
  trackedIn,
} from './unseen.ts'
import { broken } from '@yaks/tracker/report'
import { flood } from './lib/flood.ts'
import { isVerifiedBot } from './lib/bots.ts'
import { drafted, fullAt, hashed, recoverRelease, TOOLS } from './tools.ts'
import { stale } from './toolkit.ts'
import { ask } from './remake.ts'
import { ADDRESS } from './route.ts'
import { background, caught, defect, refusing } from './defects.ts'
import { invitation } from './referral.ts'
import {
  barOf,
  born,
  crowded,
  due,
  MOVED,
  onSample,
  type Release,
  releaseFor,
  used,
  visitable,
  type Visiting,
  visiting,
  visitOf,
} from './visit.ts'
import { full, fullFiles } from './usage.ts'
import { budget, free, gauges, size, spent } from './meter.ts'
import { scheduleBy } from './used.ts'
import { sha256 } from './versions.ts'
import { DAYS, NOT_ON, seen, stats, statsFor, viewed } from './views.ts'
import { own as connection } from './connections.ts'
import { envDoor, fetchDoor } from './outbound.ts'
import { modelRun, recovery } from './models.ts'
import { documents } from './document-search.ts'
import { voice } from './rtc.ts'
import { speechDoor } from './speech.ts'
import { notices } from './notices.ts'
import { reach } from './tunnel.ts'
import { refuse } from './tool.ts'
import { letIn, letOut } from './operator-reach.ts'
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
 * invitation waits, if the owner let them in, else that nothing is here. */
export let shut = async (
  dir: Parameters<typeof waiting>[0],
  space: Space,
  app: App,
  person: string,
  env: Host,
) =>
  await waiting(dir, space, app, person, 'not_a_reader')
    ? invitedTo(app.title || app.slug, env)
    : nothingHere(env)

let json = (
  status: number,
  code: string,
  says = SAYS[code],
  signIn?: string,
) =>
  Response.json(
    { error: { code, message: says ?? code, ...(signIn ? { signIn } : {}) } },
    { status },
  )

// A refusal, or a store's answer it relays, keeps its HTTP status through the
// page's error envelope. A failure raised here is reported with the door's
// tags and thrown on, never answered as the page's mistake (defects.ts
// `refusing`).
let rejection = (error: unknown, tags: Record<string, string>) =>
  json(
    refusing(error, tags),
    'refused',
    error instanceof Error ? error.message : String(error),
  )

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

// Where a refusal sends someone who has not signed in (route.ts `signInAt`).
// At the file door the page to return to is the request itself; at an `/api/`
// door — nowhere to return to — it is the Referer, and the request's own
// address when the browser sent none.

let redirect = (to: string, status = 302) =>
  new Response(null, { status, headers: { location: to } })

// An address the app has left, answered as the move it was. Permanent, so a
// link someone holds heals itself — 301 for a read, 308 for everything else,
// because a 301 is retried as a GET and a page writing to its old `/api/apply`
// would land on the new one as a read (C-32574 item 4).
let moved = (req: Request, to: string) =>
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
export let reported = async (
  env: Env,
  at: string,
  page: Response,
  version: number,
  scripts: Scripts,
) => {
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
let assetReserved = (path: string) =>
  path == `${BUILD}.js` || PLATFORM_PATHS.some((p) => covers(p, path))
let mapped = (
  html: string,
  at: string,
  bare: string,
  source: string | null | undefined,
  base = at,
) => {
  let id = releaseId(source)
  return id && !hasBase(html)
    ? assetMaps(html, at, bare, id, assetReserved, base)
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
      let next = assetUrl(ref, at, bare, id, assetReserved, base)
      if (next != ref) el.setAttribute(attr, next)
    },
  })
  rewrite.on('script[src]', move('src'))
  rewrite.on('img[src]', move('src'))
  rewrite.on('audio[src]', move('src'))
  rewrite.on('video[src]', move('src'))
  rewrite.on('video[poster]', move('poster'))
  rewrite.on('source[src]', move('src'))
  rewrite.on('link[href]', {
    element: (el) => {
      let rel = (el.getAttribute('rel') ?? '').split(/\s+/)
      let as = el.getAttribute('as') ?? ''
      if (
        rel.includes('stylesheet') || rel.includes('modulepreload') ||
        (rel.includes('preload') &&
          ['style', 'script', 'font', 'image', 'audio', 'video'].includes(as))
      ) move('href').element(el)
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

// The platform's own palette (public/tokens.css `--meadow`/`--linen`), for an
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
// The icon is the platform's connector tile — opaque, square, 512 (site_test)
// — so an app on a home screen wears the platform's face rather than the
// browser's blank sheet. iOS fills a transparent icon with black, which is why
// the tile that carries its own ground is the right one to fall back to.
export let unwritten = async (
  req: Request,
  env: Env,
  app: App,
  path: string,
  at: string,
) => {
  if (path == '/icon.png') {
    let tile = await env.ASSETS.fetch(
      new Request(new URL('/connector-512.png', req.url)),
    )
    if (!tile.ok) return null
    return new Response(tile.body, {
      headers: { 'content-type': 'image/png', 'cache-control': keeping(app) },
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
let wearing = (space: Space, app: App, env: Host, who: Who): Scripts => ({
  badge: badgeOf(space, app, env),
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
    if (await stale(env, source)) await ask(env, { app: app.eid, source })
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
  // A folder asked for without its slash is sent to it (files.ts `resolve`),
  // keeping the query: the location is relative, so it holds at any mount.
  let to = got.status == 307 ? got.headers.get('location') : null
  if (to) {
    await got.body?.cancel()
    return folderMove(to, new URL(req.url).search, keeping(app))
  }
  // The app's own 404.html answering a page that is not there.
  let lost = got.status == 404 && got.headers.has(files.FILE)
  if (![200, 206, 416].includes(got.status) && !lost) {
    await got.body?.cancel()
    return await unwritten(req, env, app, path, bare) ?? nothingHere(env)
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
    page = await reported(env, at, page, app.version ?? 0, scripts)
  }
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
let reporting = (res: Response, req: Request, at: string) => {
  // A socket is not a page: the 101 carries the runtime's own `webSocket`,
  // which no Response constructor here can copy, and nothing about it reports.
  if (res.status == 101) return res
  let headers = new Headers(res.headers)
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

// The bytes' own name (versions.ts `sha256`, the content address a version's
// manifest is made of) is the object's key and the entity's eid here, so the
// same photo sent twice is one object and one row.
//
// The app's one use of those bytes, addressed off them: derived, so an upload
// finds its own attachment row without reading for it, and the same file sent
// again is that row renamed.
let useOf = (sha: string) =>
  sha256(new TextEncoder().encode(`attachment:${sha}`))

// Where an app's uploaded bytes live: the prefix its row was born with
// (blob-key.ts `blobPrefix`), which no rename moves and erasing the app
// empties (erase.ts `emptied`). Deleting the upload's content row deletes
// them sooner (facets/app-effects.ts `delete_upload`).
let blobKey = (space: Space, app: App, sha: string) =>
  blobPrefix(space, app) + sha

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

/**
 * A blob the app does not take (`"blob"` in its vocab.json, @yaks/blob
 * `Accepts`): bigger than it says, or of a type it does not list, read off the
 * bytes. Nothing declared takes everything; the limits are its author's.
 */
export class Untaken extends Error {
  status: number
  code: string
  constructor(status: number, code: string, says: string) {
    super(says)
    this.status = status
    this.code = code
  }
}

/** What the app takes as a blob, from the release serving it. */
export let acceptsOf = async (env: Env, space: Space, app: App) =>
  (await declarationOf(env, space, app)).vocab.blob as Accepts | undefined

// Refused, when `bytes` bytes, or bytes read as `type`, are not taken.
let admit = (a: Accepts | undefined, bytes: number, type?: string) => {
  if (!fits(a, bytes)) {
    throw new Untaken(
      413,
      'too_large',
      `this app takes files of at most ${size(a!.maxLength!)}`,
    )
  }
  if (type != null && !takes(a, type)) {
    throw new Untaken(
      415,
      'unsupported_media_type',
      `this app takes ${taken(a)}, and this file is ${type}`,
    )
  }
}

// Untaken, as a page reads it.
let untaken = (e: unknown) => {
  if (e instanceof Untaken) return json(e.status, e.code, e.message)
  throw e
}

/**
 * Bytes into the app's bucket, and the rows that name them there — the
 * write half of an upload, without a request anywhere in it, because bytes
 * arrive by other doors too (inbox.ts: a letter's attachments). Bytes the app
 * does not take (`accepts`) throw {@link Untaken} before any are kept.
 *
 * The object lands in the bucket first and the rows are only returned, because
 * a row pointing at nothing is the failure a reader sees, while bytes nobody
 * has named yet are invisible until the next arrival of the same file names
 * them. The caller applies the bundles, as whoever it decided is writing.
 */
export let filed = async (
  env: Env,
  space: Space,
  app: App,
  graph: Meta,
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
  name: string,
  accepts?: Accepts,
): Promise<File> => {
  admit(accepts, bytes.byteLength)
  let sha = await sha256(bytes)
  let file = await described(graph, app, sha, bytes, mime, name)
  admit(accepts, bytes.byteLength, file.mime)
  let blobs = r2Objects(env.BLOBS)
  let key = blobKey(space, app, sha)
  if (!(await blobs.has(key))) await blobs.put(key, bytes)
  return file
}

/** Kept bytes, and the rows that name them. */
type File = {
  sha: string
  use: string
  size: Size | undefined
  mime: string
  url: string
  bundles: Bundle[]
}

/**
 * The rows that name the `bytes` bytes kept at `sha`, read off `head`: their
 * first bytes, or all of them.
 *
 * The content row, the way the fleet shapes a file (src/blob.ts),
 * addressed by its sha and carrying what is true of the bytes — how many they
 * are, and what they measure (@yaks/blob `sizeOf`, off the file's own header) —
 * and the use of it, carrying what it is called and what it is. They stay
 * apart because they are two things, and because a component may not point at
 * its own entity. The use is addressed off the content, so the same bytes sent
 * twice are one attachment renamed rather than a second row saying the same
 * thing. A listing shows the use and not the content, which is right: a doc's
 * body is a blob row as well, and nobody saved that.
 */
let described = async (
  graph: Meta,
  app: App,
  sha: string,
  head: Uint8Array,
  mime: string,
  name: string,
  bytes = head.byteLength,
): Promise<File> => {
  let use = await useOf(sha)
  if (!name || mime == 'application/octet-stream') {
    let [prior] = await graph.query(`.entity.eid=${use}`) as {
      attachment?: { name?: string; mime?: string }
    }[]
    name ||= prior?.attachment?.name ?? ''
    if (mime == 'application/octet-stream') {
      mime = prior?.attachment?.mime ?? mime
    }
  }
  let whole = bytes == head.byteLength
  let rep = representation(
    app.eid,
    sha,
    await contentType(head, mime, whole),
    name,
  )
  let size = sizeOf(head)
  return {
    sha,
    use,
    size,
    mime: rep.row.media_type,
    url: `/${app.slug}/api/blob/${rep.path}`,
    bundles: [
      {
        entity: { eid: sha },
        blob: { bytes },
        ...(size ? { image: size } : {}),
      },
      {
        entity: { eid: rep.eid },
        representation: rep.row,
      },
      {
        entity: { eid: use },
        // A patch, so an arrival that names nothing leaves the name the
        // first one gave these bytes: the same file is the same file,
        // whatever the page had to call it the second time.
        attachment: {
          blob: sha,
          mime: rep.row.media_type,
          ...(name ? { name } : {}),
        },
      },
    ],
  }
}

// An upload's rows, written as the uploader through the app's own /apply, and
// the answer every upload door gives: the eid to point a row at, the address
// to read it from, and what it is.
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
  return Response.json({
    eid: file.sha,
    url: file.url,
    mime: file.mime,
    bytes,
    ...file.size,
  })
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
  let stopped = await fullFiles(env, space, [{
    key: blobKey(space, app, await sha256(bytes)),
    bytes: bytes.byteLength,
  }])
  if (stopped) return json(413, 'space_full', stopped)
  let graph = metaOf(store, headers)
  let file = await filed(
    env,
    space,
    app,
    graph,
    bytes,
    mimeSent(req),
    nameSent(req),
    accepts,
  )
  return recorded(graph, file, bytes.byteLength, {
    request: 'POST /api/blob',
    space: space.slug,
    app: app.slug,
  })
}

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
// The reader's browser keeps what it was given.
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
      caught(e, { request: 'GET /api/blob', space: space.slug, app: app.slug })
      return json(503, 'blob_unavailable')
    }
    if (!rep) return json(404, 'no_such_file')
    let to = new URL(req.url)
    to.pathname += `/${rep.eid}`
    return new Response(null, {
      status: 302,
      headers: {
        location: to.href,
        'cache-control': 'private, no-cache',
      },
    })
  }
  let rep
  try {
    rep = await servedTo(env, space, app, graph, sha, eid)
  } catch (e) {
    caught(e, { request: 'GET /api/blob', space: space.slug, app: app.slug })
    return json(503, 'blob_unavailable')
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
let named = (env: Env, who: Who, app?: App) =>
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
        let out = await written(
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
  if (CLIENT.includes(path)) return platformFile(req, env, path)
  let store = appStore(env.STORE, space, app, env)
  // What the page (or the browser itself) says broke. Anyone may report —
  // a break belongs to whoever was looking at the page, and asking a
  // stranger to sign in first would lose exactly the breaks nobody sees.
  if (path == '/report') {
    if (req.method != 'POST') return json(405, 'method_not_allowed')
    // A page a verified bot renders, nobody is looking at (lib/bots.ts). It
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
        await recoverRelease(
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
          () => pageSpeaks(req, dir, r2Objects(env.BLOBS), space, app, appDoc),
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
    if (!mayRead) {
      let url = new URL(req.url)
      url.pathname = url.pathname.slice(0, -`/api${path}`.length) +
        versioned.path
      return await c.time(
        'worker',
        () => ran(env, space, app, new Request(url, req), who),
      ) ?? refused('not_a_reader')
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
    return Response.json({
      person,
      via: who.via ?? null,
      name: person ? await dir.nameAt(person) : null,
      role: who.role,
      reads: mayRead,
      // A stranger reading the sample writes, and their first write gives
      // them a store of their own (visit.ts).
      writes: mayPost || onSample(app),
      signIn: person
        ? null
        : signInAt(req.headers.get('referer') || req.url, env),
      invited: await invitedHere(dir, space, app, person, mayRead, mayPost),
      visit: who.visit ?? null,
    })
  }
  // The app's platform doors use the same refusals as its store doors.
  let asked: Asked = { env, req, path, space, app, who, refuse: refused, json }
  let mine = await stats(asked) ?? await connection(asked) ??
    await envDoor(asked) ?? await fetchDoor(asked) ?? await reach(asked) ??
    await documents(asked) ?? await modelRun(asked) ??
    await speechDoor(asked) ??
    await recovery(asked) ??
    await voice(asked) ?? await notices(asked)
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
      { space, app: app.slug, root: urlOf(space, app) },
      async (line) => await metaOf(store, headers).query(line) as Product[],
      body,
    )
  }
  if (path == '/graph') {
    if (!mayRead) return refused('not_a_reader')
    let r = await store.consume(
      '/graph',
      (res) => res.json() as Promise<Record<string, unknown>>,
      {},
      headers,
    )
    return Response.json({ ...r, person: who.person, role: who.role })
  }
  // The vocabulary a page's local graph loads: this store's words and the
  // borrowed words its own manifest uses, from their component homes.
  if (path == '/vocab') {
    if (req.method != 'GET') return json(405, 'method_not_allowed')
    if (!mayRead) return refused('not_a_reader')
    let wire = await store.consume(
      '/api/vocab',
      async (res) =>
        res.ok
          ? { keywords: (await res.json() as { keywords: unknown[] }).keywords }
          : { failed: new Response(await res.text(), res) },
      {},
      headers,
    )
    if (wire.failed) return wire.failed
    let docs = await vocabulary(env, space, app, who, headers)
    if (!docs.ok) return docs
    return Response.json({ docs: await docs.json(), keywords: wire.keywords })
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
        ? (await written(
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
          { status: 202 },
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
  if (path == '/blob') {
    if (req.method != 'POST') return json(405, 'method_not_allowed')
    if (!mayPost) return refused()
    return await took(req, env, space, app, store, {
      ...headers,
      ...(await named(env, who, app)),
    }).catch(untaken)
  }
  if (
    path.startsWith('/blob/') && (req.method == 'POST' || req.method == 'PUT')
  ) {
    if (!mayPost) return refused()
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
let kernels = (space: Space, app: string | null) =>
  space.slug == META.space && app == META.app

// The identity part, asked for at request time rather than imported at the
// top: it carries the OAuth provider, whose `cloudflare:` modules exist only
// inside workerd, and this part's own tests run outside it. The two are peers
// in one Worker (index.ts binds each), so this is the in-process form of
// the service binding a split would give them — a `bound` with no namespace to
// call. Nothing above the owner block below asks for it, so nothing else pays.
let identity = () => import('./identity.ts')

// The space's own address, listed: every app this person may open, and how
// many they may not. What a stranger must never learn is the name of a
// private app, so the filter is per app and it is `reads` — the same question
// the file door asks before it serves a page (T-33040).
//
// For its owner this is also where a fresh sign-in lands (T-34233), so it
// carries the two things the sign-in card stopped asking — what to call them
// and where their apps live — and the connect instructions, open until an
// agent has ever been let in as them (T-34236).
// Every app's visitors, for the owner's block: every app in the same four
// queries (views.ts `statsFor`), each answer already cached for a few minutes
// there — and a failure is `null` rather than a throw, because this is the
// space's front door and it does not go down because Cloudflare's analytics
// did.
let visits = async (env: Env, apps: App[]): Promise<Visits[] | null> => {
  let asked = statsFor(env, apps.map((a) => a.eid))
  if (!asked) return null
  try {
    let all = await asked
    return apps.map((a) => ({
      slug: a.slug,
      title: a.title,
      stats: all.get(a.eid)!,
    }))
  } catch (e) {
    caught(e, { request: 'views' })
    return null
  }
}

// What a page arrived back from says: a form saved, a service's sign-in
// finished or not (connections.ts `callback`), or an agent was disconnected
// (identity.ts).
let returned = (q: URLSearchParams) =>
  q.has('saved')
    ? { say: 'Saved.', no: false }
    : q.has('sent')
    ? { say: 'Sent again.', no: false }
    : q.has('invited')
    ? { say: 'Invitation sent.', no: false }
    : q.has('removed')
    ? { say: 'Removed.', no: false }
    : q.has('connected')
    ? { say: 'Connected.', no: false }
    : q.has('disconnected')
    ? { say: 'Disconnected.', no: false }
    : q.has('refused')
    ? { say: "The sign-in didn't finish. Try connecting again.", no: true }
    : null

// A space's apps, the ones in the trash left in (only its owner is shown
// those), and the ones whoever is asking may open.
let shelf = (apps: App[], space: Space, who: Who) => {
  let here = apps.filter((a) => !kernels(space, a.slug))
  let all = here.filter((a) => !a.trashed)
  let mine = all.filter((a) => reads(mode(a.access), who.role))
  return { here, all, mine }
}

// A space's front door at `/`, when no app answers there (rung 4): its apps,
// as whoever is asking may see them, and to its owner the way to its
// dashboard. The apps and the asker's seat are the route's own read
// (directory.ts `page`), so the listing waits on no directory read of its own.
let index = async (
  req: Request,
  env: Env,
  space: Space,
  apps: App[],
  seatOf: (person: string) => Promise<Role | null>,
): Promise<Response> => {
  let who = await whoIs(req, env.SESSION_SECRET, seatOf, space.eid)
  let { all, mine } = shelf(apps, space, who)
  let owner = who.role == 'owner'
  return spaceIndex({
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
}

// The dashboard, at the apex (T-39354): the person's own pages at
// `/manage/account/<page>`, and each space's at `/manage/<space>/<page>`
// (T-136122). A space's owner is shown all of its pages and a member who may
// change it its Operator; anybody else is answered what a wrong address is.
let manage = async (req: Request, env: Env): Promise<Response> => {
  let url = new URL(req.url)
  let at = managed(url.pathname)
  if (!at) return nothingHere(env)
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env), {
    copy: copyOf(env),
    time: env.CLOCK,
  })
  let { person, until } = await whoIs(
    req,
    env.SESSION_SECRET,
    () => Promise.resolve(null),
  )
  if (!person) return redirect(signInAt(sentFrom(req, env).href, env), 303)
  let asked = url.searchParams.get('space')
  if (asked && !SLUG.test(asked)) return nothingHere(env)
  // `/manage` opens a new chat in the space the person opens first, and an
  // address from before the space was in the path (`?space=`, or none for
  // their own) is sent on to where its page is now, so links in letters keep
  // working.
  if ('first' in at || 'legacy' in at) {
    let slug = 'legacy' in at && accountView(at.legacy)
      ? ''
      : asked ?? (await dir.own(person)).slug
    let to = new URL(landing(at, slug), hostUrl(env))
    for (let [k, v] of url.searchParams) {
      if (k != 'space') to.searchParams.append(k, v)
    }
    return 'first' in at ? redirect(to.href) : moved(req, to.href)
  }
  if ('account' in at) {
    return mine(req, env, dir, { person, role: null, until }, at.account)
  }
  let view = at.view
  if (req.method == 'GET' || req.method == 'HEAD') foresee(dir, person, view)
  let { space, role, administrative } = await dir.page(
    at.space,
    null,
    person,
    view == 'operator' || view == 'updates',
  )
  if (!space) {
    // A link written before the space moved to another name (T-34658).
    let was = await dir.formerly(at.space)
    if (!was) return nothingHere(env)
    return moved(req, hostUrl(env, managePath(view, was.slug)) + url.search)
  }
  if (space.slug == META.space) return nothingHere(env)
  let who: Owner = {
    person,
    role: administrative ? 'owner' : role ?? null,
    administrative,
    until,
  }
  if (at.logo) return logoOf(env, space, who, at.logo)
  if (at.manifest) {
    let open = req.method == 'GET' || req.method == 'HEAD'
    if (!open || !writes(who.role) || space.trashed) return nothingHere(env)
    let { installing } = await import('./operator-page.ts')
    return installing(space)
  }
  // The Operator is open to every member who may change the space; its own
  // requests are answered by it, its settings page is drawn like every
  // other, and each conversation with it opens in its chat app, which
  // opens the files sent in it where it stands (operator-view.ts `attached`).
  // Its Updates open in the chat app too.
  let reading = req.method == 'GET' || req.method == 'HEAD'
  if (view == 'updates' && writes(who.role) && !space.trashed) {
    if (req.method == 'POST') {
      let { updatesAnswer } = await import('./updates.ts')
      return updatesAnswer(req, env, space, who)
    }
    if (!reading) return nothingHere(env)
    let { updatesPage } = await import('./operator-page.ts')
    return updatesPage(env, space, who, await beside(dir, space, who))
  }
  if (view == 'operator' && writes(who.role) && !space.trashed) {
    let { chatPage, operatorAnswer } = await import('./operator-page.ts')
    if (at.open && !new URL(req.url).searchParams.has('attachment')) {
      return reading
        ? chatPage(
          env,
          space,
          who,
          at.open,
          await beside(dir, space, who),
          url.searchParams.get('app'),
        )
        : nothingHere(env)
    }
    return await operatorAnswer(req, env, space, who) ??
      desk(req, env, dir, space, who, view)
  }
  if (who.role != 'owner') {
    // Of a space they don't own, a member who may change it has its
    // Operator, which every other page of it sends them to.
    return writes(who.role) && !space.trashed &&
        (req.method == 'GET' || req.method == 'HEAD')
      ? redirect(hostUrl(env, managePath('operator', space.slug)))
      : nothingHere(env)
  }
  // A space in the trash is brought back from its own address (`closed`).
  if (space.trashed) {
    return redirect(`https://${spaceHost(env, space.slug)}/`, 303)
  }
  if (req.method == 'POST') return saved(req, env, dir, space, who, view)
  if (req.method != 'GET' && req.method != 'HEAD') return nothingHere(env)
  return desk(req, env, dir, space, who, view)
}

// Which space the side's selector holds on a page of the person's own: the
// one whose pages this browser opened last, kept in a cookie of the
// dashboard's alone, so going back from Profile to Apps returns to it.
let IN = 'yak-in'
let inOf = (req: Request) =>
  /(?:^|;\s*)yak-in=([a-z0-9-]+)/.exec(req.headers.get('cookie') ?? '')?.[1]
let keptIn = (res: Response, slug: string) => {
  res.headers.append(
    'set-cookie',
    `${IN}=${slug}; Path=${MANAGE}; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax`,
  )
  return res
}

// What a dashboard page will ask the directory, asked at once so it travels
// with whatever else this moment asks (directory-copy.ts `gathered`): each is
// answered again from this reading when the page comes to it (hops.ts
// `recall`), and a failure is the page's to meet when it does. A seat names its
// space, so the side's selector comes with the person's seats.
let foresee = (
  dir: ReturnType<typeof directory>,
  person: string,
  view: ManageView,
) => {
  void Promise.allSettled([
    feeOf(dir),
    dir.nameAt(person),
    dir.seats(person),
    ...view == 'shared' ? [dir.granted(person)] : [],
  ])
}

// Who a dashboard page is drawn for: a person signed in, who owns the space.
type Owner = Who & { person: string }

// The apps of other people's spaces this person may open (T-124081): each app
// of a space they hold a seat in and do not own, and each app they are a guest
// of. What is in the trash opens onto nothing, so it is left out, and an app
// of a space they own is on that space's own page.
export let shared = async (
  dir: ReturnType<typeof directory>,
  person: string,
) => {
  let [seats, granted] = await Promise.all([
    dir.seats(person),
    dir.granted(person),
  ])
  let owned = new Set(
    seats.filter((s) => s.role == 'owner').map((s) => s.space.eid),
  )
  let spaces = seats.map((s) => s.space)
    .filter((s) => !owned.has(s.eid) && !s.trashed)
  let seated = (await dir.apps(spaces)).map((app) => ({
    space: spaces.find((s) => s.eid == app.space)!,
    app,
  }))
  // One row an app, however it was shared: a seat and a grant can both
  // reach it.
  let each = new Map([...seated, ...granted].map((g) => [g.app.eid, g]))
  return [...each.values()]
    .filter(({ space, app }) =>
      !owned.has(space.eid) && !space.trashed && !app.trashed &&
      !kernels(space, app.slug)
    )
    .map(({ space, app }) => ({
      eid: app.eid,
      slug: app.slug,
      title: app.title,
      space: space.slug,
    }))
}

// Where a dashboard form lands back: the page that sent it, at the apex.
let sentFrom = (req: Request, env: Env) => {
  let at = new URL(req.url)
  return new URL(at.pathname + at.search, hostUrl(env))
}

// The spaces the side's selector offers (pages.ts `Picked`): every one this
// person may work in, the one they open first at the top, then those they
// own, then those they are a member of, each named by whose it is: every
// owner's name in one read.
let pickable = async (dir: ReturnType<typeof directory>, seats: Seat[]) => {
  let kept = seats.filter((s) => !s.space.trashed && writes(s.role))
    .sort((a, b) =>
      Number(b.own) - Number(a.own) ||
      Number(b.role == 'owner') - Number(a.role == 'owner')
    )
  let names = await dir.persons([
    ...new Set(
      kept.flatMap((s) => s.role != 'owner' && s.owner ? [s.owner] : []),
    ),
  ])
  return kept.map((s) => ({
    slug: s.space.slug,
    title: s.space.title,
    owner: s.role == 'owner',
    own: s.own,
    whose: s.role == 'owner' ? undefined : names.get(s.owner!)?.name,
    operator: s.space.operator,
    logo: logoPath(s.space),
  }))
}

// What the chat app's side holds (operator-page.ts `Beside`), asked at once:
// the spaces its selector offers, the apps here this person may open, and
// what they are called.
let beside = async (
  dir: ReturnType<typeof directory>,
  space: Space,
  who: Owner,
): Promise<Beside> => {
  let [spaces, { mine }, name] = await Promise.all([
    dir.seats(who.person).then((seats) => pickable(dir, seats)),
    dir.apps(space).then((apps) => shelf(apps, space, who)),
    dir.nameAt(who.person),
  ])
  return {
    spaces,
    apps: mine.map((a) => ({ eid: a.eid, slug: a.slug, title: a.title })),
    name,
  }
}

// One page of a space's (pages.ts `desk`), for its owner, or its Operator for
// a member who may change it.
let desk = async (
  req: Request,
  env: Env,
  dir: ReturnType<typeof directory>,
  space: Space,
  who: Owner,
  view: SpaceView,
  said?: { say: string; no: boolean },
  typed?: Pick<DeskPage, 'invite' | 'typed'>,
): Promise<Response> => {
  let owner = who.person
  let q = new URL(req.url).searchParams
  // Everything a page shows, asked at once: nothing here waits on anything but
  // the apps it says something about.
  if (view == 'apps') {
    void trackedIn(env, space, who, true).catch(() => {})
  }
  let shelved = dir.apps(space).then((apps) => shelf(apps, space, who))
  let [
    { here, all },
    broken,
    views,
    fee,
    agents,
    people,
    connections,
    picks,
    operator,
    billed,
    provider,
  ] = await Promise.all([
    shelved,
    // What is broken in each app (unseen.ts `brokenIn`), read only for the
    // page that lists them: one read of the space's tracker, no app's store
    // woken. A read that fails is reported and the apps are drawn without it.
    view == 'apps'
      ? shelved.then(({ all }) =>
        all.length
          ? brokenIn(env, space, who, all).catch((e) => {
            caught(e, { request: 'read open errors', space: space.slug })
            return undefined
          })
          : undefined
      )
      : undefined,
    // Who visited (views.ts, T-34497). `null` is the platform with no
    // analytics token set, and a read that fails is `null` too: the page
    // does not go down because Cloudflare's analytics did.
    view == 'visits'
      ? shelved.then(({ all }) => all.length ? visits(env, all) : undefined)
      : undefined,
    feeOf(dir),
    // Whether an agent is connected, for the pages that say how to make an
    // app with one.
    view == 'apps' || view == 'new'
      ? identity().then((part) => part.agents(env, owner))
      : undefined,
    // Who is in the space and its apps (people.ts), read only for the page
    // that shows it.
    view == 'people'
      ? Promise.all([
        shelved.then(({ all }) => peopleIn(dir, [space], all)),
        dir.admits(space.eid),
      ])
      : undefined,
    // What this space calls out through (connections.ts), read only for the
    // page that shows it; on the person's own space (`member.own`), what they
    // connected for themselves and the services holding a grant from them.
    view == 'connections'
      ? dir.seats(owner, 'owner').then(async (seats) => {
        let own = seats.some((s) => s.own && s.space.eid == space.eid)
        return connectionsOf(env, space, owner, {
          own,
          services: own
            ? await identity().then((part) => part.services(env, owner))
            : [],
          enable: enabled(req),
          add: q.get('add') ?? undefined,
        })
      })
      : undefined,
    // Every space this person may work in, which the side's selector offers.
    dir.seats(owner).then((seats) => pickable(dir, seats)),
    view == 'operator'
      ? import('./operator-page.ts').then((part) =>
        part.operatorBody(env, space, who)
      )
      : undefined,
    // Whom the payment provider bills, for the Billing page (T-131895). A
    // read that fails is reported, and the page says only that it bills.
    view == 'billing'
      ? plans(env).then((lent) => billedTo(lent, space)).catch((e) => {
        caught(e, { request: 'read billing customer', space: space.slug })
        return undefined
      })
      : undefined,
    payments(env),
  ])
  let page = deskPage({
    views,
    viewDays: DAYS,
    viewsOff: NOT_ON,
    space: space.slug,
    view,
    apps: all.map((a) => ({
      eid: a.eid,
      slug: a.slug,
      title: a.title,
      home: a.home,
      access: a.access,
      gallery: pilled(standing(a)),
      errors: broken?.get(a.eid),
    })),
    trash: here.filter((a) => a.trashed).map((a) => ({
      eid: a.eid,
      slug: a.slug,
      title: a.title,
      days: daysLeft(a.trashed!),
    })),
    // Where the space stands with selling (sell.ts, T-34524), and only where
    // the platform's payment provider can be asked at all, since a button
    // that cannot work is worse than no block.
    sell: provider.shops.on() ? selling(space) : undefined,
    provider: provider.name,
    paying: paid(space.tier),
    plan: planCard(provider.plans, space),
    paid: q.get('paid') == '1',
    // The space's month against its allowances (meter.ts), as the
    // directory's row holds it.
    bill: view == 'billing'
      ? {
        limits: gauges(space, all.length),
        budget: budget(space),
        read: spent(space).at || null,
        payer: billed,
      }
      : undefined,
    fee: rate(fee),
    agents,
    people: people?.[0][0],
    operators: people?.[1].map((r) => ({
      eid: r.space.eid,
      slug: r.space.slug,
      title: r.space.title,
      role: r.role,
    })),
    connections,
    spaces: picks.some((s) => s.slug == space.slug) ? picks : [
      {
        slug: space.slug,
        title: space.title,
        owner: who.role == 'owner',
        own: false,
        operator: space.operator,
        logo: logoPath(space),
      },
      ...picks,
    ],
    operator,
    member: who.role != 'owner',
    ...typed,
    say: said?.say ?? returned(q)?.say ?? '',
    no: said?.no ?? returned(q)?.no,
  }, env)
  return keptIn(page, space.slug)
}

// One page of the person's own (pages.ts `desk`): their profile, their
// agents, what others shared with them, a new space. The side's selector
// holds the space this browser was last in, or the one `?space=` chose.
let mine = async (
  req: Request,
  env: Env,
  dir: ReturnType<typeof directory>,
  who: Owner,
  view: AccountView,
  said?: { say: string; no: boolean },
  typed?: Pick<DeskPage, 'typed' | 'made'>,
): Promise<Response> => {
  let person = who.person
  let q = new URL(req.url).searchParams
  if (req.method == 'POST' && !said) {
    return account(req, env, dir, who, view)
  }
  if (req.method != 'GET' && req.method != 'HEAD' && req.method != 'POST') {
    return nothingHere(env)
  }
  if (req.method != 'POST') foresee(dir, person, view)
  let [picks, name, email, agents, theirs, referral, own] = await Promise.all([
    dir.seats(person).then((seats) => pickable(dir, seats)),
    dir.nameAt(person),
    view == 'profile' ? dir.emailAt(person) : undefined,
    view == 'agents' ? identity().then((part) => part.agents(env, person)) : [],
    view == 'shared' ? shared(dir, person) : undefined,
    view == 'invite' ? invitation(env, dir, person) : undefined,
    dir.own(person),
  ])
  let chosen = q.get('space') ?? inOf(req)
  let space = picks.find((s) => s.slug == chosen)?.slug ?? own.slug
  let page = deskPage({
    space,
    view,
    apps: [],
    name: name ?? '',
    email: email ?? '',
    agents,
    shared: theirs,
    referral,
    spaces: picks.some((s) => s.slug == own.slug) ? picks : [
      {
        slug: own.slug,
        title: own.title,
        owner: true,
        own: true,
        logo: logoPath(own),
      },
      ...picks,
    ],
    member: !picks.find((s) => s.slug == space)?.owner,
    ...typed,
    say: said?.say ?? returned(q)?.say ?? '',
    no: said?.no ?? returned(q)?.no,
  }, env)
  return q.has('space') ? keptIn(page, space) : page
}

// What a page of the person's own posts: Profile's name and the space they
// open first, and a new space.
let account = async (
  req: Request,
  env: Env,
  dir: ReturnType<typeof directory>,
  who: Owner,
  view: AccountView,
): Promise<Response> => {
  let form = await req.formData().catch(() => new FormData())
  if (view == 'space') {
    let made = {
      title: String(form.get('title') ?? '').trim().slice(0, 60),
      slug: String(form.get('slug') ?? '').trim().toLowerCase(),
    }
    let { said } = await pressed(env, dir, who, 'space_new', {
      slug: made.slug,
      title: made.title || made.slug,
    })
    if (said) return mine(req, env, dir, who, view, said, { made })
    return keptIn(
      redirect(hostUrl(env, chatPath(made.slug)), 303),
      made.slug,
    )
  }
  if (view != 'profile') return nothingHere(env)
  // Cleared, the front of their address comes back — a person always has a
  // title, because a member row names them by it and a titleless one reads
  // back as a bare eid (T-32733). `nameOf` is the same fallback signing in
  // writes.
  if (form.has('name')) {
    await dir.apply({
      entities: [{
        entity: { eid: who.person },
        doc: {
          title: String(form.get('name') ?? '').trim().slice(0, 60) ||
            nameOf(null, await dir.emailAt(who.person) ?? ''),
        },
      }],
    }, { 'x-yak-person': who.person, 'x-yak-role': 'owner' })
  }
  // The space they open first is the one their seat marks theirs
  // (`member.own`): the mark moves to another space they own.
  let first = String(form.get('first') ?? '').trim()
  if (first) {
    let seats = await dir.seats(who.person, 'owner')
    let to = seats.find((s) => s.space.slug == first && !s.space.trashed)
    if (to && !to.own) {
      await dir.apply({
        entities: seats.filter((s) => s.own || s == to).map((s) => ({
          entity: { eid: s.seat },
          member: { own: s == to },
        })),
      }, { 'x-yak-person': who.person, 'x-yak-role': 'owner' })
    }
  }
  let to = sentFrom(req, env)
  to.searchParams.set('saved', '1')
  return redirect(to.href, 303)
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
let closed = async (
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
    await untrashSpace(env, dir, space, who)
  }
  return redirect(hostUrl(env, chatPath(space.slug)), 303)
}

// Another letter for an invitation to this space or one of its apps, from the
// owner pressing the button: nothing when it went, else what to say. An
// invitation that is gone (accepted or withdrawn since the page was drawn)
// or is somebody else's space's says so and sends nothing.
export let again = async (
  env: Env,
  dir: ReturnType<typeof directory>,
  space: Space,
  who: Pick<Owner, 'person'>,
  eid: string,
  post?: Mail,
): Promise<{ say: string; no: boolean } | null> => {
  let invite = await dir.invitation(eid)
  let place = invite && await placeOf(dir, invite.to)
  if (!invite || place?.space.eid != space.eid) {
    return { say: 'That invitation is no longer waiting.', no: true }
  }
  let email = await dir.emailAt(invite.person)
  if (!email) return { say: 'That invitation is no longer waiting.', no: true }
  try {
    await allowed(env, dir, who.person)
  } catch (e) {
    if (e instanceof CallError) return { say: sentence(e.message), no: true }
    throw e
  }
  let sent = await send(env, dir, {
    invite: invite.eid,
    place: place!,
    email,
    role: invite.role,
    by: who.person,
  }, post)
  return sent ? null : {
    say: "The letter couldn't be sent just now. Try again in a minute.",
    no: true,
  }
}

// A dashboard control is the tool the person's assistant would call, called
// as the person pressing it, so the page and the assistant invite, remove and
// choose a homepage one way. What the tool refuses is what the page says.
let pressed = async (
  env: Env,
  dir: ReturnType<typeof directory>,
  who: Owner,
  name: string,
  args: Record<string, unknown>,
) => {
  try {
    let out = await TOOLS.find((t) => t.name == name)!.run(
      { env, dir, person: who.person },
      args,
    )
    return { out }
  } catch (e) {
    if (e instanceof CallError) {
      return { said: { say: sentence(e.message), no: true } }
    }
    throw e
  }
}

// A space's forms return to the page that submitted them. Every space's page
// shares the cookie's site, so ownership alone is
// insufficient: a page at another address never gets here (route.ts
// `guarded`).
let saved = async (
  req: Request,
  env: Env,
  dir: ReturnType<typeof directory>,
  space: Space,
  who: Owner,
  view: SpaceView,
): Promise<Response> => {
  let form = await req.formData().catch(() => new FormData())
  // The connections page's buttons (connections.ts): each is one form with a
  // `do`, answered with the page saying what came of it, or sent on to a
  // service to sign in there.
  if (form.has('do')) {
    let said = await connecting(req, env, space, who, form)
    return said instanceof Response
      ? said
      : desk(req, env, dir, space, who, 'connections', said)
  }
  // The People page's button: another letter for an invitation not yet
  // accepted, exactly as asking member_add again sends one (invite.ts).
  if (form.has('again')) {
    let said = await again(env, dir, space, who, String(form.get('again')))
    if (said) return desk(req, env, dir, space, who, 'people', said)
    let to = sentFrom(req, env)
    to.searchParams.set('sent', '1')
    return redirect(to.href, 303)
  }
  // The People page's invitation: member_add, as the assistant asks it. A
  // refusal draws the page again with what was typed still in the form.
  if (form.has('invite')) {
    let asked = {
      email: String(form.get('invite') ?? '').trim(),
      app: String(form.get('app') ?? '').trim(),
      role: String(form.get('role') ?? '').trim(),
      note: String(form.get('note') ?? '').trim(),
    }
    let { out, said } = await pressed(env, dir, who, 'member_add', {
      space: space.slug,
      email: asked.email,
      ...asked.app ? { app: asked.app } : {},
      ...asked.role ? { role: asked.role } : {},
      ...asked.note ? { note: asked.note } : {},
    })
    if (said) {
      return desk(req, env, dir, space, who, 'people', said, { invite: asked })
    }
    let to = sentFrom(req, env)
    to.searchParams.set(out?.value?.invited ? 'invited' : 'saved', '1')
    return redirect(to.href, 303)
  }
  // The People page's Operators (operator-reach.ts): one of the owner's
  // other spaces whose Operator they let work here, or take back out. Only a
  // space they sit in is offered, and only such a one is let in.
  if (form.has('operator') || form.has('unreach')) {
    try {
      if (form.has('operator')) {
        let slug = String(form.get('operator')).trim()
        let other = await dir.space(slug)
        if (!other || !await dir.role(other, who.person)) {
          throw refuse('missing', `you are in no space ${slug}`)
        }
        let role = String(form.get('role') ?? 'editor') as Role
        await letIn(dir, space, other, role, who.person, vouched(who))
      } else {
        await letOut(dir, space, String(form.get('unreach')), vouched(who))
      }
    } catch (e) {
      if (!(e instanceof CallError)) throw e
      return desk(req, env, dir, space, who, 'people', {
        say: sentence(e.message),
        no: true,
      })
    }
    let to = sentFrom(req, env)
    to.searchParams.set(form.has('operator') ? 'saved' : 'removed', '1')
    return redirect(to.href, 303)
  }
  // A People row's Remove, or Withdraw for an invitation: member_remove, as
  // the assistant asks it.
  if (form.has('remove')) {
    let app = String(form.get('app') ?? '').trim()
    let { said } = await pressed(env, dir, who, 'member_remove', {
      space: space.slug,
      email: String(form.get('remove')).trim(),
      ...app ? { app } : {},
    })
    if (said) return desk(req, env, dir, space, who, 'people', said)
    let to = sentFrom(req, env)
    to.searchParams.set('removed', '1')
    return redirect(to.href, 303)
  }
  if (form.get('billing') == 'checkout') {
    return checkout(env, req, space, wanted(form))
  }
  if (form.get('billing') == 'portal') return portal(env, req, space)
  // The other button on this page: one app out of the trash (erase.ts,
  // T-34430). Its own form, so it is its own POST — a plain button and no
  // script, the way the drop zone and the settings form are — and it lands
  // back on this page with the app in the listing again.
  let back = String(form.get('restore') ?? '').trim()
  if (back) {
    let app = await dir.binned(space, back)
    if (app?.trashed) await untrash(env, dir, space, app, who)
    return redirect(sentFrom(req, env).href, 303)
  }
  // The selling block's button (sell.ts, T-34524). Its own form and its own
  // POST, like the restore button above — and `start` answers a redirect to
  // the payment provider's own hosted onboarding, which is the one thing on
  // this page that leaves the site. A call to it that fails is filed and the
  // page comes back saying so, rather than a 502 on somebody's own front door.
  let till = String(form.get('sell') ?? '').trim()
  if (till == 'stop') {
    if (space.seller?.account) await disconnect(env, space)
    return redirect(sentFrom(req, env).href, 303)
  }
  if (till == 'start') {
    let no = refusedSell(space, env)
    if (no) {
      return desk(req, env, dir, space, who, 'selling', { say: no, no: true })
    }
    try {
      let made = await connect(env, space, await dir.emailAt(who.person) ?? '')
      return redirect(made.url, 303)
    } catch (e) {
      await fault(env, 'POST /manage/selling', e)
      let { name } = await payments(env)
      return desk(req, env, dir, space, who, 'selling', {
        say: `we couldn't reach ${name} just now — try again in a minute`,
        no: true,
      })
    }
  }
  // Settings' Logo: a picture chosen, or Remove.
  if (form.has('logo') || form.has('unlogo')) {
    let no = await logoed(env, dir, space, who, form.get('logo'))
    if (no) {
      return desk(req, env, dir, space, who, 'settings', { say: no, no: true })
    }
    let to = sentFrom(req, env)
    to.searchParams.set('saved', '1')
    return redirect(to.href, 303)
  }
  // Settings: the space's name, homepage and address, one form and one Save. A
  // refusal draws the page again with everything typed still in the fields,
  // and the address goes last because moving renames the space the homepage
  // is written against.
  if (view != 'settings') return nothingHere(env)
  let typed = {
    title: String(form.get('title') ?? '').trim(),
    space: String(form.get('space') ?? '').trim().toLowerCase(),
    home: String(form.get('home') ?? '').trim(),
  }
  let refused = (said: { say: string; no: boolean }) =>
    desk(req, env, dir, space, who, 'settings', said, { typed })
  // The name is space_set's `title`, as the assistant asks it; a blank one
  // leaves the name as it was. The move below reads the space as renamed, so
  // a new name saved with a new address stays.
  if (typed.title && typed.title != space.title) {
    let { said } = await pressed(env, dir, who, 'space_set', {
      space: space.slug,
      title: typed.title,
    })
    if (said) return refused(said)
    space = (await dir.at(space.eid)) ?? space
  }
  // The homepage is app_set's `home`, as the assistant asks it. The library is
  // no app at all, so choosing it takes the word off the app that has it.
  if (form.has('home')) {
    let now = await dir.home(space)
    let { said } = typed.home == (now?.slug ?? '')
      ? {}
      : await pressed(env, dir, who, 'app_set', {
        space: space.slug,
        app: typed.home || now!.slug,
        home: !!typed.home,
      })
    if (said) return refused(said)
  }
  let moving = typed.space && typed.space != space.slug
    ? await (await identity()).choose(env, who.person, typed.space, space)
    : null
  if (moving?.error) return refused({ say: moving.error, no: true })
  // The page names the space by its new address.
  let to = new URL(
    managePath('settings', moving?.slug ?? space.slug),
    hostUrl(env),
  )
  to.searchParams.set('saved', '1')
  return redirect(to.href, 303)
}

// Where a space's logo is kept: content-addressed in the bucket under the
// space's handle, so a rename moves none of it and deleting the space sweeps
// it with the rest (erase.ts `swept`).
let logoKey = (space: Space, sha: string) => `${space.store}/.logo/${sha}`

// The space wearing the picture `file`, or none where no file came (Remove).
// Answers why a file cannot be its logo, or nothing once it is. The bytes it
// wore before are deleted once the row no longer names them.
let logoed = async (
  env: Env,
  dir: ReturnType<typeof directory>,
  space: Space,
  who: Owner,
  file: FormDataEntryValue | null,
): Promise<string | undefined> => {
  let blobs = r2RawObjects(env.BLOBS)
  let logo = null
  if (file instanceof File) {
    if (file.size > LOGO.size) return 'a logo can be up to 1 MB'
    let bytes = new Uint8Array(await file.arrayBuffer())
    let type = mediaTypeOf(bytes)
    if (!type || !LOGO.accept.split(',').includes(type)) {
      return 'a logo is a PNG, JPEG, WebP or GIF picture'
    }
    let why = await undecoded(bytes, type)
    if (why) return `that picture does not open: ${why}`
    logo = { sha: await sha256(bytes), type }
    await blobs.put(logoKey(space, logo.sha), bytes)
  } else if (file != null) return 'choose a picture for the logo'
  let had = space.logo?.sha
  await dir.badge(space, logo, vouched(who))
  if (had && had != logo?.sha) await blobs.delete(logoKey(space, had))
}

// The bytes of a space's logo, to anyone in the space, at the address only
// these bytes have (route.ts `logoPath`), so a browser keeps them for good.
let logoOf = async (env: Env, space: Space, who: Owner, sha: string) => {
  if (!who.role || space.logo?.sha != sha) return nothingHere(env)
  let bytes = await r2RawObjects(env.BLOBS).read(logoKey(space, sha))
  if (!bytes) return nothingHere(env)
  return new Response(bytes, {
    headers: {
      'content-type': space.logo.type,
      'cache-control': browserImmutable,
      'x-content-type-options': 'nosniff',
    },
  })
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
  !PLATFORM_PATHS.some((p) => covers(p, path)) &&
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
    let res = await browsing(
      req,
      env,
      (r) => served(r, env, c, false, undefined, req),
      !pagePath(new URL(req.url).pathname) && !bearing(req) &&
        !req.headers.has('authorization') && !fixed(new URL(req.url).pathname),
    )
    return timed(told(res, c), c)
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
//     is not the space's (route.ts `platform`, decided before this part), an
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
      ? manage(req, env)
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
  let [cookied, authenticated] = await Promise.all([
    edge ? null : sessionPerson(req, env.SESSION_SECRET),
    !edge && req.headers.has('authorization') && !bearing(req) &&
      url.pathname.includes('/api/')
      ? asking(env, req)
      : null,
  ])
  let person = authenticated?.who?.person ?? cookied
  if (!edge) {
    let page = await asked(visitor, env, c)
    if (page) return page
  }
  let routing = c.time('route', () => dir.page(r.space!, r.app, person))
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
  if (!app) {
    // Which app is home is a directory read, so it was read above, where env
    // is, and not in route.ts, which is pure (index.ts `aimed`, same reason).
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
      return await index(req, env, space, (await routing).roster!, seatOf)
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
  } else if (path == '') return redirect(`${url.pathname}/`)
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
      open = await reported(env, bare, open, app.version ?? 0, {
        badge: badgeOf(space, app, env),
      })
    }
    let page = reporting(open, req, bare)
    if (edge) return keep(page, space, app)
    viewed(env, req, page, seen(space, app))
    return page
  }
  // Site keeps the own files of an app anyone may read (public or open) and
  // nothing else: a private app's pages are its members', a sandboxed page
  // carries its visitor's token, and an app's worker may answer each visitor
  // differently. Nor does the gateway ask Site about such an app's other
  // addresses for a while.
  if (edge && dir.stale && app.access != 'public') {
    return passed()
  }
  if (!keepable(app)) {
    if (edge) return passed()
    unkept(req, env, bare, c)
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
      viewed(env, req, early.page, seen(space, early.app))
      let page = early.page
      if (
        page.body &&
        page.headers.get('content-type')?.startsWith('text/html')
      ) {
        page = await reported(env, '/', page, early.app.version ?? 0, {
          badge: badgeOf(space, early.app, env),
        })
      }
      let res = reporting(page, req, '/')
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
  // click in the letter, as it was. Never the app's own worker coming back,
  // nor a sandboxed app, whose page tokens each open one store.
  let visit: Visiting | null = null
  let stranger = { app, who, release: null as Release | null }
  if (!itself && !walls && visitable(app, who)) {
    let [own, release, invited] = await c.time('visit', () =>
      Promise.all([
        visitOf(env, who.via!, app!.eid),
        releaseFor(dir, app!),
        who.person
          ? waiting(dir, space!, app!, who.person, 'not_a_reader')
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
      let at = url.pathname.slice(0, -path.length)
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
      return wall(reporting(tooMany(), req, at))
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
        ))
      }
      let own = await c.time(
        'birth',
        () => born(env, space!, stranger.app, who.via!, who.person),
      )
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
    return wall(reporting(answer, req, at))
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
  // The worker passed, and the files are not this visitor's to see.
  if (!own && !file) {
    if (door == 'sign-in') return redirect(signInAt(req.url, env), 303)
    return await shut(dir, space, app, who.person!, env)
  }
  // File pages already pass through woven(). Worker pages use the same
  // reporter, without buffering or changing their navigation and asset URLs.
  if (
    own?.body &&
    own.headers.get('content-type')?.startsWith('text/html')
  ) {
    own = await reported(
      env,
      at,
      own,
      app.version ?? 0,
      wearing(space, app, env, who),
    )
  }
  let page = own ?? await file!
  // Rung 4, and it is last rather than fourth in the code because rungs 3 and
  // 5 are the one call above: the space's index answers `/` when the home app
  // has nothing there — its worker passed and its files have no front page.
  // Only the home app can be at `/` (route.ts `route` names no app for it, so
  // this is the fall-through), which is why the home app is the whole of the
  // test. A path that is not `/` keeps the 404: an address inside a space that
  // nothing answers is nothing, not a listing.
  if (page.status == 404 && url.pathname == '/') {
    await page.body?.cancel()
    return edge
      ? passed()
      : await index(req, env, space, (await routing).roster!, seatOf)
  }
  // Site's page is counted by the gateway that sends it (page-cache.ts).
  if (edge) return marked(keep(reporting(page, req, at), space, app))
  // Count the page served (views.ts, T-34496). Last, once, and only for
  // what an app answered: the `/api/` doors returned above, a file that is not
  // HTML is not a page, and the platform's own pages — the space index, the
  // trash, a wrong address — never come back through here.
  viewed(env, req, page, seen(space, app))
  if (page.status < 400) scheduleBy(env, who, app.eid)
  return wall(reporting(page, req, at))
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
