// The app-serving part: `<space>.yaks.app/<app>/…` — the deploy seam's first
// hosted implementation (D-32318 §v1 sequencing). One fetch handler: it
// reads the hostname and path (route.ts), resolves the space and app through
// the directory part (directory.ts, in-process or across a binding), verifies
// the session (session.ts), and serves the app's files out of its blob store
// with the graph API for its (space, app) store beside them —
// `/api/{apply,query,me,graph}` mapped onto the Store object's doors, the store
// named from the route, never by the client. `PUT /api/files/<path>` is the
// write side, what a deploy is until app_deploy (T-32329) exists, and
// `/api/blob` is the door for a page's own bytes — a photo a visitor picks —
// content-addressed into the same bucket and named by a row in the app's
// store (T-32677). An app's OWN Worker answers before the files do, where it
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
// door refused ON PURPOSE never becomes one (unseen.ts `refusal`): a
// signed-out visitor sent to sign in is the platform working.
import { r2Blobs } from '../../src/blobs_r2.ts'
import { BUILD, joining, NOBODY, NOT_A_WRITER, posting } from './build.ts'
import { at as cachedAt } from './cache.ts'
import * as files from './files.ts'
import { keyed, PREFIX, prefixOf, purged, SHA } from './files.ts'
import {
  type App,
  appStore,
  directory,
  META,
  type Space,
  storeName,
} from './directory.ts'
import * as dirPart from './directory.ts'
import { ahead, bearing, granted, itsApp, ran } from './dispatch.ts'
import { bound, type Env } from './env.ts'
import { pilled, standing } from './gallery.ts'
import { type Size, sizeOf } from './image.ts'
import { asking, listed, type Row } from './listing.ts'
import { KERNEL, metaOf, minted } from './meta.ts'
import { batched, lined, lowered } from './wire.ts'
import {
  binned,
  nothingHere,
  spaceBinned,
  spaceIndex,
  type Visits,
} from './pages.ts'
import { daysLeft, untrash, untrashSpace } from './erase.ts'
import { hostOf, MOUNT, PLATFORM, route, sameOrigin } from './route.ts'
import { covers, PLATFORM_PATHS } from './router.ts'
import { titling, vouched, type Who, whoIs } from './session.ts'
import { seedy } from './seed.ts'
import { nameOf } from './signin.ts'
import { type Reach, split, written } from './reach.ts'
import type { Bundle } from '@yaks/graph'
import { edits, mode, reads, writes } from '@yaks/member'
import { type Door, storeOf } from './door.ts'
import { type Clock, clock, timed } from './timing.ts'
import { noted, refusal, serving } from './unseen.ts'
import { full } from './usage.ts'
import { sha256 } from './versions.ts'
import { DAYS, NOT_ON, type Stats, statsOf, viewed } from './views.ts'

// The runtime's streaming HTML rewriter, the slice this file asks for, so
// `deno check` reads the Worker without @cloudflare/workers-types (env.ts).
type Html = { html: boolean }
type Rewriter = {
  on(
    selector: string,
    handlers: { element(el: { prepend(s: string, o: Html): void }): void },
  ): Rewriter
  onDocument(
    handlers: { end(end: { append(s: string, o: Html): void }): void },
  ): Rewriter
  transform(res: Response): Response
}
declare let HTMLRewriter: { new (): Rewriter }

// A file's key in the blob store: the app's slugs then its path, a directory
// answering with its index. The vocabulary itself lives in files.ts, beside
// the part that reads the bucket (T-33197).
let keyOf = (space: Space, app: App, path: string) =>
  keyed(prefixOf(space, app), path)

// A refusal is READ — by the page that catches it, and by the person's agent
// after that — so it answers a SENTENCE beside its code (C-32574 item 2, where
// a club member's vote showed them `{"error":{"code":"not_a_writer"}}`). The
// code is the machine's half and never moves; the message is what someone is
// told. When signing in is the way through it also answers `signIn`, the
// address that does it and comes back (T-32593).
let SAYS: Record<string, string> = {
  method_not_allowed: 'that door does not answer this method',
  too_many_reports: 'this app has reported too many breaks this minute',
  expected_websocket: 'the live door takes a websocket upgrade',
  not_found: "no such door: this app's api is apply, query, me, graph, ws, " +
    'blob, and files/<path>',
  not_a_writer: 'sign in to change this app',
  not_a_reader: 'sign in to see this app',
  no_bytes: 'an upload needs a body: post the file itself',
  too_large: 'that file is too big to send — try a smaller one',
  no_such_file: 'no file at that address in this app',
  // What the STORE said no to — an unknown component, a `$was` that moved, a
  // dead entity. Its own sentence rides in `message`; this is the fallback.
  refused: 'the app store would not take that',
}

// The same refusals to someone who IS signed in: signing in is no longer the
// way through, so the sentence says whose it is to grant.
let MEMBER: Record<string, string> = {
  not_a_writer: 'you can read this app but not change it — its owner can ' +
    'make you an editor',
  not_a_reader: "this app is its owner's — they can let you in",
}

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

// Where a refusal sends someone who has not signed in: the platform's login
// page, already carrying the page to hand them back to (T-32593). At the file
// door that page is the request itself; at an `/api/` door — nowhere to return
// to — it is the Referer, and the request's own address when the browser sent
// none. Whether that address is one to follow is the login door's to decide.
let signInAt = (page: string) => {
  let to = new URL(`https://${PLATFORM}/login`)
  to.searchParams.set('return', page)
  return to.href
}

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

