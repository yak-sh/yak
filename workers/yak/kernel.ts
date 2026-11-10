// The kernel's router (D-32318 §The meta-space): where a request goes, and
// nothing else. Each part of the kernel is a module exporting a plain
// `fetch(req, env)` — identity.ts, mcp.ts, directory.ts, apps.ts — and the
// router composes them by calling those handlers; a part split into its own
// Worker later is a service binding in env.ts and no change here. Every route
// runs inside one catch: a throw reaches the platform tracker — our code
// fell over, whatever app the URL named
// (T-33234, unseen.ts `fault`) — and a soft page, so no failure goes unseen
// (D-32318 §Errors, V-32361). A door's deliberate no is not a failure and
// files nothing; it is logged and returned with its 4xx, in JSON at the
// connector and API doors and as a page elsewhere (unseen.ts `refusal`).
//
// It imports nothing only the runtime can load, so a test serves it under
// Deno over the in-memory platform (probe.ts `kernel`) exactly as index.ts
// hands it to the runtime.
//
// One thing beyond routing happens here, and it is here because nowhere else
// still knows it: a write, or a request at a graph door, whose `Origin` names
// another address is refused before it is served (route.ts `guarded`,
// `sameOrigin`). Sibling
// spaces are subdomains of one registrable domain, so they are same-site and
// the session cookie rides along to a door another space's page aims at; the
// browser's own `Origin` is what tells them apart, and after `aimed` rewrites
// a custom domain's address the hostname the browser addressed is gone.
//
// One door answers a stranger's page anyway (route.ts `shared`, T-33408): an
// app's read door, asked with GET. The cookie is taken off the request before
// it is served and the answer is marked readable by any origin, so anybody's
// page may read a public app the way anybody's curl already can — the apex's
// own front page is a client of exactly that door and gets nothing extra.
//
// There is no heartbeat: every store owes its own wakes and arms its own
// Durable Object alarm for them (graph.ts, D-37562).
//
// The route table. Above every line of it sits what the platform owns
// (route.ts `platform`): the whole `/.well-known/` prefix on our own
// hostnames, because that is where a site grants authority over its own name
// and `<space>.yaks.app` is our name, not the space's. A customer's own
// domain is their name, so there the prefix is the app's, all of it:
//   yaks.app (and any dev host)
//     /                       the home page, from ./public
//     /login, /login/code     identity.ts: the email-code sign-in
//     /manage, /manage/*      apps.ts: the dashboard, one space's at a time
//     /admin, /admin/*        admin.ts: the directory, for the platform admin
//     /invite                identity.ts: an invitation's one click (invite.ts)
//     /support/<thread>       support-page.ts: a support thread, signed in
//     /tv, /tv/*              screen.ts: a TV paired by a code, and the
//                             phone's page that pairs and unpairs it
//     /connect                identity.ts: the connector page, signed in, and
//                             the address a person's apps live at
//     /oauth/*                identity.ts: the OAuth 2.1 door for agents
//     /.well-known/oauth-*    identity.ts: the provider's metadata
//     /api/billing/*          billing.ts: checkout and the customer portal
//     /<via>/<door>           payment-doors.ts: what the payment provider
//                             config.ts `payments` lends as `via` heard at
//                             each door it lends (/stripe/webhook,
//                             /stripe/connect)
//     /<via>/webhook          operator-texts.ts: texts and calls to the
//                             Operator, for each phone phones.ts lends
//     /<via>/stream           operator-calls.ts: a call's audio
//     /mcp, /api/*            mcp.ts (T-32329; a JSON 404 until then)
//     /robots.txt, /sitemap.xml, /llms.txt, /llms-full.txt,
//     /.well-known/security.txt
//                             seo.ts: the site said as a list, generated —
//                             answered directly by this router
//     anything else           ./public, else a soft 404
//   <space>.yaks.app          apps.ts, Git and connection hooks ahead of it, and
//                             one door of its own:
//     /_yaks/hooks/*          connections.ts: a service's webhooks
//     /_yaks, /_yaks/*        apps.ts: the dashboard's old addresses, moved
//                             to the apex
//     POST /deploy            drop.ts: a zip of files, or one index.html,
//                             dropped on the space's page — an app made or
//                             updated, by the member who dropped it
//     /                       the space's front page — its home app, served
//                             here; "nothing here" if it has none
//     /api/build              build.ts: the socket the builder talks on, the
//                             space's own and ahead of every app
//     /<app>                  302 to /<app>/, or to / when <app> is the front
//                             page, whose address is the bare hostname
//     /<app>/api/graph        the store's identity and who is asking, to a reader
//     /<app>/api/query        the filter grammar over the app's store
//     /<app>/api/vocab.json   every word the app's store speaks, as documents
//     /<app>/api/apply        a batch into the app's store (a writer)
//     /<app>/api/files/<p>    PUT one file into the app's blob store (a writer)
//     /<app>/<path>           the app's file at that path, a directory's index
//     anything else           the front page's own file, page or api door at
//                             that path: the space's apps own the first path
//                             segment, the front page answers what is left
import { origin } from '@yaks/tracker/report'
import { caught, within } from './defects.ts'
import { CallError, refused as toolRefusal } from '@yaks/tools/errors'
import { Stale } from '@yaks/graph/errors'
import { waits } from '@yaks/api/refuse'
import * as apps from './apps.ts'
import { sealed } from './cache.ts'
import * as dirPart from './directory.ts'
import { directory } from './directory.ts'
import { customOf, reading, refresh, type Step } from './domains.ts'
import { identity } from './doors.ts'
import { bound, type Env, type Inbound } from './env.ts'
import { HANDOFF } from './handoff.ts'
import { apex } from './host.ts'
import { lost, oops, provisioning } from './pages.ts'
import { hook } from './connections.ts'
import {
  ADDRESS,
  aimedAt,
  askable,
  foreign,
  guarded,
  hostOf,
  MOUNT,
  paged,
  platform,
  type Route,
  route,
  sameOrigin,
  shared,
} from './route.ts'
import { slid } from './session.ts'
import { fault, refusal } from './unseen.ts'

