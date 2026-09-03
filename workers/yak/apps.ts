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
// 404 from it falling back to the files, and `/api/` never its.
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
import {
  type App,
  directory,
  META,
  type Space,
  storeName,
} from './directory.ts'
import * as dirPart from './directory.ts'
import { granted, ran } from './dispatch.ts'
import { bound, type Env } from './env.ts'
import { sizeOf } from './image.ts'
import { asking, listed, listing } from './listing.ts'
import { nothingHere, spaceIndex } from './pages.ts'
import { hostOf, MOUNT, PLATFORM, route } from './route.ts'
import {
  mayWrite,
  reads,
  titling,
  vouched,
  type Who,
  whoIs,
  writes,
} from './session.ts'
import { type Reach, split, written } from './reach.ts'
import type { EntityLiteral } from '../../src/mutation.ts'
import { type Door, storeOf } from './store.ts'
import { type Clock, clock, timed } from './timing.ts'
import { noted, refusal, serving } from './unseen.ts'
import { full } from './usage.ts'
import { sha256 } from './versions.ts'

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

let MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json',
  webmanifest: 'application/manifest+json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  woff: 'font/woff',
  woff2: 'font/woff2',
  wasm: 'application/wasm',
  pdf: 'application/pdf',
}

let mimeOf = (path: string) =>
  MIME[path.slice(path.lastIndexOf('.') + 1)] ?? 'application/octet-stream'

// A file's key in the blob store: the app's slugs then its path, a directory
// answering with its index. Decoded, so the key is the name the file was
// put under; a malformed escape throws, and the router reports it.
let keyOf = (space: Space, app: App, path: string) =>
  `${space.slug}/${app.slug}${
    decodeURIComponent(path.endsWith('/') ? `${path}index.html` : path)
  }`

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
// Where the parser will read it: inside the head if the page has one, else
// after the doctype, which must stay the document's first thing or the
// browser reads the whole page in quirks mode. A page carrying its own
// `<base>` keeps it, and is given none: the first in tree order is the
// document's, and an author who wrote one meant it. declared.ts hands a view
// to an MCP host by the same rule, at that app's absolute address.
export let based = (href: string, page: string) => {
  if (/<base[\s>][^>]*\bhref\b/i.test(page)) return page
  let tag = `<base href="${href}">`
  let head = /<head[^>]*>/i.exec(page)
  if (head) return page.replace(head[0], `${head[0]}${tag}`)
  let doctype = /^\s*<!doctype[^>]*>/i.exec(page)
  return doctype ? page.replace(doctype[0], `${doctype[0]}${tag}`) : tag + page
}

// A path behind no file whose last segment names no file TYPE is a route,
// not a miss (T-32769): `/recipes/42` is the page asking to be opened at a
// place, so the app's own index.html answers it with 200 and the page routes
// on `location.pathname`. Anything with an extension is a file that is not
// there, and stays the soft 404 — a missing stylesheet must not answer HTML.
let pretty = (path: string) => !path.split('/').pop()!.includes('.')

// The files that ARE the app's platform manifest rather than its page: the
// server code the dispatch namespace runs (dispatch.ts) and the two
// declarations a deploy reads (tools.ts). Those are the app's INSIDE — the
// platform reads them out of the blob store, and a member reads them back
// through `app_files` — so the door that serves the app's pages does not
// serve them to the web. Before this, `GET /weather/worker.js` answered the
// whole server source to anyone with the link (C-32869 item 3).
//
// The test is on the decoded KEY, not the path, because `/%77orker.js` names
// the same file.
let MANIFEST = new Set(['/worker.js', '/vocab.json', '/tools.json'])

