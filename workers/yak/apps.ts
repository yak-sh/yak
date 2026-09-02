// The app-serving part: `<space>.yaks.app/<app>/…` — the deploy seam's first
// hosted implementation (D-32318 §v1 sequencing). One fetch handler: it
// reads the hostname and path (route.ts), resolves the space and app through
// the directory part (directory.ts, in-process or across a binding), verifies
// the session (session.ts), and serves the app's files out of its blob store
// with the graph API for its (space, app) store beside them —
// `/api/{apply,query,graph}` mapped onto the Store object's doors, the store
// named from the route, never by the client. `PUT /api/files/<path>` is the
// write side, what a deploy is until app_deploy (T-32329) exists. Workers for
// Platforms dispatch — an app's own Worker answering here — is the second
// implementation and waits on T-32345; it slots in where `asset` is called,
// with the same `vouched` headers, and nothing here pretends to.
//
// A page's own breaks come back here too (T-32486), without the page asking:
// every HTML response is rewritten on its way out to carry the reporter
// script (public/report.js), every app response carries `Reporting-Endpoints`
// and `NEL` so the browser itself reports CSP violations, crashes,
// deprecations and network errors, and both land on `POST /api/report`, which
// writes the same `exception` entity a route that threw does. Rate-limited
// per app: a page in a loop is a bug to see once, not a write flood.
import { r2Blobs } from '../../src/blobs_r2.ts'
import {
  type App,
  directory,
  META,
  type Space,
  storeName,
} from './directory.ts'
import * as dirPart from './directory.ts'
import { bound, type Env } from './env.ts'
import { nothingHere } from './pages.ts'
import { hostOf, route } from './route.ts'
import { mayWrite, reads, vouched, type Who, whoIs, writes } from './session.ts'
import { storeOf } from './store.ts'
import { noted } from './unseen.ts'

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

let json = (status: number, code: string) =>
  Response.json({ error: { code } }, { status })

let redirect = (to: string) =>
  new Response(null, { status: 302, headers: { location: to } })

// The reporter, into every page the kernel serves, wherever the page has a
// place to put it: first inside `<head>`, else first inside `<body>`, else
// at the end of a document with neither. Streaming — the bytes are never
// held — and once, whichever came first.
let reported = (app: App, page: Response) => {
  let tag = `<script src="/${app.slug}/api/report.js"></script>`
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

let asset = async (env: Env, space: Space, app: App, path: string) => {
  let blobs = r2Blobs(env.BLOBS)
  let key = keyOf(space, app, path)
  if (!(await blobs.has(key))) return nothingHere()
  let type = mimeOf(key)
  let file = new Response(await blobs.get(key), {
    headers: { 'content-type': type },
  })
  return type.startsWith('text/html') ? reported(app, file) : file
}

// Where the browser sends what it notices on its own: the app's own report
// door, named as an endpoint group, with NEL asking for the failures that
// never reached us at all.
let reporting = (res: Response, req: Request, app: App) => {
  // A socket is not a page: the 101 carries the runtime's own `webSocket`,
  // which no Response constructor here can copy, and nothing about it reports.
  if (res.status == 101) return res
  let headers = new Headers(res.headers)
  headers.set(
    'reporting-endpoints',
    `yak="${new URL(`/${app.slug}/api/report`, req.url).href}"`,
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
    for (let broke of broken(await req.text())) {
      await noted(store, { ...broke, version: app.version })
    }
    return new Response(null, { status: 204 })
  }
  let headers = vouched(who)
  let refused = (what = 'not_a_writer') => json(who.person ? 403 : 401, what)
  let mayRead = reads(who, app.access)
  let mayPost = writes(who, app.access)
  if (path == '/graph') {
    let r = await (await store('/graph', {}, headers)).json()
    return Response.json({ ...r, person: who.person, role: who.role })
  }
  if (path == '/query') {
    if (!mayRead) return refused('not_a_reader')
    return store(`/query${new URL(req.url).search}`, {}, headers)
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
      ...(mayPost ? { 'x-yak-write': '1' } : {}),
    })
  }
  if (path == '/apply') {
    if (req.method != 'POST') return json(405, 'method_not_allowed')
    if (!mayPost) return refused()
    return store('/apply', { method: 'POST', body: await req.text() }, headers)
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

export let fetch = async (req: Request, env: Env): Promise<Response> => {
  let r = route(hostOf(req), new URL(req.url).pathname)
  if (r.space == null) return nothingHere()
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env))
  let space = await dir.space(r.space)
  if (!space) return nothingHere()
  if (r.app == null) {
    let home = r.path == '/' ? await dir.home(space) : null
    return home ? redirect(`/${home.slug}/`) : nothingHere()
  }
  let app = await dir.app(space, r.app)
  if (!app) return nothingHere()
  if (r.path == '') return redirect(`${new URL(req.url).pathname}/`)
  let who = await whoIs(req, env.SESSION_SECRET, (p) => dir.role(space, p))
  // The meta space's first member: while `yak` has no members at all, any
  // signed-in person may write it — that is how the first owner is written,
  // by the first sign-in (T-32327). Once one member exists the rule is the
  // ordinary one.
  if (
    who.person && !mayWrite(who) && space.slug == META.space &&
    await dir.memberless(space)
  ) {
    who = { ...who, role: 'owner' }
  }
  return reporting(
    await (r.path.startsWith('/api/')
      ? api(req, env, space, app, r.path.slice(4), who)
      : asset(env, space, app, r.path)),
    req,
    app,
  )
}