// Every answer at the apex leaves through `seen`, so whichever page a link
// lands a person on keeps its arrival and tells its view: /login and the
// docs as well as the cached listings.
let serve = async (req: Request, env: Env, r: Route) =>
  r.space == null
    ? (await import('./apex.ts')).answer(req, env, r.path)
    : atSpace(req, env, r.space)

// A space's hostname: its previews, its drops, its hooks and its apps.
let atSpace = async (req: Request, env: Env, space: string) => {
  let asked = new URL(req.url).pathname
  if (/^\/[^/]+\/_preview(?:\/|$)/.test(asked)) {
    return (await import('./preview.ts')).fetch(req, env)
  }
  // The one path on a space's hostname the kernel answers itself (drop.ts,
  // T-34230): a file dropped on the space's own page, which becomes an app.
  // POST only, so an app whose slug happens to be `deploy` still serves its
  // own pages at the same address.
  if (req.method == 'POST' && asked == '/deploy') {
    return (await import('./drop.ts')).fetch(req, env)
  }
  // Git and connection hooks belong to the space's hostname, ahead of
  // its apps and the home app's catch-all worker.
  let arrived = { env, req, path: asked, space }
  let mine = await (await import('./git_door.ts')).answer(arrived) ??
    await hook(arrived)
  if (mine) return mine
  return bound(env.APPS, apps.fetch, env).fetch(req)
}

