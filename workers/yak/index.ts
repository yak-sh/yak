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
// One thing beyond routing happens here, and it is here because nowhere else
// still knows it: a request at a GRAPH DOOR whose `Origin` names another
// address is refused before it is served (route.ts `sameOrigin`). Sibling
// spaces are subdomains of one registrable domain, so they are same-site and
// the session cookie rides along to a door another space's page aims at; the
// browser's own `Origin` is what tells them apart, and after `aimed` rewrites
// a custom domain's address the hostname the browser addressed is gone.
//
// `scheduled` is the second entry point, and the only one no request reaches:
// the hourly meter (usage.ts).
//
// The route table:
//   yaks.app (and any dev host)
//     /                       the home page, from ./public
//     /login, /login/code     identity.ts: the email-code sign-in
//     /connect                identity.ts: the connector page, and the
//                             address a person's apps live at
//     /oauth/*                identity.ts: the OAuth 2.1 door for agents
//     /.well-known/oauth-*    identity.ts: the provider's metadata
//     /mcp, /api/*            mcp.ts (T-32329; a JSON 404 until then)
//     anything else           ./public, else a soft 404
//   <space>.yaks.app          apps.ts:
//     /                       the space's front page — its home app, SERVED
//                             here; "nothing here" if it has none
//     /<app>                  302 to /<app>/, or to / when <app> is the front
//                             page, whose address is the bare hostname
//     /<app>/api/graph        the store's identity, plus who is asking
//     /<app>/api/query        the filter grammar over the app's store
//     /<app>/api/apply        a batch into the app's store (a writer)
//     /<app>/api/files/<p>    PUT one file into the app's blob store (a writer)
//     /<app>/<path>           the app's file at that path, a directory's index
//     anything else           the front page's own file, page or api door at
//                             that path: the space's apps own the first path
//                             segment, the front page answers what is left
//                             (T-33040)
import * as apps from './apps.ts'
import * as dirPart from './directory.ts'
import { directory, META_STORE, storeName } from './directory.ts'
import { bound, type Env } from './env.ts'
import * as identity from './identity.ts'
import * as mcp from './mcp.ts'
import { lost, oops } from './pages.ts'
import {
  doorway,
  foreign,
  hostOf,
  MOUNT,
  PLATFORM,
  type Route,
  route,
  sameOrigin,
} from './route.ts'
import { storeOf } from './store.ts'
import { noted, refusal } from './unseen.ts'
import { metered } from './usage.ts'

export { Store } from './store.ts'
export { Wire } from './stream.ts'

let serve = async (req: Request, env: Env, r: Route) => {
  if (r.space != null) return bound(env.APPS, apps.fetch, env).fetch(req)
  let path = r.path
  if (
    path == '/login' || path.startsWith('/login/') || path == '/connect' ||
    path.startsWith('/oauth/') || path.startsWith('/.well-known/oauth-')
  ) {
    return bound(env.IDENTITY, identity.fetch, env).fetch(req)
  }
  if (path == '/mcp' || path.startsWith('/api/')) {
    return bound(env.MCP, mcp.fetch, env).fetch(req)
  }
  // The one static token OpenAI's apps directory fetches to verify the domain.
  // Not identity.ts's — the oauth well-known is that door's metadata; this is a
  // separate single verification string, served from a secret so the repo
  // carries no token, and 404 when unset.
  if (path == '/.well-known/openai-apps-challenge') {
    return env.OPENAI_APPS_CHALLENGE == null ? lost() : new Response(
      env.OPENAI_APPS_CHALLENGE,
      { headers: { 'content-type': 'text/plain; charset=utf-8' } },
    )
  }
  let page = await env.ASSETS.fetch(req)
  return page.status == 404 ? lost() : page
}

// A hostname someone else owns, aimed at one of our apps (T-33037). Routing
// stays pure and synchronous; this is a DIRECTORY READ, so it happens here,
// where the router already holds env — and only for a hostname that is
// neither ours nor a dev host (route.ts `foreign`). A host the directory has
// never been given answers null and keeps the route it already had, which is
// the apex: every address that exists today is decided before this is asked.
//
// A domain serves ONE app at its ROOT, so the request is carried to that
// app's own address — `herbusiness.com/menu` becomes
// `<space>.yaks.app/<app>/menu` — and every part below routes it from the
// pure route table the way it routes everything else. Serving at the root
// falls out of that: the app's `/` is the domain's `/`, with no redirect into
// a path — and a space's own hostname now works the same way, its home app
// served at `/` rather than redirected to (T-33040, apps.ts `fetch`). The
// browser stays on the person's domain; only the address the PLATFORM
// derives from the request moves, which is what puts a sign-in return on our
// own zone, where the session cookie is (route.ts `onZone`).
//
// The prefix rides along as `x-yak-mount: /`, because the app is at the
// domain's root while the address routed on names its prefix, and the parts
// below have no other way to tell: apps.ts gives the page a `<base href>` at
// the mount, and never forwards the front page's `/<app>/` to `/` here, which
// on a domain would be a loop back to the address that arrived (T-33040).
let aimed = async (req: Request, env: Env, host: string) => {
  if (!foreign(host)) return null
  let at = await directory(bound(env.DIRECTORY, dirPart.fetch, env))
    .serves(host)
  if (!at) return null
  let url = new URL(req.url)
  url.protocol = 'https:'
  url.host = `${at.space.slug}.${PLATFORM}`
  url.pathname = `/${at.app.slug}${url.pathname}`
  let headers = new Headers(req.headers)
  headers.set(MOUNT, '/')
  return new Request(url, new Request(req, { headers }))
}

// A page on somebody else's address, at one of our graph doors (route.ts
// `sameOrigin`, `doorway`). It is refused in the shape every other api
// refusal has (apps.ts `json`) — a code the page's code reads, a sentence its
// person reads — and it is a deliberate no, so nothing is filed about it.
let stranger = () =>
  Response.json({
    error: {
      code: 'foreign_origin',
      message: 'that page is at another address and cannot use this door',
    },
  }, { status: 403 })

// A header only the router writes: whatever a client sent under that name is
// gone before anything reads it.
let unmounted = (req: Request) => {
  if (!req.headers.has(MOUNT)) return req
  let headers = new Headers(req.headers)
  headers.delete(MOUNT)
  return new Request(req, { headers })
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
  // A break in a space's app is also pushed to its members as it lands
  // (unseen.ts, T-33006); one in the platform's own meta store has no space
  // to tell.
  await noted(store, {
    request: `${req.method} ${new URL(req.url).pathname}`,
    version: app?.version,
    message: e instanceof Error ? e.message : String(e),
    stack: e instanceof Error ? e.stack ?? '' : '',
  }, space && app ? { env, space, app } : undefined)
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    let host = hostOf(req)
    let r = route(host, new URL(req.url).pathname)
    try {
      req = unmounted(req)
      // Space isolation, and the one place it holds (route.ts `sameOrigin`).
      // HERE, before `aimed` moves the address, because what must match is
      // what the BROWSER addressed: a page at `herbusiness.com` asking its
      // own `/api/…` is same-origin even though the router is about to carry
      // the request to `<space>.yaks.app/<app>/api/…`.
      if (
        doorway(new URL(req.url).pathname) &&
        !sameOrigin(host, req.headers.get('origin'))
      ) return stranger()
      let at = r.space == null ? await aimed(req, env, host) : null
      if (at) {
        req = at
        r = route(hostOf(at), new URL(at.url).pathname)
      }
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
