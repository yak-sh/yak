// The kernel Worker's entry (D-32318 §The meta-space): the router, and
// nothing else. Each part of the kernel is a module exporting a plain
// `fetch(req, env)` — identity.ts, mcp.ts, directory.ts, apps.ts — and the
// router composes them by calling those handlers; a part split into its own
// Worker later is a service binding in env.ts and no change here. The Store
// Durable Object (store.ts) is its own module for the same reason: a DO may
// live in a different Worker from the one that binds it. Every route runs
// inside one catch: a throw becomes an exception entity in the (space, app)
// store — or the meta store, when no app answers — and a soft page, so no
// failure goes unseen (D-32318 §Errors, V-32361).
//
// The route table:
//   yaks.app (and any dev host)
//     /                       the home page, from ./public
//     /login, /login/code     identity.ts: the email-code sign-in
//     /oauth/*                identity.ts: the OAuth 2.1 door for agents
//     /.well-known/oauth-*    identity.ts: the provider's metadata
//     /mcp, /api/*            mcp.ts (T-32329; a JSON 404 until then)
//     anything else           ./public, else a soft 404
//   <space>.yaks.app          apps.ts:
//     /                       302 to the space's home app, else "nothing here"
//     /<app>                  302 to /<app>/
//     /<app>/api/graph        the store's identity, plus who is asking
//     /<app>/api/query        the filter grammar over the app's store
//     /<app>/api/apply        a batch into the app's store (a writer)
//     /<app>/api/files/<p>    PUT one file into the app's blob store (a writer)
//     /<app>/<path>           the app's file at that path, a directory's index
import * as apps from './apps.ts'
import * as dirPart from './directory.ts'
import { directory, META } from './directory.ts'
import { bound, type Env } from './env.ts'
import * as identity from './identity.ts'
import * as mcp from './mcp.ts'
import { lost, oops } from './pages.ts'
import { hostOf, type Route, route } from './route.ts'
import { storeOf } from './store.ts'

export { Store } from './store.ts'

let serve = async (req: Request, env: Env, r: Route) => {
  if (r.space != null) return bound(env.APPS, apps.fetch, env).fetch(req)
  let path = r.path
  if (
    path == '/login' || path.startsWith('/login/') ||
    path.startsWith('/oauth/') || path.startsWith('/.well-known/oauth-')
  ) {
    return bound(env.IDENTITY, identity.fetch, env).fetch(req)
  }
  if (path == '/mcp' || path.startsWith('/api/')) {
    return bound(env.MCP, mcp.fetch, env).fetch(req)
  }
  let page = await env.ASSETS.fetch(req)
  return page.status == 404 ? lost() : page
}

// What a request threw, as an entity where the person's agent reads: the
// app's store when the route names an app that exists, the meta store
// otherwise. Awaited, so the entity exists by the time the soft page lands.
let report = async (env: Env, r: Route, req: Request, e: unknown) => {
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env))
  let space = r.space ? await dir.space(r.space) : null
  let app = space && r.app ? await dir.app(space, r.app) : null
  let store = app
    ? storeOf(env.STORE, space!.slug, app.slug)
    : storeOf(env.STORE, META.space, META.app)
  // One entity: a doc naming the request and the deploy it happened on, and
  // the `exception` facet — the BREAK, something our code hit unexpectedly,
  // the self-healing trigger (kernel.rs; `error` is a known failure state,
  // kept for what the platform reports deliberately) — carrying the message
  // and stack. Server-owned, so it rides the kernel flag into apply()'s
  // server-writer mode; the shape is the wire's own entity literal.
  let sent = await store('/apply', {
    method: 'POST',
    body: JSON.stringify({
      entities: [{
        doc: {
          title: `${req.method} ${new URL(req.url).pathname}`,
          body: `version: ${app?.version ?? 'none'}`,
        },
        exception: {
          at: new Date().toISOString(),
          message: e instanceof Error ? e.message : String(e),
          stack: e instanceof Error ? e.stack ?? '' : '',
        },
      }],
    }),
  }, { 'x-yak-kernel': '1' })
  if (!sent.ok) throw new Error(`report refused: ${await sent.text()}`)
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