let asset = async (
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
  let blobs = r2Blobs(env.BLOBS)
  let key = keyOf(space, app, path)
  if (MANIFEST.has(key.slice(`${space.slug}/${app.slug}`.length))) {
    return nothingHere()
  }
  // ONE read, not a stat and then a read (T-33176): the bucket is a round
  // trip away — for most of the world an ocean away — and asking whether the
  // file is there before asking for it paid that trip twice for every file
  // the app serves. `read` answers the bytes or null, so a miss costs the
  // same one trip a hit does.
  //
  // The index the fallback serves is the app's own, so the reporter and the
  // reporting headers ride along exactly as they do at `/`.
  let bytes = await c.time('bytes', () => blobs.read(key))
  if (!bytes && pretty(path)) {
    key = keyOf(space, app, '/')
    bytes = await c.time('index', () => blobs.read(key))
  }
  if (!bytes) return nothingHere()
  let type = mimeOf(key)
  let headers = { 'content-type': type }
  if (!type.startsWith('text/html')) return new Response(bytes, { headers })
  // A page, so it gets the app's address before its own first relative URL,
  // and the reporter after it. The bytes are already whole here (the blob
  // seam answers a Uint8Array), so reading them to decide whether the page
  // has a `<base>` of its own costs nothing the serve did not already spend.
  let page = based(at, new TextDecoder().decode(bytes))
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
// else is not what someone meant to put in an app's graph.
let MAX = 20 * 1024 * 1024

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

// A page hands the app bytes and gets back an address (T-32677). The object
// lands in the bucket first and the row second, because a row pointing at
// nothing is the failure a reader sees, while bytes nobody has named yet are
// invisible until the next upload of the same file names them. The row is
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
  let sha = await sha256(bytes)
  let blobs = r2Blobs(env.BLOBS)
  let key = blobKey(space, app, sha)
  if (!(await blobs.has(key))) await blobs.put(key, bytes)
  let mime = mimeSent(req)
  let name = nameSent(req)
  // What the file says it measures, off its header (image.ts). A wall wants
  // to reserve a photo's space before its bytes arrive, and only the door
  // ever holds the bytes; a file that states no size gets no `image`. It
  // rides the CONTENT row, where a dimension belongs — the bytes are that
  // wide however many attachments name them — and where a page already has
  // the eid, since the sha is what its own row points at.
  let size = sizeOf(bytes)
  // Two rows, the way the fleet shapes a file (src/blob.ts): the CONTENT,
  // addressed by its sha and carrying what is true of the bytes — how many
  // they are, and what they measure — and the USE of it, carrying what it is
  // called and what it is. They stay apart because they
  // are two things — and because a component may not point at its own entity.
  // The use is addressed too, off the content's address, so the same bytes
  // sent twice are one attachment renamed rather than a second row saying the
  // same thing. A listing shows the use and not the content, which is right:
  // a doc's body is a blob row as well, and nobody saved that.
  let saved = await store('/apply', {
    method: 'POST',
    body: JSON.stringify({
      entities: [
        {
          entity: { eid: sha },
          blob: { bytes: bytes.byteLength },
          ...(size ? { image: size } : {}),
        },
        {
          entity: { eid: await useOf(sha) },
          // A patch, so an upload that names nothing leaves the name the
          // first one gave these bytes: the same file is the same file,
          // whatever the page had to call it the second time.
          attachment: { blob: sha, mime, ...(name ? { name } : {}) },
        },
      ],
    }),
  }, headers)
  if (!saved.ok) return saved
  await saved.body?.cancel()
  return Response.json({
    eid: sha,
    url: `/${app.slug}/api/blob/${sha}`,
    mime,
    bytes: bytes.byteLength,
    ...size,
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
  let rows = await (await store(`/query?id=${await useOf(sha)}`, {}, headers))
    .json()
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
// directory.
let named = (env: Env, who: Who) =>
  titling(directory(bound(env.DIRECTORY, dirPart.fetch, env)), who.person)

// What a write answers, either way it was routed.
type Wrote = {
  changes?: { eid: string; name: string; comp: unknown }[]
  aliases?: Record<string, string>
}

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
  return home ? storeOf(env.STORE, storeName(space, home)) : null
}

// The app's two acts, as one person: what a page does through the doors
// below, without a page. An app's own MCP tools are templates over exactly
// these (store/tools.ts, T-32685), so a tool call goes the page's way — the
// app's `access` decides it, the vouched headers name the writer, the listing
// rule shapes the answer — and a refusal is the sentence a page would read.
// Anything a tool can do here, the person calling it could do on the page.
export let acting = (env: Env, space: Space, app: App, who: Who) => {
  let store = storeOf(env.STORE, storeName(space, app))
  // Signed in and refused, it is the owner's to grant, so the sentence says
  // so; nobody reaches this door signed out, since the agent door has an
  // identity before it has a call (mcp.ts).
  let no = (what: string): never => {
    throw new Error(who.person ? MEMBER[what] : SAYS[what])
  }
  return {
    apply: async (mutation: unknown) => {
      if (!writes(who, app.access)) no('not_a_writer')
      let mine = { space, app, who }
      let homes = await borrowed(env, space, app, who)
      // A word this app USES lives in another app's store (T-32728), so a
      // bundle naming one is split the way the agent door splits it: the
      // borrowed word to its home, everything else here. One logical batch —
      // every part is admitted before any of them commits.
      if (homes.length) {
        let batch = (mutation as { entities?: EntityLiteral[] }).entities
        if (batch) {
          return JSON.parse(
            (await written(
              env,
              [mine, ...homes],
              mine,
              batch,
              await named(env, who),
            )).body,
          ) as Wrote
        }
      }
      let r = await store('/apply', {
        method: 'POST',
        body: JSON.stringify(mutation),
      }, { ...vouched(who), ...await named(env, who) })
      let body = await r.text()
      if (!r.ok) throw new Error(body)
      return JSON.parse(body) as Wrote
    },
    query: async (line: string) => {
      if (!reads(who, app.access)) no('not_a_reader')
      let asked = asking(`?${line.replace(/^[?&]+/, '')}`)
      // A line about a borrowed word is asked where that word lives. One
      // home per line: a filter spanning two stores is a composition, and
      // the agent door's federated read is where that is done.
      let door = await homeOf(env, space, app, line) ?? store
      let r = await door(`/query${asked}`, {}, vouched(who))
      let body = await r.text()
      if (!r.ok) throw new Error(body)
      let rows = JSON.parse(body)
      return Array.isArray(rows) ? listed(rows, asked) : rows
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
  let store = storeOf(env.STORE, storeName(space, app))
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
      await noted(store, { ...broke, version }, { env, space, app })
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
  let mayRead = reads(who, app.access)
  let mayPost = writes(who, app.access)
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
  if (path == '/graph') {
    let r = await (await store('/graph', {}, headers)).json()
    return Response.json({ ...r, person: who.person, role: who.role })
  }
  if (path == '/query') {
    if (!mayRead) return refused('not_a_reader')
    // The ask carries the listing's own screen (listing.ts `asking`), so what
    // a count counts is what a list lists.
    let asked = asking(new URL(req.url).search)
    let r = await store(`/query${asked}`, {}, headers)
    if (!r.ok) return r
    // The same rule the person's agent reads a listing by (listing.ts): one
    // filter line, one answer, whichever door asked it.
    return new Response(listing(await r.text(), asked), {
      headers: { 'content-type': 'application/json' },
    })
  }
  // The live door: one socket per page onto this app's store, so a write from
  // another device arrives here without asking. The upgrade goes to the object
  // itself — the socket is the store's, and the kernel is out of the way once
  // it is open — so whether this person may WRITE over it is decided here, at
  // the handshake, and rides on the socket. Whoever may read may listen.
  if (path == '/ws') {
    if (req.headers.get('upgrade') != 'websocket') {
      return json(426, 'expected_websocket')
    }
    if (!mayRead) return refused('not_a_reader')
    return store('/ws', req, {
      ...headers,
      ...(mayPost ? { 'x-yak-write': '1', ...(await named(env, who)) } : {}),
    })
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
    return store('/apply', { method: 'POST', body }, {
      ...headers,
      ...(await named(env, who)),
    })
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
      ...(await named(env, who)),
    })
  }
  if (path.startsWith('/blob/')) {
    if (req.method != 'GET') return json(405, 'method_not_allowed')
    if (!mayRead) return refused('not_a_reader')
    return gave(env, space, app, store, headers, path.slice('/blob/'.length))
  }
  if (path.startsWith('/files/')) {
    if (req.method != 'PUT') return json(405, 'method_not_allowed')
    if (!mayWrite(who)) return refused()
    let key = keyOf(space, app, path.slice('/files'.length))
    await r2Blobs(env.BLOBS).put(key, new Uint8Array(await req.arrayBuffer()))
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

// The space's own address, listed: every app this person may open, and how
// many they may not. What a stranger must never learn is the NAME of a
// private app, so the filter is per app and it is `reads` — the same question
// the file door asks before it serves a page (T-33040).
let index = async (
  req: Request,
  env: Env,
  dir: ReturnType<typeof directory>,
  space: Space,
) => {
  let who = await whoIs(req, env.SESSION_SECRET, (p) => dir.role(space, p))
  let all = (await dir.apps(space)).filter((a) => !kernels(space, a.slug))
  let mine = all.filter((a) => reads(who, a.access))
  return spaceIndex({
    space: space.slug,
    title: space.title,
    apps: mine.map((a) => ({ slug: a.slug, title: a.title })),
    hidden: all.length - mine.length,
    role: who.role,
    person: !!who.person,
    signIn: signInAt(req.url),
  })
}

export let fetch = async (req: Request, env: Env): Promise<Response> => {
  let c = clock()
  return timed(await served(req, env, c), c)
}

// Serving an app, with the stopwatch running (timing.ts): every stage below
// that WAITS is named, so `Server-Timing` on the answer says where the time
// went — the directory, the app's own worker, the bytes — instead of leaving
// a second to guess at (T-33176).
let served = async (req: Request, env: Env, c: Clock): Promise<Response> => {
  let r = route(hostOf(req), new URL(req.url).pathname)
  if (r.space == null) return nothingHere()
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env))
  let space = await c.time('space', () => dir.space(r.space!))
  if (!space) return nothingHere()
  if (kernels(space, r.app)) return nothingHere()
  let url = new URL(req.url)
  let app = r.app ? await c.time('app', () => dir.app(space!, r.app!)) : null
  if (r.app && !app) {
    // Not an app here — but it may be where one USED to be (directory.ts
    // former): a rename moves the address and keeps the old one pointing at
    // it, files and `/api/…` alike.
    let was = await dir.former(space, r.app)
    if (was) return moved(req, `/${was.slug}${r.path || '/'}${url.search}`)
  }
  // The space's front page is SERVED at its bare hostname (T-33040): the
  // home app's `/` is `<space>.yaks.app/`, and every address no other app
  // claims is that app's too — `/photo.png` is its file, `/about` its page.
  // Before this the root answered a 302 into `/<app>/`, so the sub-path was
  // in the address bar and in every link anyone copied. On a customer's own
  // domain that is the whole point: her site has to BE at herbusiness.com
  // (T-33035, index.ts `aimed`), and now one rule serves both hostnames.
  //
  // PRECEDENCE, and it is a rule rather than an accident: the space's apps
  // own the first path segment, and the front page answers everything left.
  // `<space>.yaks.app/garden` is the garden app whether or not the front page
  // has a `garden` page of its own, so a front page that wants that address
  // has to be in a space where no app is called garden.
  //
  // The other direction of the same idea: the front page's OWN `/<app>/`
  // forwards here, so its address is the bare hostname and nothing else, and
  // links anybody already holds still arrive. Temporary, not permanent —
  // which app is the front page is a column on the space the owner moves
  // (tools.ts `app_set`), and a 301 a browser cached would outlive the move.
  //
  // Which app is home is a DIRECTORY READ, so it happens here, where env is,
  // and not in route.ts, which is pure (index.ts `aimed`, same reason).
  //
  // A custom domain arrives already mounted at its own root (index.ts
  // `aimed` sets the header): the app is the domain's `/` however the
  // platform's own address spells it, so it is not forwarded anywhere — the
  // forward would land back on the address that arrived — and its pages
  // resolve from that root.
  let mount = req.headers.get(MOUNT)
  let path = r.path
  let front = !!app && app.eid == space.home
  if (!app) {
    let home = await c.time('home', () => dir.home(space!))
    // No front page — the ordinary state of a space, since being the first
    // app claims nothing (tools.ts `app_new`). The space EXISTS, so its own
    // address is a door and not a 404: it lists the apps this visitor may
    // open, and says the rest in their terms (pages.ts `spaceIndex`). Only
    // the bare address lists; a path under a space with no front page names
    // nothing, and says so.
    if (!home || kernels(space, home.slug)) {
      // The directory's own space is nobody's space: nothing answers at its
      // address, to anyone (T-32585), so it does not get a door either.
      if (url.pathname != '/' || space.slug == META.space) return nothingHere()
      return await index(req, env, dir, space)
    }
    // `/<x>/api/…` named an app that is not here. That is a wrong address,
    // not one of the front page's own paths: a page asking a store there has
    // to hear a 404, never a page of HTML it cannot parse (C-32574 item 4).
    if (r.app && r.path.startsWith('/api/')) return nothingHere()
    app = home
    front = true
    path = url.pathname
  } else if (!mount && front && (path == '' || path == '/')) {
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
  // A private app hides its PAGE too, not only its data (C-32607 item 5):
  // `access: private` says only its members can see it, and its files are
  // part of what they see. A stranger is sent to sign in and handed back to
  // the page (T-32593); someone signed in who is nobody here gets the same
  // nothing-here a wrong address gets — whether the app exists at all is its
  // owner's to tell. The `/api/` doors keep their own refusals, which speak.
  if (!path.startsWith('/api/') && !reads(who, app.access)) {
    return who.person ? nothingHere() : redirect(signInAt(req.url), 303)
  }
  // The app's own code answers first, where it has any: `ran` is null when
  // the app deployed no worker.js and when the worker answered 404, which is
  // how a worker owns its routes and leaves its pages to the platform. The
  // `/api/` doors stay the kernel's, always.
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
  let own = itself
    ? null
    : await c.time('worker', () => ran(env, space!, app!, req, who))
  return reporting(
    own ?? await asset(env, space, app, path, at, c),
    req,
    at,
  )
}