// The reporter, into every page the kernel serves, wherever the page has a
// place to put it: first inside `<head>`, else first inside `<body>`, else
// at the end of a document with neither. Streaming — the bytes are never
// held — and once, whichever came first.
//
// Its src is the app's address AS SERVED (`at`), because report.js reads the
// door out of its own src: at the app's prefix normally, at the root for a
// front page or a custom domain, where the prefix is an address the browser
// asking cannot reach (T-33040).
let reported = (at: string, page: Response) => {
  let tag = `<script src="${at}api/report.js"></script>`
  let done = false
  let once = (put: (s: string, o: { html: boolean }) => void) => {
    if (done) return
    done = true
    put(tag, { html: true })
  }
  return new HTMLRewriter()
    .on('head', { element: (el) => once((s, o) => el.prepend(s, o)) })
    .on('body', { element: (el) => once((s, o) => el.prepend(s, o)) })
    .onDocument({ end: (end) => once((s, o) => end.append(s, o)) })
    .transform(page)
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

// An app's own files must not name the app. The code is COPIED under
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
  /<base[\s>][^>]*\bhref\b/i.test(page)
    ? page
    : intoHead(page, `<base href="${href}">`)

// Whether the page already names a `rel` — one TOKEN of it, so
// `rel="shortcut icon"` and `rel="apple-touch-icon-precomposed"` each count as
// the author having answered.
let declares = (page: string, rel: string) =>
  new RegExp(`<link\\b[^>]*\\brel\\s*=\\s*['"]?[^'">]*\\b${rel}\\b`, 'i')
    .test(page)

// The two links an app added to a home screen needs, and almost no app writes
// (T-34493). iOS takes the icon from `<link rel="apple-touch-icon">` in the
// head and nowhere else — Apple's *Configuring Web Applications*: a page names
// its icon there, 180×180 for current displays, `sizes` only when it offers
// several, and the smallest icon LARGER than the device wants is the one
// scaled, so one square file serves every device. Every other platform reads
// the manifest's `icons` instead. A page written here has neither unless its
// agent thought of both, so an app somebody kept on their phone came out
// blank — owner, 2026-09-06: "the app's PWAs aren't getting icons (i tested
// iOS), even when the site itself has an image icon."
//
// So a page is given the link it did NOT write, at the app's own root: the
// icon (`icon.png`, answered by the platform's tile when the app wrote none)
// and the manifest (`manifest.webmanifest`, generated below). Each half is
// decided on its own — a page naming an icon and no manifest gets the manifest
// — and what the page declares is never touched, because a second `rel` beside
// the author's is a second answer to a question they answered.
//
// The hrefs are absolute at the mount, like the reporter's, rather than
// relative: a page carrying its own `<base>` keeps it (`based` above), and a
// relative `icon.png` would then resolve against the author's base instead of
// against the app.
export let pinned = (at: string, page: string) => {
  let tags =
    (declares(page, 'apple-touch-icon')
      ? ''
      : `<link rel="apple-touch-icon" href="${at}icon.png">`) +
    (declares(page, 'manifest')
      ? ''
      : `<link rel="manifest" href="${at}manifest.webmanifest">`)
  return tags ? intoHead(page, tags) : page
}

// The colour the page asked the browser to paint its chrome with, which is the
// one answer a GENERATED manifest can honestly give for a colour: whatever the
// app's own front page says in `<meta name="theme-color">`. A page that names
// none gets a manifest with no colours in it rather than a guess — the
// browser's default beats ours. A page naming several scopes the extras by
// `prefers-color-scheme`, so the unscoped one is the one that always applies.
let THEME = /<meta\b[^>]*\bname\s*=\s*['"]?theme-color\b[^>]*>/gi
let CONTENT = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i

export let themed = (page: string) => {
  let tags = [...page.matchAll(THEME)].map((m) => m[0])
  let tag = tags.find((t) => !/\bmedia\s*=/i.test(t)) ?? tags[0]
  if (!tag) return null
  let c = CONTENT.exec(tag)
  return (c?.[1] ?? c?.[2] ?? c?.[3] ?? '').trim() || null
}

// What an app's manifest says when the app wrote none: its name, its own root
// as the scope a standalone window stays inside, and the icon at the two sizes
// an installer looks for. The SAME file at both — one square png is all the
// platform asks an agent for, and resizing it at the edge would be a second
// set of bytes to serve and cache for an installer that scales anyway.
export let manifesting = (app: App, at: string, theme: string | null) => ({
  name: app.title || app.slug,
  short_name: app.title || app.slug,
  start_url: at,
  scope: at,
  display: 'standalone',
  ...(theme ? { background_color: theme, theme_color: theme } : {}),
  icons: ['512x512', '192x192'].map((sizes) => ({
    src: `${at}icon.png`,
    type: 'image/png',
    sizes,
  })),
})

// The files that ARE the app's platform manifest rather than its page: the
// server code the dispatch namespace runs (dispatch.ts), the two declarations
// a deploy reads, the data it seeds the store with (tools.ts, seed.ts), and
// the standing instructions its person left for an agent (standing.ts).
// Those are the app's INSIDE — the platform reads them out of the blob store,
// and a member reads them back through `app_files` — so the door that serves
// the app's pages does not serve them to the web. Before this, `GET
// /weather/worker.js` answered the whole server source to anyone with the link
// (C-32869 item 3).
//
// The test is on the decoded KEY, not the path, because `/%77orker.js` names
// the same file.
let MANIFEST = new Set([
  '/worker.js',
  '/vocab.json',
  '/tools.json',
  '/AGENTS.md',
])

let inside = (path: string) => MANIFEST.has(path) || seedy(path.slice(1))

// What the browser may keep, and for how long. An app's files are LIVE — a
// written file serves the moment app_files puts it, with no deploy in
// between — so nothing here may be held past a revalidation: `no-cache` is
// "ask every time", not "do not store", and with an ETag beside it that ask
// is answered by a 304 carrying no bytes. `private` on an app that is not
// public keeps its pages out of every shared cache between here and the
// person reading them, which is the whole of the rule: a private app's bytes
// belong to its members and to no proxy.
//
// The validator is the CONTENT, not the app's version: app_files writes
// bytes without bumping `app.version` (tools.ts), so a version is no promise
// about what the bytes are (T-33176).
let keeping = (app: App) =>
  `${app.access == null || app.access == 'public' ? 'public' : 'private'}, ` +
  'no-cache'

// The tag for these bytes at this mount. Weak, and the mount is part of it,
// because an HTML page is served with a `<base href>` woven in: the same
// bytes at `/` and at `/recipes/` are two different documents.
//
// The bytes' half arrives already hashed from files.ts (`SHA`), so it is
// computed on a cache miss and never again — a warm request hashes only the
// mount, which is a handful of characters.
let etagOf = async (sha: string, at: string) =>
  `W/"${sha}${(await sha256(new TextEncoder().encode(at))).slice(0, 8)}"`

let unchanged = (req: Request, etag: string) =>
  (req.headers.get('if-none-match') ?? '').split(',')
    .some((t) => t.trim() == etag)

// An app's bytes, through the cache (cache.ts): `Files` is a second entrypoint
// with Cloudflare's cache in front of it, addressed by the app's eid and this
// path, so a warm edge answers without the bucket being touched. It is the
// same call for a private app as for a public one — what is cached is the
// file, and whether this person may have it was decided by `served()` before
// we got here.
//
// Absent the binding (under `wrangler dev` and the workerd probes) `bound`
// calls the module in-process: the same bytes, no cache.
let bytes = (env: Env, app: App, prefix: string, path: string) =>
  bound(env.FILES, files.fetch, env).fetch(
    new Request(cachedAt(app.eid, path), { headers: { [PREFIX]: prefix } }),
  )

// The two addresses the kernel answers for an app that wrote neither file
// (T-34493), so the links `pinned` wove in are never dead. Both are the
// FALLBACK and nothing more: an app with its own `icon.png` or its own
// `manifest.webmanifest` is served that, because this is only reached where
// the bucket had nothing.
//
// The icon is the platform's connector tile — opaque, square, 512 (site_test)
// — so an app on a home screen wears the platform's face rather than the
// browser's blank sheet. iOS fills a transparent icon with black, which is why
// the tile that carries its own ground is the right one to fall back to.
let unwritten = async (
  req: Request,
  env: Env,
  app: App,
  prefix: string,
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
  // The colours off the app's own front page, which is the only page a
  // manifest is about. A miss is no colours, never a failure.
  let front = await bytes(env, app, prefix, '/')
  if (!front.ok) await front.body?.cancel()
  let theme = front.ok ? themed(await front.text()) : null
  return new Response(JSON.stringify(manifesting(app, at, theme), null, 2), {
    headers: {
      'content-type': 'application/manifest+json',
      'cache-control': keeping(app),
    },
  })
}

let asset = async (
  req: Request,
  env: Env,
  space: Space,
  app: App,
  path: string,
  // Where this app is mounted for the browser that asked, which is what its
  // pages resolve their relative URLs against: `/<app>/`, or `/` when it is
  // the space's front page (T-33040).
  at: string,
  c: Clock,
) => {
  let prefix = prefixOf(space, app)
  if (inside(keyed(prefix, path).slice(prefix.length))) return nothingHere()
  let got = await c.time(
    'bytes',
    () => bytes(env, app, prefix, path),
    // Whether that trip stopped at the edge or went on to the bucket, in the
    // same Server-Timing entry as the time it took: a slow `bytes` stage and a
    // fast one are the same call, and this is the word for which happened.
    (r) => r.headers.get('cf-cache-status'),
  )
  if (got.status != 200) {
    await got.body?.cancel()
    return await unwritten(req, env, app, prefix, path, at) ?? nothingHere()
  }
  let type = got.headers.get('content-type') ?? 'application/octet-stream'
  let etag = await etagOf(got.headers.get(SHA) ?? '', at)
  let headers = { 'content-type': type, 'cache-control': keeping(app), etag }
  // The browser already has these bytes, so it is told so and sent none.
  if (unchanged(req, etag)) {
    await got.body?.cancel()
    return new Response(null, { status: 304, headers })
  }
  if (!type.startsWith('text/html')) return new Response(got.body, { headers })
  // A page, so it gets the app's address before its own first relative URL,
  // and the reporter after it. The weaving is done HERE rather than behind the
  // cache because the same file is a different document at each mount, and one
  // cached copy of the bytes serving every mount beats one copy per mount.
  let page = based(at, pinned(at, await got.text()))
  return reported(at, new Response(page, { headers }))
}

// Where the browser sends what it notices on its own: the app's own report
// door, named as an endpoint group, with NEL asking for the failures that
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

// A flood guard, not a quota: reports per app per minute, counted in this
// isolate and no further. A page in a render loop that throws every frame
// must not write a thousand entities a second; a busy app spread over many
// isolates reporting a few extra breaks is the harmless direction to err.
let RATE = 30
let counted = new Map<string, { minute: number; n: number }>()

let flooding = (space: Space, app: App) => {
  let key = `${space.slug}/${app.slug}`
  let minute = Math.floor(Date.now() / 60_000)
  let hit = counted.get(key)
  if (!hit || hit.minute != minute) {
    counted.set(key, { minute, n: 1 })
    return false
  }
  return ++hit.n > RATE
}

let pathOf = (url: unknown) => {
  try {
    return new URL(String(url)).pathname
  } catch {
    return String(url ?? '')
  }
}

// What one report says broke, in whatever words its sender has: the
// injected script's `message`, or the fields the Reporting API fills in for
// a CSP violation, a crash, a deprecation, a network error.
let said = (b: Record<string, unknown>) =>
  String(
    b.message ??
      [b.type, b.effectiveDirective, b.blockedURL, b.statusCode, b.phase]
        .filter(Boolean).join(' '),
  ).slice(0, 4000)

// A report body, either shape: the small `{message, stack?, url?, line?}` the
// injected script posts, or the Reporting API's array of `{type, url, body}`.
// Junk answers with nothing — a malformed body is the sender's bug, not a
// break in this app, and writing it as one would be the noise we are here to
// stop.
let broken = (body: string) => {
  let sent: unknown
  try {
    sent = JSON.parse(body)
  } catch {
    return []
  }
  let reports = (Array.isArray(sent) ? sent : [sent]) as Record<
    string,
    unknown
  >[]
  return reports.flatMap((r) => {
    if (!r || typeof r != 'object') return []
    let b = (r.body ?? r) as Record<string, unknown>
    // A no somebody answered on purpose is not a break, whoever answered it
    // — the platform's own doors, or the app's worker relaying an outside
    // service's refusal (unseen.ts `refusal` is the one rule). The reporter
    // sends the answer's status beside its bytes (public/report.js), and
    // this is the seam that reads them; a report with no status at all is a
    // script error or an unhandled rejection, and those are breaks.
    if (refusal(String(b.answer ?? ''), Number(b.status))) return []
    let message = said(b)
    if (!message) return []
    let at = pathOf(r.url ?? b.url ?? b.documentURL)
    let source = b.sourceFile ?? b.url
    return [{
      request: `${typeof r.type == 'string' ? r.type : 'page'} ${at}`.trim(),
      message,
      stack: String(
        b.stack ?? (source ? `${source}:${b.lineNumber ?? b.line ?? ''}` : ''),
      ),
    }]
  })
}

// The ceiling on one upload. A store is not a drive: a page downscales a
// photo before it sends it (the guide's five lines), and 20 MB of anything
// else is not what someone meant to put in an app's graph. Exported because
// `app_files` fetch pulls a file off the web into the same store and must
// stop in the same place (tools.ts, T-34337).
export let MAX = 20 * 1024 * 1024

// The bytes' own name (versions.ts `sha256`, the content address a version's
// manifest is made of) is the object's key AND the entity's eid here, so the
// same photo sent twice is one object and one row.
//
// The app's one use of those bytes, addressed off them: derived, so an upload
// finds its own attachment row without reading for it, and the same file sent
// again is that row renamed.
let useOf = (sha: string) =>
  sha256(new TextEncoder().encode(`attachment:${sha}`))

// Where an app's uploaded bytes live: under the app's own prefix, beside its
// files, so throwing the app away takes them with it (tools.ts app_delete)
// and a rename carries them along.
let blobKey = (space: Space, app: App, sha: string) =>
  `${space.slug}/${app.slug}/blobs/${sha}`

// What the upload says these bytes are, and what to call them. The mime is
// the request's own content-type, minus its parameters; the name rides
// `x-yak-name` percent-encoded, since a header is ASCII and a file's name is
// not (public/client.js encodes it).
let mimeSent = (req: Request) =>
  (req.headers.get('content-type') ?? '').split(';')[0].trim().slice(0, 120) ||
  'application/octet-stream'

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
 * Bytes into the app's bucket, and the two rows that name them there — the
 * write half of an upload, without a request anywhere in it, because bytes
 * arrive by other doors too (inbox.ts: a letter's attachments).
 *
 * The object lands in the bucket FIRST and the rows are only returned, because
 * a row pointing at nothing is the failure a reader sees, while bytes nobody
 * has named yet are invisible until the next arrival of the same file names
 * them. The caller applies the bundles, as whoever it decided is writing.
 *
 * Two rows, the way the fleet shapes a file (src/blob.ts): the CONTENT,
 * addressed by its sha and carrying what is true of the bytes — how many they
 * are, and what they measure (image.ts `sizeOf`, off the file's own header) —
 * and the USE of it, carrying what it is called and what it is. They stay
 * apart because they are two things, and because a component may not point at
 * its own entity. The use is addressed off the content, so the same bytes sent
 * twice are one attachment renamed rather than a second row saying the same
 * thing. A listing shows the use and not the content, which is right: a doc's
 * body is a blob row as well, and nobody saved that.
 */
export let filed = async (
  env: Env,
  space: Space,
  app: App,
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
  name: string,
): Promise<
  { sha: string; use: string; size: Size | undefined; bundles: Bundle[] }
> => {
  let sha = await sha256(bytes)
  let blobs = r2Blobs(env.BLOBS)
  let key = blobKey(space, app, sha)
  if (!(await blobs.has(key))) await blobs.put(key, bytes)
  let size = sizeOf(bytes)
  let use = await useOf(sha)
  return {
    sha,
    use,
    size,
    bundles: [
      {
        entity: { eid: sha },
        blob: { bytes: bytes.byteLength },
        ...(size ? { image: size } : {}),
      },
      {
        entity: { eid: use },
        // A patch, so an arrival that names nothing leaves the name the
        // first one gave these bytes: the same file is the same file,
        // whatever the page had to call it the second time.
        attachment: { blob: sha, mime, ...(name ? { name } : {}) },
      },
    ],
  }
}

// A page hands the app bytes and gets back an address (T-32677). The rows are
// the uploader's, written through the app's own /apply with them vouched for,
// so `.created!` says who put it there.
let took = async (
  req: Request,
  env: Env,
  space: Space,
  app: App,
  store: Door,
  headers: Record<string, string>,
) => {
  let sent = Number(req.headers.get('content-length') ?? 0)
  if (sent > MAX) return json(413, 'too_large')
  let bytes = new Uint8Array(await req.arrayBuffer())
  if (!bytes.byteLength) return json(400, 'no_bytes')
  if (bytes.byteLength > MAX) return json(413, 'too_large')
  let file = await filed(env, space, app, bytes, mimeSent(req), nameSent(req))
  try {
    await metaOf(store).apply(file.bundles, headers)
  } catch (e) {
    return json(400, 'refused', e instanceof Error ? e.message : String(e))
  }
  return Response.json({
    eid: file.sha,
    url: `/${app.slug}/api/blob/${file.sha}`,
    mime: mimeSent(req),
    bytes: bytes.byteLength,
    ...file.size,
  })
}

// The bytes back, at the address the upload answered. Content-addressed, so
// they can never change: they cache forever. The mime and the name come off
// the attachment row the upload wrote; a sandbox CSP plus nosniff keeps an
// uploaded page or SVG inert when someone opens it in a tab, the way the
// fleet's own blob door does (src/blob.ts serveBlob).
let gave = async (
  env: Env,
  space: Space,
  app: App,
  store: Door,
  headers: Record<string, string>,
  sha: string,
) => {
  if (!/^[0-9a-f]{64}$/.test(sha)) return json(404, 'no_such_file')
  let bytes
  try {
    bytes = await r2Blobs(env.BLOBS).get(blobKey(space, app, sha))
  } catch {
    return json(404, 'no_such_file')
  }
  let rows = await metaOf((path, init, sent) =>
    store(path, init, { ...headers, ...sent })
  ).query(`.eid=${await useOf(sha)}`)
  let file = (rows as { attachment?: { mime?: string; name?: string } }[])
    .find((r) => r.attachment)?.attachment
  return new Response(bytes, {
    headers: {
      'content-type': file?.mime || 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, immutable',
      'content-security-policy': "sandbox; script-src 'none'",
      'x-content-type-options': 'nosniff',
      ...(file?.name
        ? {
          'content-disposition': `inline; filename="${
            file.name.replace(/["\\\r\n]/g, '')
          }"`,
        }
        : {}),
    },
  })
}

// What to call this person, for the store to write beside their rows: the
// write door's half of the vouch (session.ts `titling`), over this door's own
// directory. An app writing as ITSELF (dispatch.ts `owning`, `env.APP`) is not
// a person, so the directory is not asked to name one — the store knows the
// app it holds and writes no person row for it (graph.ts `#vouching`).
let named = (env: Env, who: Who, app?: App) =>
  app && itsApp(who, app)
    ? Promise.resolve({} as Record<string, string>)
    : titling(directory(bound(env.DIRECTORY, dirPart.fetch, env)), who.person)

// What a write answers, either way it was routed: the entities it touched, and
// the aliases the batch minted for the `$alias` names it was written with. One
// shape for both paths, so a caller never has to know which one ran.
type Wrote = { entities: string[]; aliases: Record<string, string> }

// The words this app USES but does not home (T-32728), as its own store last
// accepted them: the word, and the app in this space whose store holds its
// rows.
let usesOf = async (env: Env, space: Space, app: App) => {
  let r = await storeOf(env.STORE, storeName(space, app))('/uses')
  if (!r.ok) {
    await r.body?.cancel()
    return {} as Record<string, string>
  }
  return await r.json() as Record<string, string>
}

let appsAt = async (env: Env, space: Space, slugs: string[]) => {
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env))
  return (await Promise.all(slugs.map((s) => dir.app(space, s))))
    .filter(Boolean) as App[]
}

// The other stores this app's acts reach: one per app it borrows a word from.
let borrowed = async (
  env: Env,
  space: Space,
  app: App,
  who: Who,
): Promise<Reach[]> => {
  let slugs = [...new Set(Object.values(await usesOf(env, space, app)))]
  if (!slugs.length) return []
  return (await appsAt(env, space, slugs))
    .map((one) => ({ space, app: one, who }))
}

// Where a filter line's words live, when every word it names is one this app
// borrows from a SINGLE other app. Anything else is this app's own store: a
// line spanning two stores is a composition, which the agent door's federated
// read owns and a template's one line does not.
let homeOf = async (
  env: Env,
  space: Space,
  app: App,
  line: string,
): Promise<Door | null> => {
  let uses = await usesOf(env, space, app)
  if (!Object.keys(uses).length) return null
  let names = [...split(line).parts.keys()]
  if (!names.length || !names.every((n) => uses[n])) return null
  let slugs = [...new Set(names.map((n) => uses[n]))]
  if (slugs.length != 1) return null
  let [home] = await appsAt(env, space, slugs)
  return home ? appStore(env.STORE, space, home) : null
}

// The app's two acts, as one person: what a page does through the doors
// below, without a page. An app's own MCP tools are templates over exactly
// these (store/tools.ts, T-32685), so a tool call goes the page's way — the
// app's `access` decides it, the vouched headers name the writer, the listing
// rule shapes the answer — and a refusal is the sentence a page would read.
// Anything a tool can do here, the person calling it could do on the page.
export let acting = (env: Env, space: Space, app: App, who: Who) => {
  let store = appStore(env.STORE, space, app)
  // Signed in and refused, it is the owner's to grant, so the sentence says
  // so; nobody reaches this door signed out, since the agent door has an
  // identity before it has a call (mcp.ts).
  let no = (what: string): never => {
    throw new Error(who.person ? MEMBER[what] : SAYS[what])
  }
  return {
    apply: async (mutation: unknown) => {
      if (!edits(mode(app.access), who.role)) no('not_a_writer')
      let mine = { space, app, who }
      let homes = await borrowed(env, space, app, who)
      // A word this app USES lives in another app's store (T-32728), so a
      // bundle naming one is split the way the agent door splits it: the
      // borrowed word to its home, everything else here. One logical batch —
      // every part is admitted before any of them commits.
      if (homes.length) {
        let batch = (mutation as { entities?: Bundle[] }).entities
        if (batch) {
          let out = await written(
            env,
            [mine, ...homes],
            mine,
            batch,
            await named(env, who),
          )
          return {
            entities: [...new Set(out.bundles.map((b) => b.entity.eid))],
            aliases: out.aliases,
          }
        }
      }
      let applied = await metaOf(store).apply(
        batched(mutation),
        { ...vouched(who), ...await named(env, who) },
      )
      return {
        entities: [...new Set(applied.map((b) => b.entity.eid))],
        aliases: minted(applied),
      }
    },
    query: async (line: string) => {
      if (!reads(mode(app.access), who.role)) no('not_a_reader')
      let asked = asking(lined(line))
      // A line about a borrowed word is asked where that word lives. One
      // home per line: a filter spanning two stores is a composition, and
      // the agent door's federated read is where that is done.
      let door = await homeOf(env, space, app, line) ?? store
      let rows = await metaOf((path, init, headers) =>
        door(path, init, { ...vouched(who), ...headers })
      ).query(asked)
      return Array.isArray(rows) ? listed(rows as Row[], asked) : rows
    },
  }
}

// The graph API, and the file door beside it. Who may do what to the store is
// the app's own `access` (T-32504): `public` reads to anyone and writes to a
// member, `open` writes to anyone with the link, `private` neither without a
// role — 401 to nobody, 403 to a member who may not. The FILE door is not
// part of that bargain: writing an app's bytes is always a member's, whatever
// the app lets its visitors save. Every internal request is built here, so the
// store sees the vouched headers and never the cookie.
let api = async (
  req: Request,
  env: Env,
  space: Space,
  app: App,
  path: string,
  who: Who,
) => {
  // The store client an app's pages import (public/client.js), served beside
  // the doors it wraps so a page needs no address but its own. One file for
  // every app, so it comes from the platform's assets, not the app's blobs.
  if (path == '/client.js' || path == '/report.js') {
    return env.ASSETS.fetch(new Request(new URL(path, req.url)))
  }
  let store = appStore(env.STORE, space, app)
  // What the page (or the browser itself) says broke. Anyone may report —
  // a break belongs to whoever was looking at the page, and asking a
  // stranger to sign in first would lose exactly the breaks nobody sees.
  if (path == '/report') {
    if (req.method != 'POST') return json(405, 'method_not_allowed')
    if (flooding(space, app)) return json(429, 'too_many_reports')
    let reports = broken(await req.text())
    // The deploy the page broke on, read past the directory's cache: a break
    // in the seconds after a deploy must not name the version before it
    // (unseen.ts `serving`, C-32869 item 4).
    let version = reports.length ? await serving(env, space, app) : null
    for (let broke of reports) {
      await noted(
        (bundles) => metaOf(store).apply(bundles, KERNEL),
        { ...broke, version },
        { env, space, app },
      )
    }
    return new Response(null, { status: 204 })
  }
  let headers = vouched(who)
  // Signed out, the way through is to sign in (SAYS); signed in, it is the
  // owner's to grant, so the sentence says so.
  let refused = (what = 'not_a_writer') =>
    who.person ? json(403, what, MEMBER[what]) : json(
      401,
      what,
      SAYS[what],
      signInAt(req.headers.get('referer') || req.url),
    )
  let mayRead = reads(mode(app.access), who.role)
  let mayPost = edits(mode(app.access), who.role)
  // Who is looking, BEFORE the first write (T-32679). A page could only learn
  // this from a refusal, which is too late twice over: on an `open` app a
  // signed-out write has no `created.by`, so the page must ask a guest their
  // name and nothing said so; on a `public` one the sign-in bounce arrives
  // after the guest typed, and their work goes with them (C-32675 items 5 and
  // 6). `person` is null signed out, `name` is what to call them (never an
  // address — T-32654), `reads`/`writes` are this app's own access answered
  // for this caller, and `signIn` is where a signed-out visitor signs in,
  // holding this page as its return address — null once they are in.
  // Answered to anyone: a stranger learning they must sign in is the point.
  if (path == '/me') {
    let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env))
    return Response.json({
      person: who.person,
      name: who.person ? await dir.nameAt(who.person) : null,
      role: who.role,
      reads: mayRead,
      writes: mayPost,
      signIn: who.person
        ? null
        : signInAt(req.headers.get('referer') || req.url),
    })
  }
  // Who visited (views.ts, T-34497). The app's OWN PEOPLE, whatever its
  // access says: a public app's pages are the world's to read and its
  // visitor counts are not, so this asks for a role rather than for `mayRead`.
  // Not switched on is a sentence and a 200, never a failure — the page
  // showing it has nothing to do about a secret nobody set.
  if (path == '/stats') {
    if (!who.role) return refused('not_a_reader')
    let days = new URL(req.url).searchParams.get('days')
    let asked = statsOf(env, app.eid, days ? Number(days) : undefined)
    if (!asked) return Response.json({ on: false, say: NOT_ON })
    try {
      return Response.json({ on: true, ...await asked })
    } catch (e) {
      return json(502, 'refused', e instanceof Error ? e.message : String(e))
    }
  }
  if (path == '/graph') {
    let r = await (await store('/graph', {}, headers)).json()
    return Response.json({ ...r, person: who.person, role: who.role })
  }
  if (path == '/query') {
    if (!mayRead) return refused('not_a_reader')
    // The page spells its filter as the query string itself and the Store takes
    // the whole line as one parameter (wire.ts `lined`). The ask then carries
    // the listing's own screen (listing.ts `asking`), so what a count counts is
    // what a list lists.
    let asked = asking(lined(new URL(req.url).search))
    try {
      let rows = await metaOf((at, init, sent) =>
        store(at, init, { ...headers, ...sent })
      ).query(asked)
      // The same rule the person's agent reads a listing by (listing.ts): one
      // filter line, one answer, whichever door asked it. An AGGREGATE is not
      // a listing — `.count!` answers one number — so it passes through whole.
      return Response.json(
        Array.isArray(rows) ? listed(rows as Row[], asked) : rows,
      )
    } catch (e) {
      return json(400, 'refused', e instanceof Error ? e.message : String(e))
    }
  }
  // The live door: one socket per page onto this app's store, so a write from
  // another device arrives here without asking. The upgrade goes to the object
  // itself — the socket is the store's, and the kernel is out of the way once
  // it is open — so the whole question is decided here, at the handshake, and
  // it is a READ: no write crosses this seam (@yaks/api), a batch goes through
  // `/apply` like any other, and whoever may read may listen.
  if (path == '/ws') {
    if (req.headers.get('upgrade') != 'websocket') {
      return json(426, 'expected_websocket')
    }
    if (!mayRead) return refused('not_a_reader')
    return store('/ws', req, headers)
  }
  if (path == '/apply') {
    if (req.method != 'POST') return json(405, 'method_not_allowed')
    if (!mayPost) return refused()
    let body = await req.text()
    // The free tier's byte ceiling (T-32758). Data costs money to hold, so
    // this is a refusal — one the page shows in the platform's own sentence,
    // the way it shows every other.
    let stopped = await full(env, space, app, body.length)
    if (stopped) return json(413, 'space_full', stopped)
    // A BULK load says so in its content-type: one bundle per line, applied in
    // chunks of 50 and answered a line at a time (@yaks/api `pour`). It is
    // handed to the store as it came and its answer handed back the same way —
    // the page's envelope is a shape for one batch, and this is a file. So this
    // door only counts the bytes, which is the one thing the store cannot.
    if ((req.headers.get('content-type') ?? '').includes('ndjson')) {
      return store('/apply', {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/x-ndjson' },
      }, { ...headers, ...(await named(env, who, app)) })
    }
    // The page's envelope in, the page's answer out (wire.ts): the Store takes
    // a bare array of bundles and answers the batch as applied, and every app
    // already deployed reads `{ok, changes, aliases}` off its own client.
    try {
      return Response.json(
        lowered(
          await metaOf(store).apply(batched(JSON.parse(body)), {
            ...headers,
            ...(await named(env, who, app)),
          }),
        ),
      )
    } catch (e) {
      return json(400, 'refused', e instanceof Error ? e.message : String(e))
    }
  }
  // The file door: bytes in, one content-addressed address out. Uploaded
  // bytes are app DATA, not the app's own files — a vote page's photo is the
  // visitor's, not the deploy's — so the app's `access` governs both halves:
  // its write rule the upload, its read rule the download.
  if (path == '/blob') {
    if (req.method != 'POST') return json(405, 'method_not_allowed')
    if (!mayPost) return refused()
    let stopped = await full(
      env,
      space,
      app,
      Number(req.headers.get('content-length') ?? 0),
    )
    if (stopped) return json(413, 'space_full', stopped)
    return took(req, env, space, app, store, {
      ...headers,
      ...(await named(env, who, app)),
    })
  }
  if (path.startsWith('/blob/')) {
    if (req.method != 'GET') return json(405, 'method_not_allowed')
    if (!mayRead) return refused('not_a_reader')
    return gave(env, space, app, store, headers, path.slice('/blob/'.length))
  }
  if (path.startsWith('/files/')) {
    if (req.method != 'PUT') return json(405, 'method_not_allowed')
    if (!writes(who.role)) return refused()
    let key = keyOf(space, app, path.slice('/files'.length))
    await r2Blobs(env.BLOBS).put(key, new Uint8Array(await req.arrayBuffer()))
    await purged(env, app)
    return Response.json({ ok: true, key })
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
// in one Worker (index.ts binds each), so this is the in-process spelling of
// the service binding a split would give them — a `bound` with no namespace to
// call. Nothing above the owner block below asks for it, so nothing else pays.
let identity = () => import('./identity.ts')

// The space's own address, listed: every app this person may open, and how
// many they may not. What a stranger must never learn is the NAME of a
// private app, so the filter is per app and it is `reads` — the same question
// the file door asks before it serves a page (T-33040).
//
// For its OWNER this is also where a fresh sign-in lands (T-34233), so it
// carries the two things the sign-in card stopped asking — what to call them
// and where their apps live — and the connect instructions, open until an
// agent has ever been let in as them (T-34236).
// Every app's visitors, for the owner's block. One read per app, all at once,
// each already cached for a few minutes in views.ts — and a failure is `null`
// rather than a throw, because this is the space's front door and it does not
// go down because Cloudflare's analytics did.
let visits = async (env: Env, apps: App[]): Promise<Visits[] | null> => {
  let asked = apps.map((a) => statsOf(env, a.eid))
  if (asked.some((s) => !s)) return null
  try {
    let all = await Promise.all(asked as Promise<Stats>[])
    return apps.map((a, i) => ({ slug: a.slug, title: a.title, stats: all[i] }))
  } catch (e) {
    console.log(`views: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

let index = async (
  req: Request,
  env: Env,
  dir: ReturnType<typeof directory>,
  space: Space,
  said?: { say: string; no: boolean },
): Promise<Response> => {
  // The directory's own space is nobody's space: nothing answers at its
  // address, to anyone (T-32585), so it does not get a door either.
  if (space.slug == META.space) return nothingHere()
  let who = await whoIs(req, env.SESSION_SECRET, (p) => dir.role(space, p))
  let here = (await dir.apps(space)).filter((a) => !kernels(space, a.slug))
  // An app in the trash is not one of the apps here (erase.ts, T-34430): it
  // is not listed, not counted as one being held back, and — for the owner
  // alone — it is the block underneath, with the days it has left.
  let all = here.filter((a) => !a.trashed)
  let mine = all.filter((a) => reads(mode(a.access), who.role))
  // The owner's own three facts, and nobody else's business — so nobody else
  // is asked for. `connected` is the provider's answer (identity.ts), not a
  // row of ours: one grant, ever, is what shuts the block.
  let owner = who.role == 'owner' && who.person ? who.person : null
  return spaceIndex({
    // Who visited, the owner's alone (views.ts, T-34497). `undefined` is
    // everybody else, `null` is the platform with no analytics token set, and
    // a read that fails is `null` too: this page is the space's front door,
    // and it does not go down because Cloudflare's analytics did.
    views: owner && all.length ? await visits(env, all) : undefined,
    viewDays: DAYS,
    viewsOff: NOT_ON,
    space: space.slug,
    title: space.title,
    // What the pill says about the gallery (gallery.ts, T-34476). LISTED is
    // said to anybody — it is a public page — and WAITING only to the owner,
    // who is the one it is news for.
    apps: mine.map((a) => ({
      slug: a.slug,
      title: a.title,
      gallery: owner || standing(a) == 'listed' ? pilled(standing(a)) : '',
    })),
    hidden: all.length - mine.length,
    role: who.role,
    person: !!who.person,
    signIn: signInAt(req.url),
    trash: owner
      ? here.filter((a) => a.trashed).map((a) => ({
        slug: a.slug,
        title: a.title,
        days: daysLeft(a.trashed!),
      }))
      : [],
    name: owner ? await dir.nameAt(owner) ?? '' : '',
    connected: !!owner && await (await identity()).connected(env, owner),
    // Something IS built here while an app sits in the trash: its store is
    // named for this address and its files live under it, so the address
    // stays put until the trash is empty (T-32576).
    fixed: !!here.length,
    say: said?.say,
    no: said?.no,
  })
}

// A SPACE in the trash, at any of its addresses (erase.ts, T-34431). Nothing
// under it serves — not an app, not a file, not a store door — so this stands
// ahead of every rung of `served` below, and what it answers is what a wrong
// address answers. Its OWNER is the exception: they are told where their
// space went and given the button back, because they are the only person the
// news belongs to.
//
// The button is a POST to `/` like the space page's own forms, and it lands
// on the platform address rather than back here: a custom domain of a space
// that was in the trash a second ago is a hostname that has to warm up again,
// where the space's own address is serving the moment the word comes off.
let closed = async (
  req: Request,
  env: Env,
  dir: ReturnType<typeof directory>,
  space: Space,
): Promise<Response> => {
  let who = await whoIs(req, env.SESSION_SECRET, (p) => dir.role(space, p))
  if (who.role != 'owner' || !who.person) return nothingHere()
  if (req.method != 'POST') {
    return spaceBinned({
      slug: space.slug,
      title: space.title,
      days: daysLeft(space.trashed!),
    })
  }
  // The same origin check `saved` makes and for the same reason: every space
  // is a subdomain of one registrable domain, so `SameSite=Lax` is not the
  // guard here — a sibling's page is same-site.
  if (!sameOrigin(hostOf(req), req.headers.get('origin'))) return nothingHere()
  let form = await req.formData().catch(() => new FormData())
  if (String(form.get('restore-space') ?? '').trim() == space.slug) {
    await untrashSpace(env, dir, space, who)
  }
  return redirect(`https://${space.slug}.${PLATFORM}/`, 303)
}

// The space's bare address: the listing above, or the owner block's one form
// coming back. Only the two, and only here — the form posts to the page it is
// on, so the space's root is the whole of its surface.
let root = (
  req: Request,
  env: Env,
  dir: ReturnType<typeof directory>,
  space: Space,
) =>
  req.method == 'POST'
    ? saved(req, env, dir, space)
    : index(req, env, dir, space)

// The owner block's one form, saved. Two independent fields and one POST: the
// name they go by, written on their own person row, and the address this space
// answers at, which is `choose`'s rule and nobody else's (identity.ts) so the
// sentence a refusal reads is the same one `/connect` reads.
//
// The answer is a REDIRECT, not a page: a changed address moves this very
// hostname, so the only honest place to land is wherever the space now lives.
// A refusal redraws the page around the sentence, the way every other card
// here does, and needs no script for any of it.
//
// Nobody but the owner reaches this, and only from this space's own page.
// `SameSite=Lax` is NOT the guard here: every space is a subdomain of one
// registrable domain, so a sibling's page is SAME-SITE and the session cookie
// rides a form it posts at this address (route.ts `sameOrigin`, and the same
// reasoning `/deploy` is guarded by). The origin check is, and a stranger —
// signed out, a member, or another space's page — is told exactly what a
// wrong address is told.
let saved = async (
  req: Request,
  env: Env,
  dir: ReturnType<typeof directory>,
  space: Space,
): Promise<Response> => {
  if (!sameOrigin(hostOf(req), req.headers.get('origin'))) return nothingHere()
  let who = await whoIs(req, env.SESSION_SECRET, (p) => dir.role(space, p))
  if (who.role != 'owner' || !who.person) return nothingHere()
  let form = await req.formData().catch(() => new FormData())
  // The other button on this page: one app out of the trash (erase.ts,
  // T-34430). Its own form, so it is its own POST — a plain button and no
  // script, the way the drop zone and the settings form are — and it lands
  // back on this page with the app in the listing again.
  let back = String(form.get('restore') ?? '').trim()
  if (back) {
    let app = await dir.app(space, back)
    if (app?.trashed) await untrash(env, dir, space, app, who)
    return redirect(`https://${space.slug}.${PLATFORM}/`, 303)
  }
  let name = String(form.get('name') ?? '').trim().slice(0, 60)
  let want = String(form.get('space') ?? '').trim().toLowerCase()
  let moved = want && want != space.slug
    ? await (await identity()).choose(env, who.person, want, space)
    : null
  if (moved?.error) {
    return index(req, env, dir, space, { say: moved.error, no: true })
  }
  // Cleared, the front of their address comes back — a person always has a
  // title, because a member row names them by it and a titleless one reads
  // back as a bare eid (T-32733). `nameOf` is the same fallback signing in
  // writes.
  await dir.apply({
    entities: [{
      entity: { eid: who.person },
      doc: { title: name || nameOf(null, await dir.emailAt(who.person) ?? '') },
    }],
  }, { 'x-yak-person': who.person, 'x-yak-role': 'owner' })
  return redirect(`https://${moved?.slug ?? space.slug}.${PLATFORM}/`, 303)
}

// Rung 1½ (D-34197): the home app is the space's ROUTER, and `home.first`
// names the paths its worker sees BEFORE the app whose slug owns them. Null is
// "the order is unchanged" — no home app, no glob over this path, or a router
// that passed, threw or hung (dispatch.ts `ahead`, which fails open).
//
// The kernel's own paths are never routed, whatever the column holds
// (router.ts PLATFORM_PATHS): `app_set` refuses a glob that names one, and
// this is that same rule again at the door, since the graph tier writes the
// column too and a `/garden/*` an owner wrote in good faith already covers
// `/garden/api/query`.
let firstly = async (
  env: Env,
  dir: ReturnType<typeof directory>,
  space: Space,
  req: Request,
  who: Who,
  c: Clock,
) => {
  let path = new URL(req.url).pathname
  if (PLATFORM_PATHS.some((p) => covers(p, path))) return null
  // Which app wears `home`, and its globs with it — one read, cached like
  // every other directory read, and null for the spaces that have no front
  // page at all.
  let home = await c.time('home', () => dir.home(space))
  if (!home || !home.first.some((g) => covers(g, path))) return null
  // The app comes back beside the answer because the answer is the HOME app's
  // and the address is another app's: a page view is counted against whoever
  // actually served it (views.ts).
  let page = await c.time('first', () => ahead(env, space, home, req, who))
  return page && { page, app: home }
}

export let fetch = async (req: Request, env: Env): Promise<Response> => {
  let c = clock()
  return timed(await served(req, env, c), c)
}

// Serving an app, with the stopwatch running (timing.ts): every stage below
// that WAITS is named, so `Server-Timing` on the answer says where the time
// went — the directory, the app's own worker, the bytes — instead of leaving
// a second to guess at (T-33176).
//
// THE ORDER, and it is a rule rather than an accident (D-34197). For a
// request to `<space>.yaks.app<path>`, or to a custom domain mounted at its
// root, five rungs, the first that answers winning:
//
//  1. PLATFORM PATHS are the kernel's and no app routes them: `/.well-known/`
//     on a hostname of ours, where a site GRANTS AUTHORITY over a name that
//     is not the space's (route.ts `platform`, decided before this part), an
//     app's `/<app>/api/…` store doors, and the directory's own space, which
//     nothing is served at to anyone (T-32585).
//  2. AN APP'S SLUG owns the first path segment: `/<app>/…` is that app — its
//     own worker first where it has one, its files behind it — whatever the
//     home app has at the same address, so a home page that wants `/garden`
//     has to be in a space where no app is called garden. A former slug
//     redirects here.
//  3. THE HOME APP'S FILES answer every path no app claims, at the bare
//     hostname: `/photo.png` is its file, `/about` its page.
//  4. THE SPACE'S INDEX is `/`'s last word — a space with no home app, or a
//     home app with no front page — so a space that EXISTS is a door and not
//     a 404 (pages.ts `spaceIndex`).
//  5. EVERYTHING ELSE is the home app's worker where it has one, else 404.
//
// Rungs 3 and 5 are ONE call and the home app is asked exactly the way rung 2
// asks an app: its worker first, its files behind it. That is what makes it
// the space's router — a worker that sees every path no other app claims,
// and answers 404 to PASS (dispatch.ts `ran`), leaving the rest to its files.
// So rung 4 is what is left when neither half of the home app has anything at
// `/`, and rung 5's 404 is what is left when there is no home app at all.
//
// And ONE rung is opted into, between 1 and 2: the paths the home app named
// in `home.first` are its worker's before they are the owning app's
// (`firstly` below). Empty for almost every space, and it can only ever move
// a path from the app that owns it to the home app — never off the platform's
// own (rung 1), and never onto a space that asked for nothing.
let served = async (req: Request, env: Env, c: Clock): Promise<Response> => {
  let r = route(hostOf(req), new URL(req.url).pathname)
  if (r.space == null) return nothingHere()
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env))
  let space = await c.time('space', () => dir.space(r.space!))
  if (!space) return nothingHere()
  if (kernels(space, r.app)) return nothingHere()
  // The whole space in the trash, before any rung of the order below: every
  // hostname of it answers nothing, and its owner is answered the page that
  // brings it back (`closed` above, T-34431).
  if (space.trashed) return closed(req, env, dir, space)
  let url = new URL(req.url)
  // The builder's socket (build.ts, T-34240). A SPACE's door, not an app's:
  // the person it is for has no app yet, so it is answered here — before the
  // home app is looked for, since a space with none would be a 404 at every
  // path but `/`. It is a platform path (router.ts), so no app routes it.
  // The live half of that chat (public/build.js, T-34242), served here so a
  // space's page needs no asset of the apex — the same rule as the client an
  // app's pages import, one file for every space. Nobody's secret: it is the
  // page's own script, and the door it opens still asks who is asking.
  if (url.pathname == `${BUILD}.js`) {
    return env.ASSETS.fetch(new Request(new URL('/build.js', req.url)))
  }
  if (url.pathname == BUILD) {
    let posts = req.method == 'POST'
    if (!posts && req.headers.get('upgrade') != 'websocket') {
      return json(426, 'expected_websocket')
    }
    let who = await c.time(
      'who',
      () => whoIs(req, env.SESSION_SECRET, (p) => dir.role(space!, p)),
    )
    if (!who.person) {
      return json(401, 'not_a_writer', NOBODY, signInAt(url.href))
    }
    if (!writes(who.role)) return json(403, 'not_a_writer', NOT_A_WRITER)
    // A form POST is the browser that ran no script (build.ts `posting`): one
    // line, the round waited for, and a page back.
    return posts
      ? posting(env, space, req, who)
      : joining(env, space.eid, req, who)
  }
  let app = r.app ? await c.time('app', () => dir.app(space!, r.app!)) : null
  // In the trash (erase.ts, T-34430): the address is held for it and answers
  // nothing while it waits. Not a 410 and not a redirect — to the web this is
  // an address with nothing at it, which is what a delete has always meant —
  // and only the space's own people are told where the app went, since a
  // stranger learning that an app was deleted here learns something that is
  // not theirs.
  if (app?.trashed) {
    let who = await c.time(
      'who',
      () => whoIs(req, env.SESSION_SECRET, (p) => dir.role(space!, p)),
    )
    return who.role == 'owner'
      ? binned({ title: app.title || app.slug, days: daysLeft(app.trashed) })
      : nothingHere()
  }
  if (r.app && !app) {
    // Not an app here — but it may be where one USED to be (directory.ts
    // former): a rename moves the address and keeps the old one pointing at
    // it, files and `/api/…` alike.
    let was = await dir.former(space, r.app)
    if (was) return moved(req, `/${was.slug}${r.path || '/'}${url.search}`)
  }
  // The space's front page is SERVED at its bare hostname (T-33040): rung 3
  // above. Before this the root answered a 302 into `/<app>/`, so the
  // sub-path was in the address bar and in every link anyone copied. On a
  // customer's own domain that is the whole point: her site has to BE at
  // herbusiness.com (T-33035, index.ts `aimed`), and one rule serves both
  // hostnames.
  //
  // A custom domain arrives already mounted at its own root (index.ts
  // `aimed` sets the header): the app is the domain's `/` however the
  // platform's own address spells it, so it is not forwarded anywhere — the
  // forward would land back on the address that arrived — and its pages
  // resolve from that root.
  let mount = req.headers.get(MOUNT)
  let path = r.path
  let front = !!app && app.home
  if (!app) {
    // Which app is home is a DIRECTORY READ, so it happens here, where env
    // is, and not in route.ts, which is pure (index.ts `aimed`, same reason).
    let home = await c.time('home', () => dir.home(space!))
    // No front page at all — the ordinary state of a space, since being the
    // first app claims nothing (tools.ts `app_new`). Rung 4 at the bare
    // address, rung 5's 404 anywhere else: there is no home worker to be the
    // fall-through, so a path under such a space names nothing and says so.
    if (!home || kernels(space, home.slug)) {
      if (url.pathname != '/') return nothingHere()
      return await root(req, env, dir, space)
    }
    // `/<x>/api/…` named an app that is not here. That is a wrong address,
    // not one of the front page's own paths: a page asking a store there has
    // to hear a 404, never a page of HTML it cannot parse (C-32574 item 4).
    if (r.app && r.path.startsWith('/api/')) return nothingHere()
    app = home
    front = true
    path = url.pathname
  } else if (!mount && front && (path == '' || path == '/')) {
    // The home app's OWN `/<app>/` forwards to the bare hostname, so its
    // address is that and nothing else, and links anybody already holds still
    // arrive. Temporary, not permanent — which app is home is a word the owner
    // moves from one app to another (tools.ts `app_set`), and a 301 a browser
    // cached would outlive the move.
    return redirect(`/${url.search}`)
  } else if (path == '') return redirect(`${url.pathname}/`)
  // The app's own worker, coming back through its service binding for its
  // store or its files (dispatch.ts): the grant says who it is acting as, so
  // there is no cookie to read — and a request holding one is never sent BACK
  // to the worker, which is what keeps `env.FILES.fetch('/index.html')` from
  // being a loop.
  // Where this app is mounted for the browser that asked: the prefix its
  // pages resolve relative URLs against, and where its reporter lives.
  let at = mount ?? (front ? '/' : `/${app.slug}/`)
  let itself = await granted(req, env.SESSION_SECRET, storeName(space, app))
  let who = itself ??
    await c.time(
      'who',
      () => whoIs(req, env.SESSION_SECRET, (p) => dir.role(space!, p)),
    )
  // Rung 1½: the home app's router, where it named this path. Ahead of the app
  // whose slug owns it — and ahead of that app's own access rule, since what
  // answers is the HOME app's page and not this one's. Not for the home app's
  // own addresses, where its worker is already what rungs 3 and 5 ask, and
  // never for a request an app's worker made: the router's own onward call
  // carries the grant it was handed, and without that guard it would arrive
  // back at the path it just intercepted (dispatch.ts `bearing`).
  if (!front && !bearing(req)) {
    let early = await firstly(env, dir, space, req, who, c)
    // The answer is the home app's, so it reports as the home app — and is
    // counted as the home app's page view — at the bare hostname, which is
    // where the home app is mounted.
    if (early) {
      viewed(env, req, early.page, seen(space, early.app))
      return reporting(early.page, req, '/')
    }
  }
  // The `/api/` doors stay the kernel's, always, and keep their own refusals,
  // which speak.
  if (path.startsWith('/api/')) {
    return reporting(
      await c.time(
        'api',
        () => api(req, env, space!, app!, path.slice(4), who),
      ),
      req,
      at,
    )
  }
  // A private app hides its PAGE too, not only its data (C-32607 item 5):
  // `access: private` says only its members can see it, and its files are
  // part of what they see. A stranger is sent to sign in and handed back to
  // the page (T-32593); someone signed in who is nobody here gets the same
  // nothing-here a wrong address gets — whether the app exists at all is its
  // owner's to tell.
  //
  // ITS OWN WORKER IS THE EXCEPTION, both ways round (T-34303). The worker
  // runs ahead of this gate, and a request coming BACK from it passes the gate
  // — `itself` is a grant the kernel minted for this store and this request,
  // which nothing but this app's own worker can hold, so `env.FILES` reads the
  // app's pages where a stranger asking directly is refused. On a private app
  // the worker IS the gatekeeper: `access` is one word about the whole store,
  // and a rule finer than that — the invitation code that opens one
  // household's row and no other — can only live in the app's own code. What
  // that code may do AS the app is `env.APP` and nothing else; its `env.STORE`
  // is still the visitor, so a worker that only passes a store read on refuses
  // exactly what the page would have.
  let mayRead = !!itself || reads(mode(app.access), who.role)
  // Both at once, because they are two halves of one answer and neither
  // needs the other's result (T-33176). The app's own worker answers first
  // where it has one and the file is what it falls back to, so asking the
  // dispatch namespace and only then the bucket cost two round trips end to
  // end — and almost every app has no worker at all, so almost every page
  // paid the first one purely to be told so. Started together, a page costs
  // the LONGER of the two rather than their sum.
  //
  // The wasted read is the rare case — an app whose worker answers — and it
  // is one small GET. The `catch` is there because a promise nobody awaits
  // must not surface as an unhandled rejection.
  let file = mayRead ? asset(req, env, space, app, path, at, c) : null
  file?.catch(() => {})
  let own = itself
    ? null
    : await c.time('worker', () => ran(env, space!, app!, req, who))
  // The worker passed, and the files are not this visitor's to see.
  if (!own && !file) {
    return who.person ? nothingHere() : redirect(signInAt(req.url), 303)
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
    return await index(req, env, dir, space)
  }
  // A page was served, so somebody saw it (views.ts, T-34496). Last, once, and
  // only for what an APP answered: the `/api/` doors returned above, a file
  // that is not HTML is not a page, and the platform's own pages — the space
  // index, the trash, a wrong address — never come back through here.
  viewed(env, req, page, seen(space, app))
  return reporting(page, req, at)
}

// One page view's identity: which app it was a page of, and the address it was
// served under. The eid is the data point's one index, so every query groups
// by the app and a rename never loses a day of history.
let seen = (space: Space, app: App) => ({
  app: app.eid,
  space: space.slug,
  slug: app.slug,
})
