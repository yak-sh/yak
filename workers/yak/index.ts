// The kernel Worker's entry (D-32318 §The meta-space): the router, and
// nothing else. Each part of the kernel is a module exporting a plain
// `fetch(req, env)` — identity.ts, mcp.ts, directory.ts, apps.ts — and the
// router composes them by calling those handlers; a part split into its own
// Worker later is a service binding in env.ts and no change here. The Store
// Durable Object (store.ts) is its own module for the same reason: a DO may
// live in a different Worker from the one that binds it, and so is the Wire
// object (stream.ts), which holds a person's open agent stream. Every route
// runs inside one catch: a throw becomes an exception entity in the META
// store — OUR code fell over, whatever app the URL named (T-33234, `report`
// below) — and a soft page, so no failure goes unseen (D-32318 §Errors,
// V-32361). A door's deliberate no is not a failure and files nothing
// (unseen.ts `refusal`).
//
// One thing beyond routing happens here, and it is here because nowhere else
// still knows it: a request at a GRAPH DOOR whose `Origin` names another
// address is refused before it is served (route.ts `sameOrigin`). Sibling
// spaces are subdomains of one registrable domain, so they are same-site and
// the session cookie rides along to a door another space's page aims at; the
// browser's own `Origin` is what tells them apart, and after `aimed` rewrites
// a custom domain's address the hostname the browser addressed is gone.
//
// One door answers a stranger's page anyway (route.ts `shared`, T-33408): an
// app's READ door, asked with GET. The cookie is taken off the request before
// it is served and the answer is marked readable by any origin, so anybody's
// page may read a public app the way anybody's curl already can — the apex's
// own front page is a client of exactly that door and gets nothing extra.
//
// `scheduled` is the second entry point, and the only one no request reaches:
// the hourly meter (usage.ts).
//
// The route table. Above every line of it sits what the PLATFORM owns
// (route.ts `platform`): the whole `/.well-known/` prefix on our own
// hostnames, because that is where a site grants authority over its own name
// and `<space>.yaks.app` is OUR name, not the space's. A customer's own
// domain is their name, so there the prefix is the app's, all of it:
//   yaks.app (and any dev host)
//     /                       the home page, from ./public
//     /login, /login/code     identity.ts: the email-code sign-in
//     /connect                identity.ts: the connector page, and the
//                             address a person's apps live at
//     /oauth/*                identity.ts: the OAuth 2.1 door for agents
//     /.well-known/oauth-*    identity.ts: the provider's metadata
//     /api/stripe/webhook     billing.ts: what Stripe says happened
//     /api/billing/*          billing.ts: checkout and the customer portal
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
import { WorkerEntrypoint } from 'cloudflare:workers'
import * as apps from './apps.ts'
import { sealed } from './cache.ts'
import * as filePart from './files.ts'
import * as billing from './billing.ts'
import * as dirPart from './directory.ts'
import { directory, META_STORE } from './directory.ts'
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
  platform,
  type Route,
  route,
  sameOrigin,
  shared,
} from './route.ts'
import { storeOf } from './store.ts'
import { noted, refusal } from './unseen.ts'
import { metered } from './usage.ts'

export { Store } from './store.ts'
export { Wire } from './stream.ts'

// The kernel's SECOND entrypoint, and the only one with a cache in front of it
// (cache.ts, wrangler.toml `[exports.Files]`). The default entrypoint below is
// the gateway: it runs on every request, because the cache key does not
// include the hostname and every space is a hostname — caching there would
// serve one space's bytes to another's visitors. This one is addressed by the
// app's eid and answers bytes, so it is safe to share and worth caching.
//
// It is reached only through the `FILES` service binding (env.ts). The routes
// in wrangler.toml name the default entrypoint, so nothing from the internet
// arrives here.
export class Files extends WorkerEntrypoint {
  // The runtime sets this; `declare` names its type without emitting a field
  // that would shadow what the base class already put there. env.ts keeps the
  // Cloudflare types out of this Worker, so the base's own generic is not
  // resolved here.
  declare env: Env