// A foreign host that has reached the Worker (route.ts origin, T-33036) but
// has nothing ready to answer with: a domain mid-provisioning, or one
// Cloudflare has stopped serving. `aimed` below is what routes an active
// host to its app; this is what stands in front of it, because `aimed`
// cannot tell a host that is not there yet apart from one it has simply
// never heard of — both answer null, and both used to fall through to the
// apex home page, which is the wrong thing on a stranger's domain.
//
// The directory's cached `stage` (stamped by domain_attach and domain_status,
// directory.ts `Host`) answers `active` for free, so a live domain pays no
// Cloudflare call on every request. Anything else asks Cloudflare directly
// for provisioning and checks ownership (domains.ts `refresh`), because
// the cached `stage` is one word and the page wants to say which of DNS,
// ownership, validation or certificate is still pending — the same reading
// `domain_status` gives an agent, handed to the visitor instead. A platform
// not configured to ask Cloudflare (`reachable`, domains.ts) falls back to a
// plain "still connecting" line rather than a 500 for every visitor of every
// domain being set up; that is the one case this catches rather than lets
// through, and it is a config gap, not a domain's own state.
let settling = async (env: Env, host: string): Promise<Response | null> => {
  if (!foreign(host, env)) return null
  let served = await directory(bound(env.DIRECTORY, dirPart.fetch, env))
    .serves(host)
  if (
    served?.host.stage == 'active' &&
    (served.host.verified || served.host.verification == null)
  ) return null
  let how: Step[] | null = null
  let stage: 'pending' | 'active' | 'error' = served?.host.stage == 'error'
    ? 'error'
    : 'pending'
  try {
    let custom = await customOf(env, host)
    if (served) ({ how, stage } = await refresh(env, served.host, custom))
  } catch (e) {
    // No CF_ZONE/CF_HOSTNAMES_TOKEN, or Cloudflare itself unreachable: the
    // cached stage above (or `pending`, where there is none at all) still
    // says something true, just without the per-step detail.
    if (!(e instanceof Stale)) caught(e, { request: 'domain settling' })
  }
  return stage == 'active' ? null : provisioning(
    host,
    how ? reading(how) : 'Still being connected — check back shortly.',
    stage,
    env,
  )
}

// A hostname someone else owns, aimed at a place of ours (T-33037, T-34596).
// Routing stays pure and synchronous; this is a directory read, so it happens
// here, where the router already holds env — and only for a hostname that is
// neither ours nor a dev host (route.ts `foreign`). A host the directory has
// never been given answers null and keeps the route it already had, which is
// the apex: every address that exists today is decided before this is asked.
//
// The request is carried to the address that place already has on our own zone
// (route.ts `aimedAt`, which is the whole of the space/app difference), and
// every part below routes it from the pure route table the way it routes
// everything else — so a domain on a space is served by the same rungs as
// `<space>.yaks.app` rather than by a second copy of them. The browser stays on
// the person's domain; only the address the platform derives from the request
// moves, which is what puts a sign-in return on our own zone, where the session
// cookie is (route.ts `onZone`).
//
// An app's mount rides along as `x-yak-mount: /`, because that app is at the
// domain's root while the address routed on names its prefix, and the parts
// below have no other way to tell: apps.ts gives the page a `<base href>` at
// the mount, and never forwards the front page's `/<app>/` to `/` here, which
// on a domain would be a loop back to the address that arrived (T-33040). A
// domain on a space sends no mount: nothing moved, so its apps are mounted
// where their addresses say they are.
let aimed = async (req: Request, env: Env, host: string) => {
  if (!foreign(host, env)) return null
  let at = await directory(bound(env.DIRECTORY, dirPart.fetch, env))
    .serves(host)
  if (!at) return null
  let url = new URL(req.url)
  let address = new URL(req.url)
  address.host = host
  address.port = ''
  address.protocol = 'https:'
  let to = aimedAt(at.space.slug, at.app?.slug ?? null, url.pathname, env)
  url.protocol = 'https:'
  url.host = to.host
  url.pathname = to.pathname
  let headers = new Headers(req.headers)
  headers.set(ADDRESS, address.href)
  if (to.mount) headers.set(MOUNT, to.mount)
  return new Request(url, new Request(req, { headers }))
}

// A page on somebody else's address, writing or at one of our graph doors
// (route.ts `sameOrigin`, `guarded`). It is refused in the shape every other api
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

