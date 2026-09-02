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
import { r2Blobs } from '../../src/blobs_r2.ts'
import { type App, directory, META, type Space } from './directory.ts'
import * as dirPart from './directory.ts'
import { bound, type Env } from './env.ts'
import { nothingHere } from './pages.ts'
import { hostOf, route } from './route.ts'
import { mayWrite, vouched, type Who, whoIs } from './session.ts'
import { storeOf } from './store.ts'

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

let asset = async (env: Env, space: Space, app: App, path: string) => {
  let blobs = r2Blobs(env.BLOBS)
  let key = keyOf(space, app, path)
  if (!(await blobs.has(key))) return nothingHere()
  return new Response(await blobs.get(key), {
    headers: { 'content-type': mimeOf(key) },
  })
}

// The graph API, and the file door beside it. A write needs a member who may
// write — 401 to nobody, 403 to a member who may not — and every internal
// request is built here, so the store sees the vouched headers and never the
// cookie.
let api = async (
  req: Request,
  env: Env,
  space: Space,
  app: App,
  path: string,
  who: Who,
) => {
  let store = storeOf(env.STORE, space.slug, app.slug)
  let headers = vouched(who)
  let refused = () => json(who.person ? 403 : 401, 'not_a_writer')
  if (path == '/graph') {
    let r = await (await store('/graph', {}, headers)).json()
    return Response.json({ ...r, person: who.person, role: who.role })
  }
  if (path == '/query') {
    return store(`/query${new URL(req.url).search}`, {}, headers)
  }
  if (path == '/apply') {
    if (req.method != 'POST') return json(405, 'method_not_allowed')
    if (!mayWrite(who)) return refused()
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
  return r.path.startsWith('/api/')
    ? api(req, env, space, app, r.path.slice(4), who)
    : asset(env, space, app, r.path)
}
