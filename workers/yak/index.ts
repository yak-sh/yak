// The kernel Worker's entry (D-32318 §The meta-space): the router, and
// nothing else. Each part of the kernel is a module exporting a plain
// `fetch(req, env)` — identity.ts, mcp.ts, directory.ts, apps.ts — and the
// router composes them by calling those handlers; a part split into its own
// Worker later is a service binding in env.ts and no change here. The Store
// Durable Object (store.ts) is its own module for the same reason: a DO may
// live in a different Worker from the one that binds it, and so is the Wire
// object (stream.ts), which holds a person's open agent stream. Every route runs
// inside one catch: a throw becomes an exception entity in the (space, app)
// store — or the meta store, when no app answers — and a soft page, so no
// failure goes unseen (D-32318 §Errors, V-32361). A door's deliberate no is
// not a failure and files nothing (unseen.ts `refusal`).
//
// `scheduled` is the second entry point, and the only one no request reaches:
// the hourly meter (usage.ts).
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
import { directory, META_STORE, storeName } from './directory.ts'
import { bound, type Env } from './env.ts'
import * as identity from './identity.ts'
import * as mcp from './mcp.ts'
import { lost, oops } from './pages.ts'
import { hostOf, type Route, route } from './route.ts'
import { storeOf } from './store.ts'
import { noted, refusal } from './unseen.ts'
import { metered } from './usage.ts'

export { Store } from './store.ts'
export { Wire } from './stream.ts'

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
  // Read past the directory's cache: a break right after a deploy is the
  // common one, and it must name the version it broke on rather than the one
  // this isolate is still holding (directory.ts `FRESH`, C-32869 item 4).
  let app = space && r.app ? await dir.app(space, r.app, true) : null
  let store = storeOf(
    env.STORE,
    app ? storeName(space!, app) : META_STORE,
  )
  // The BREAK, something our code hit unexpectedly — the self-healing
  // trigger (kernel.rs; `error` is a known failure state, kept for what the
  // platform reports deliberately). unseen.ts owns the entity's shape,
  // because a page reporting its own break writes the same one.
  await noted(store, {
    request: `${req.method} ${new URL(req.url).pathname}`,
    version: app?.version,
    message: e instanceof Error ? e.message : String(e),
    stack: e instanceof Error ? e.stack ?? '' : '',
  })
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    let r = route(hostOf(req), new URL(req.url).pathname)
    try {
      return await serve(req, env, r)
    } catch (e) {
      // A refusal is not a break (unseen.ts `refusal`, T-32655). A part that
      // relays a door's deliberate no by throwing what it was answered is
      // carrying an ANSWER out, not a failure, and the same rule holds here
      // as at the report door: it files nothing.
      let said = e instanceof Error ? e.message : String(e)
      if (refusal(said)) return oops()
      // A failure to report is telemetry, never a second failure to serve.
      await report(env, r, req, e).catch((why) =>
        console.error('yak: could not report', why, 'after', e)
      )
      return oops()
    }
  },

  // The hour striking (wrangler.toml `[triggers] crons`): the meter reads
  // what every app and space spent this month (usage.ts). A sweep that falls
  // over is written where every other break is — the meta store — rather than
  // lost on a log nobody opens.
  async scheduled(_event: unknown, env: Env): Promise<void> {
    try {
      await metered(env)
    } catch (e) {
      await noted(storeOf(env.STORE, META_STORE), {
        request: 'cron meter',
        message: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack ?? '' : '',
      }).catch((why) => console.error('yak: could not report', why, 'after', e))
    }
  },
}