// The mark on the answer. The wildcard, never the asking origin, and no
// `Access-Control-Allow-Credentials`: a browser refuses to send a credentialed
// request to `*`, so the pair is a promise the browser itself enforces, and
// echoing the origin back would let a future mistake add credentials to it.
//
// `Vary: Origin` because the same URL answers differently to the page that
// owns it — same-origin, this is not called, and the answer is that person's.
// The Workers cache is not in front of this entrypoint and must not be
// (wrangler.toml, cache.ts): its key holds the path and not the hostname, so
// `alice.yaks.app/recipes/api/query?x` and bob's are one entry. The answer is
// public but it is not shareable by US, which is why `sealed` still marks it
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

// A sandboxed page's own request (route.ts `paged`, installed.ts): the
// cookie off, since the token in the path is the whole of what it may carry.
let uncookied = (req: Request) => {
  let headers = new Headers(req.headers)
  headers.delete('cookie')
  return new Request(req, { headers })
}

// And the question a browser asks before a sandboxed page's JSON write or
// its upload: yes, from anywhere, with the headers it named. No credentials
// are allowed and none are read, so there is nothing an origin could add.
let preflight = (req: Request) =>
  new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, HEAD, POST, PUT, DELETE',
      'access-control-allow-headers':
        req.headers.get('access-control-request-headers') ?? '',
      'access-control-max-age': '86400',
    },
  })

// A header only the router writes: whatever a client sent under that name is
// gone before anything reads it.
let unmounted = (req: Request) => {
  if (!req.headers.has(MOUNT) && !req.headers.has(ADDRESS)) return req
  let headers = new Headers(req.headers)
  headers.delete(MOUNT)
  headers.delete(ADDRESS)
  return new Request(req, { headers })
}

// What our code threw, recorded where we read it: the platform tracker, always
// (T-33234). Invocation retention queues the failure before the soft page
// lands; the independent tracker drains that queue.
//
// Nothing that reaches this catch was the app's code running. An app's code
// runs at exactly one seam — `worker.fetch` in dispatch.ts `ran` — and files
// its own breaks there; a page's break comes in through its own door (apps.ts
// `/report`). Everything left is routing, the directory, a store object, the
// bucket: ours. The route may name an app, and that is all the app has to do
// with it.
//
// It used to file by route, which made a platform failure the named app's:
// evicting a Store object on one of our deploys throws into whatever socket
// was open, and `GET /<app>/api/ws` then wrote a regression that never
// happened into a customer's store, stamped with their version, charged to
// their metered writes, and pushed to every member of their space — at our
// deploy rate rather than their usage. Jeff, 2026-09-03: "That's not just
// noise; it's a bug".
//
// So the line carries the host, which is what names the space and the app the
// request was on its way to, and no app version: the code that broke is ours.
// The platform tracker receives it, tagged with the space and app the route
// named (unseen.ts `fault`), and no member stream is told about our failure.

// The slice of a handler's context the letter door needs (see the default
// export below).
export type Lent = { waitUntil: (work: Promise<unknown>) => void }

// One page, one address: a doubled slash (`/printbound//refund`, from a typed
// link or a crawler's join) names the page its single slash names. Collapsed
// before anything routes on it, no part below and no app's code ever reads a
// path that starts `//`, which `new URL` takes for a host and throws on
// (T-153266, T-153429).
let collapsed = (req: Request) => {
  let url = new URL(req.url)
  let path = url.pathname.replace(/\/{2,}/g, '/')
  if (path == url.pathname) return req
  url.pathname = path
  return new Request(url, req)
}