  fetch(req: Request): Promise<Response> {
    return filePart.fetch(req, this.env)
  }
}

let serve = async (req: Request, env: Env, r: Route) => {
  if (r.space != null) return bound(env.APPS, apps.fetch, env).fetch(req)
  let path = r.path
  if (
    path == '/login' || path.startsWith('/login/') || path == '/connect' ||
    // Closing a space (identity.ts `closing`, T-33166): a signed-in page and
    // its form, so it belongs with the rest of the cookie's surface rather
    // than at the connector door an agent speaks to.
    path.startsWith('/space/') ||
    path.startsWith('/oauth/') || path.startsWith('/.well-known/oauth-')
  ) {
    return bound(env.IDENTITY, identity.fetch, env).fetch(req)
  }
  // Money, before the connector: `/api/*` at the apex is otherwise all
  // mcp.ts's, and Stripe's webhook posts to `/api/stripe/webhook`, which
  // would have reached a door that answers a JSON 404 to everything but
  // `/mcp`. The checkout and portal doors sit under the same prefix because
  // they are the same part (billing.ts) and are reachable only from a
  // signed-in page — never from a tool answer (C-33033).
  if (path.startsWith('/api/stripe/') || path.startsWith('/api/billing/')) {
    return bound(env.BILLING, billing.fetch, env).fetch(req)
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

// The same door, opened to any page in the world by taking the credentials
// off it first (route.ts `shared`, T-33408). Both halves are here because
// neither is safe alone: an answer marked readable by any origin must be an
// answer no session was used to compute.
//
// The cookie is the whole of the ambient credential an app's door reads
// (session.ts `whoIs`) — `x-yak-person` and `x-yak-role` are written by the
// kernel on internal requests and never trusted from outside — so dropping it
// makes the request anonymous rather than merely expected-anonymous.
// `authorization` goes with it: the app doors do not read one today, and the
// day something does, it must not arrive through this one.
let uncredentialed = (req: Request) => {
  let headers = new Headers(req.headers)
  headers.delete('cookie')
  headers.delete('authorization')
  return new Request(req, { headers })
}

// The mark on the answer. The WILDCARD, never the asking origin, and no
// `Access-Control-Allow-Credentials`: a browser refuses to send a credentialed
// request to `*`, so the pair is a promise the browser itself enforces, and
// echoing the origin back would let a future mistake add credentials to it.
//
// `Vary: Origin` because the same URL answers differently to the page that
// owns it — same-origin, this is not called, and the answer is that person's.
// The Workers cache is not in front of this entrypoint and must not be
// (wrangler.toml, cache.ts): its key holds the path and not the hostname, so
// `alice.yaks.app/recipes/api/query?x` and bob's are one entry. The answer is
// public but it is not shareable BY US, which is why `sealed` still marks it
// `private, no-store` and nothing here asks for more.
let cors = (res: Response) => {
  if (res.status == 101) return res
  let headers = new Headers(res.headers)
  headers.set('access-control-allow-origin', '*')
  headers.append('vary', 'origin')
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}

// A header only the router writes: whatever a client sent under that name is
// gone before anything reads it.
let unmounted = (req: Request) => {
  if (!req.headers.has(MOUNT)) return req
  let headers = new Headers(req.headers)
  headers.delete(MOUNT)
  return new Request(req, { headers })
}

// What OUR code threw, as an entity where WE read it: the meta store, always
// (T-33234). Awaited, so the entity exists by the time the soft page lands.
//
// Nothing that reaches this catch was the app's code running. An app's code
// runs at exactly one seam — `worker.fetch` in dispatch.ts `ran` — and files
// its own breaks there; a page's break comes in through its own door (apps.ts
// `/report`). Everything left is routing, the directory, a store object, the
// bucket: ours. The route may name an app, and that is all the app has to do
// with it.
//
// It used to file by ROUTE, which made a platform failure the named app's:
// evicting a Store object on one of OUR deploys throws into whatever socket
// was open, and `GET /<app>/api/ws` then wrote a regression that never
// happened into a customer's store, stamped with their version, charged to
// their metered writes, and pushed to every member of their space — at our
// deploy rate rather than their usage. Jeff, 2026-09-03: "That's not just
// noise; it's a bug".
//
// So the line carries the HOST, which is what names the space and the app the
// request was on its way to, and no version: the code that broke is ours, and
// the meta store has no version to name.
let report = async (env: Env, what: string, e: unknown) => {
  // The BREAK, something our code hit unexpectedly — the self-healing
  // trigger (kernel.rs; `error` is a known failure state, kept for what the
  // platform reports deliberately). unseen.ts owns the entity's shape,
  // because a page reporting its own break writes the same one. No space is
  // told: the meta store is the platform's own, and this is nobody's news but
  // ours.
  await noted(storeOf(env.STORE, META_STORE), {
    request: what,
    message: e instanceof Error ? e.message : String(e),
    stack: e instanceof Error ? e.stack ?? '' : '',
  })
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    let host = hostOf(req)
    let r = route(host, new URL(req.url).pathname)
    try {
      req = unmounted(req)
      // What the platform owns rather than an app (route.ts `platform`),
      // decided from the hostname the request arrived at: `/.well-known/` on
      // our own hostnames, where an app would otherwise grant authority over
      // a name that is ours. A customer's own domain is never in here — the
      // name is theirs, so the grant is theirs to make.
      //
      // At the apex the platform answers: `serve` hands the oauth metadata to
      // identity.ts and the apps-directory token to its own line, and
      // everything else under the prefix is a soft 404, since nothing else
      // there is ours to publish. On a space's hostname the platform owns the
      // address and has nothing to say at it — an app must not get it.
      let asked = new URL(req.url).pathname
      if (platform(host, asked)) {
        return sealed(
          r.space != null
            ? lost()
            : await serve(req, env, { space: null, app: null, path: asked }),
        )
      }
      // Space isolation, and the one place it holds (route.ts `sameOrigin`).
      // HERE, before `aimed` moves the address, because what must match is
      // what the BROWSER addressed: a page at `herbusiness.com` asking its
      // own `/api/…` is same-origin even though the router is about to carry
      // the request to `<space>.yaks.app/<app>/api/…`.
      //
      // One door is open to every page anyway, and this is where it opens:
      // the app's read door, asked with GET, served with the credentials
      // stripped off and marked readable by any origin (route.ts `shared`).
      let anyone = false
      if (
        doorway(asked) &&
        !sameOrigin(host, req.headers.get('origin'))
      ) {
        if (!shared(req.method, asked)) return stranger()
        req = uncredentialed(req)
        anyone = true
      }
      let at = r.space == null ? await aimed(req, env, host) : null
      if (at) {
        req = at
        r = route(hostOf(at), new URL(at.url).pathname)
      }
      let answer = await serve(req, env, r)
      return sealed(anyone ? cors(answer) : answer)
    } catch (e) {
      // A refusal is not a break (unseen.ts `refusal`, T-32655). A part that
      // relays a door's deliberate no by throwing what it was answered is
      // carrying an ANSWER out, not a failure, and the same rule holds here
      // as at the report door: it files nothing.
      let said = e instanceof Error ? e.message : String(e)
      if (refusal(said)) return oops()
      // The host the router ROUTED by, not the one the socket arrived on: it
      // is what names the space and the app this was on its way to, and after
      // `aimed` it is the address the platform derived rather than the
      // customer's own domain.
      let where = `${hostOf(req)}${new URL(req.url).pathname}`
      // A failure to report is telemetry, never a second failure to serve.
      await report(env, `${req.method} ${where}`, e).catch((why) =>
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
      await report(env, 'cron meter', e).catch((why) =>
        console.error('yak: could not report', why, 'after', e)
      )
    }
  },
}
