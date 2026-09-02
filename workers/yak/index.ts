// The kernel Worker's entry (D-32318 §The meta-space): everything below the
// app line, in one fetch. A request is routed by hostname and path
// (route.ts), the apex answers with the home page and the doors later leaves
// fill, a space's hostname resolves through the directory (directory.ts) to
// the app that serves it (app.ts) with the session verified and vouched for
// (session.ts). Every route runs inside one catch: a throw becomes an error
// entity in the (space, app) store — or the meta store, when no app answers
// — and a soft page, so no failure goes unseen (D-32318 §Errors, V-32361).
//
// The route table:
//   yaks.app (and any dev host)
//     /                       the home page, from ./public
//     /login, /oauth/*        sign-in: T-32327's, a soft page until then
//     /mcp, /api/*            the connector: T-32329's, a JSON 404 until then
//     anything else           ./public, else a soft 404
//   <space>.yaks.app
//     /                       302 to the space's home app, else "nothing here"
//     /<app>                  302 to /<app>/
//     /<app>/api/graph        the store's identity, plus who is asking
//     /<app>/api/query        the filter grammar over the app's store
//     /<app>/api/apply        a batch into the app's store (a writer)
//     /<app>/api/files/<p>    PUT one file into the app's blob store (a writer)
//     /<app>/<path>           the app's file at that path, a directory's index
import { serveApp } from './app.ts'
import { directory, META } from './directory.ts'
import type { Env } from './env.ts'
import { lost, nothingHere, oops, soon } from './pages.ts'
import { hostOf, type Route, route } from './route.ts'
import { mayWrite, whoIs } from './session.ts'
import { storeOf } from './store.ts'

export { Store } from './store.ts'

let redirect = (to: string) =>
  new Response(null, { status: 302, headers: { location: to } })

let apex = async (req: Request, env: Env, path: string) => {
  if (path == '/login' || path.startsWith('/oauth/')) return soon('Sign-in')
  if (path == '/mcp' || path.startsWith('/api/')) {
    return Response.json({ error: { code: 'not_here_yet' } }, { status: 404 })
  }
  let r = await env.ASSETS.fetch(req)
  return r.status == 404 ? lost() : r
}

let serve = async (req: Request, env: Env, r: Route) => {
  if (r.space == null) return apex(req, env, r.path)
  let dir = directory(env.STORE)
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
  return serveApp(req, env, space, app, r.path, who)
}

// What a request threw, as an entity where the person's agent reads: the
// app's store when the route names an app that exists, the meta store
// otherwise. Awaited, so the entity exists by the time the soft page lands.
let report = async (env: Env, r: Route, req: Request, e: unknown) => {
  let dir = directory(env.STORE)
  let space = r.space ? await dir.space(r.space) : null
  let app = space && r.app ? await dir.app(space, r.app) : null
  let store = app
    ? storeOf(env.STORE, space!.slug, app.slug)
    : storeOf(env.STORE, META.space, META.app)
  await store('/error', {
    method: 'POST',
    body: JSON.stringify({
      method: req.method,
      path: new URL(req.url).pathname,
      message: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack ?? '' : '',
      version: app?.version ?? null,
    }),
  })
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    let r = route(hostOf(req), new URL(req.url).pathname)
    try {
      return await serve(req, env, r)
    } catch (e) {
      // A failure to report is telemetry, never a second failure to serve.
      await report(env, r, req, e).catch((why) =>
        console.error('yak: could not report', why, 'after', e)
      )
      return oops()
    }
  },
}