let router = {
  async fetch(req: Request, env: Env): Promise<Response> {
    req = collapsed(req)
    let host = hostOf(req, env)
    let r = route(host, new URL(req.url).pathname, env)
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
      if (platform(host, asked, env)) {
        return sealed(
          r.space != null
            ? lost(env)
            : await serve(req, env, { space: null, app: null, path: asked }),
          env,
        )
      }
      // Custom-domain sign-in lands here (identity.ts `handoff`): the one
      // identity door a customer's own hostname answers, caught before `aimed`
      // carries the request off to the app, so this hostname sets its own
      // host-only session cookie rather than the app store answering a sign-in
      // path. It is a foreign host by construction — a space's `.yaks.app`
      // hostname already carries the platform cookie and never needs it.
      if (foreign(host, env) && asked == HANDOFF) {
        return sealed(
          await bound(env.IDENTITY, identity, env).fetch(req),
          env,
        )
      }
      // A domain mid-provisioning, or one Cloudflare has stopped serving
      // (`settling` above): answered before space isolation and `aimed`,
      // because there is nothing yet to isolate or route to — every path on
      // a host like this gets the same branded page, not just `/`.
      let hold = await settling(env, host)
      if (hold) return sealed(hold, env)
      // Space isolation, and the one place it holds (route.ts `sameOrigin`).
      // Here, before `aimed` moves the address, because what must match is
      // what the browser addressed: a page at `herbusiness.com` asking its
      // own `/api/…` is same-origin even though the router is about to carry
      // the request to `<space>.yaks.app/<app>/api/…`.
      //
      // One door is open to every page anyway, and this is where it opens:
      // the app's read door, asked with GET, served with the credentials
      // stripped off and marked readable by any origin (route.ts `shared`).
      // So is asking for a sign-in code, to the pages of ours that ask for
      // one (route.ts `askable`).
      //
      // And a sandboxed app's page, on the path that carries its token: its
      // origin is opaque, so it is a stranger to every page, and its request
      // is served with no cookie at all (route.ts `paged`).
      let anyone = false
      if (paged(asked)) {
        if (req.method == 'OPTIONS') return sealed(preflight(req), env)
        req = uncookied(req)
        anyone = true
      } else if (
        guarded(req.method, asked) &&
        !sameOrigin(host, req.headers.get('origin'), env)
      ) {
        if (
          !shared(req.method, asked) &&
          !askable(req.method, asked, req.headers.get('origin'))
        ) return stranger()
        req = uncredentialed(req)
        anyone = true
      }
      let at = r.space == null ? await aimed(req, env, host) : null
      if (at) {
        req = at
        r = route(hostOf(at, env), new URL(at.url).pathname, env)
      }
      let answer = await serve(req, env, r)
      return sealed(anyone ? cors(answer) : answer, env)
    } catch (e) {
      // A refusal is not a break (unseen.ts `refusal`, T-32655). A part that
      // relays a door's deliberate no by throwing what it was answered is
      // carrying an answer out, not a failure: it files nothing. Log one
      // line for the tail, and preserve its body and 4xx at JSON doors.
      // Typed tool refusals use the tools package's JSON and HTTP status.
      // A shaped refusal without a status is a bad request (400). Pages
      // keep a page, with the refusal's status.
      let said = e instanceof Error ? e.message : String(e)
      let carried = e as { status?: number; body?: string } | null
      let tool = e instanceof CallError ? toolRefusal(e) : null
      let body = tool
        ? await tool.text()
        : typeof carried?.body == 'string'
        ? carried.body
        : said
      let status = tool?.status ?? carried?.status
      if (refusal(body, status)) {
        status ??= 400
        let path = new URL(req.url).pathname
        console.log(
          `yak: ${req.method} ${hostOf(req, env)}${path} refused ${status}: ${
            JSON.stringify(body)
          }`,
        )
        if (path == '/mcp' || /^(?:\/[^/]+)?\/api\//.test(path)) {
          let answer: unknown
          try {
            answer = JSON.parse(body)
          } catch {
            answer = { error: { code: 'refused', message: said } }
          }
          let wait = waits(e)
          return sealed(
            Response.json(answer, {
              status,
              headers: wait == null ? {} : { 'retry-after': String(wait) },
            }),
            env,
          )
        }
        let page = oops(env)
        return sealed(
          new Response(page.body, {
            status,
            headers: page.headers,
          }),
          env,
        )
      }
      // The host the router routed by, not the one the socket arrived on: it
      // is what names the space and the app this was on its way to, and after
      // `aimed` it is the address the platform derived rather than the
      // customer's own domain.
      let where = `${hostOf(req, env)}${new URL(req.url).pathname}`
      let requestId = crypto.randomUUID()
      console.log(
        `yak: ${req.method} ${where} failed ${requestId}: ${
          JSON.stringify(said)
        }`,
      )
      await fault(env, `${req.method} ${where}`, e, {
        space: r.space,
        app: r.app,
      }, requestId)
      return oops(env, requestId)
    }
  },

  // The third entry point, and the one no URL names: a letter (T-33684,
  // T-33687). Email Routing's catch-all on the yaks.app zone points every
  // address the specific rules did not claim at this Worker, and inbox.ts
  // files it in the store its local part named.
  //
  // Three outcomes, and they are not interchangeable. A letter that lands is
  // an entity in an app's store. An address that is nobody's is refused — a
  // bounce the sender reads, since a drop is silence and silence is the one
  // answer that cannot be corrected later. And a failure of ours is neither:
  // it is written where every other break is, and the message is left
  // unanswered so the sending server tries again — refusing there would turn
  // our outage into somebody's lost mail.
  //
  // The log carries the recipient's domain and nothing else: not the local
  // part, not the sender, never the body. A letter is somebody's, and the
  // question this line answers is only which of our names people write to.
  async email(message: Inbound, env: Env, _ctx?: Lent): Promise<void> {
    let { arrived, Refused } = await import('./inbox.ts')
    try {
      await arrived(message, env)
    } catch (e) {
      if (!(e instanceof Refused)) {
        await fault(env, `EMAIL ${message.to.split('@').pop()}`, e)
        throw e
      }
      console.log(`yak: mail refused for ${message.to.split('@').pop()}`)
      await message.setReject(e.message)
    }
  },
}

// The router as the runtime serves it, with every answer leaving past the
// sliding session (session.ts `slid`, T-35380). A request whose cookie is
// more than half way through its life is answered with a fresh one, so an
// account that keeps asking never signs out. It is wrapped around the whole
// router rather than written into a route, because every door has to slide
// and the request is the same one at all of them — `fetch` below reads the
// cookie the browser sent, whatever the router made of the request inside.
//
// Its answer on our zone also says how long the whole router took
// (`gateway`, timing.ts), and `cold` on the first request an isolate serves:
// a request's time that is in neither is the runtime's, before our code ran.
let served = 0
export let handler = {
  ...router,
  fetch: (req: Request, env: Env): Promise<Response> =>
    within(
      env,
      {},
      async () => {
        let at = Date.now(), cold = served++ == 0
        let res = await slid(req, env, await router.fetch(req, env))
        let host = hostOf(req, env)
        if (host != apex(env) && !host.endsWith(`.${apex(env)}`)) return res
        // Every answer on our zone, including refusals and failures, carries
        // the transport policy. A customer's domain keeps its own policy.
        // Rebuilding handles immutable asset headers; an upgrade keeps the
        // runtime's socket, just as dispatch.ts does.
        let headers = new Headers(res.headers)
        headers.set(
          'strict-transport-security',
          'max-age=31536000; includeSubDomains',
        )
        headers.set(
          'server-timing',
          [
            headers.get('server-timing'),
            `gateway;dur=${Date.now() - at}`,
            cold ? 'cold;dur=1' : null,
          ].filter(Boolean).join(', '),
        )
        return new Response(res.body, {
          status: res.status,
          statusText: res.statusText,
          headers,
          webSocket: (res as { webSocket?: unknown }).webSocket,
        } as ResponseInit)
      },
      undefined,
      {
        origin: origin(
          env.WORKER_NAME ?? 'yak',
          env.CF_VERSION_METADATA?.id,
          'gateway fetch',
          req,
        ),
      },
    ),
}
