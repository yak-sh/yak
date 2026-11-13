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
// Deno over the in-memory platform (probe.ts `kernel`) exactly as the
// kernel's `./worker` facet (facets/kernel-worker.ts) hands it to the runtime.
//
// A write, or a request at a graph door, whose `Origin` names another
// address is refused before it is served (@yaks/platform/routes `admitted`),
// and asked before `aimed` rewrites a custom domain's address, while the
// hostname the browser addressed is still there to compare.
//
// There is no heartbeat: every store owes its own wakes and arms its own
// Durable Object alarm for them (graph.ts, D-37562).
//
// The route table. Above every line of it sits what the platform owns
// (@yaks/platform/routes `platform`): the whole `/.well-known/` prefix on our own
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
import { compose, type WorkerFacet } from '@yaks/workerd/compose'
import { caught, within } from './defects.ts'
import { CallError, refused as toolRefusal } from '@yaks/tools/errors'
import { Stale } from '@yaks/graph/errors'
import * as apps from './apps.ts'
import { sealed } from './cache.ts'
import * as dirPart from './directory.ts'
import { directory } from './directory.ts'
import { customOf, reading, refresh, type Step } from './domains.ts'
import { bound, type Env, type Inbound } from './env.ts'
import { apex } from '@yaks/platform/host'
import { lost, oops, provisioning } from './pages.ts'
import { hook } from './connections.ts'
import {
  admitted,
  aim,
  collapsed,
  cors,
  foreign,
  handedOff,
  hostOf,
  platform,
  ready,
  type Route,
  route,
  unmounted,
} from '@yaks/platform/routes'
import { slid } from './session.ts'
import { fault, refusal } from './unseen.ts'

// Where a request is, once `hosting` below has carried it to its address on
// our own zone.
let at = (req: Request, env: Env): Route =>
  route(hostOf(req, env), new URL(req.url).pathname, env)

/** The apex's pages and doors (apex.ts), and nothing on a space's hostname.
 * Every answer there leaves through apex.ts `seen`, so whichever page a link
 * lands a person on keeps its arrival and tells its view. */
export let atApex = async (req: Request, env: Env) => {
  let r = at(req, env)
  return r.space == null
    ? (await import('./apex.ts')).answer(req, env, r.path)
    : null
}

/** A space's hostname, and nothing at the apex. */
export let atSpace = (req: Request, env: Env) => {
  let { space } = at(req, env)
  return space == null ? null : inSpace(req, env, space)
}

// A space's hostname: its previews, its drops, its hooks and its apps.
let inSpace = async (req: Request, env: Env, space: string) => {
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

// A foreign host that has reached the Worker (@yaks/platform/routes origin, T-33036) but
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
  if (ready(served)) return null
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
// neither ours nor a dev host (@yaks/platform/routes `foreign`). A host the directory has
// never been given answers null and keeps the route it already had, which is
// the apex: every address that exists today is decided before this is asked.
//
// The request is carried to the address that place already has on our own zone
// (@yaks/platform/routes `aimedAt`, which is the whole of the space/app difference), and
// every part below routes it from the pure route table the way it routes
// everything else — so a domain on a space is served by the same rungs as
// `<space>.yaks.app` rather than by a second copy of them. The browser stays on
// the person's domain; only the address the platform derives from the request
// moves, which is what puts a sign-in return on our own zone, where the session
// cookie is (@yaks/platform/routes `onZone`).
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
  return at ? aim(req, host, at, env) : null
}

// A hostname that sends its visitors to another of its place's hostnames
// (directory.ts `Host`): the bare domain to www, say, so the place answers at
// one address whichever the visitor typed. The same permanent move a renamed
// space makes (apps.ts `moved`), path and query kept. It is asked after
// `settling`, so the hostname itself has its certificate and the move is
// served over it.
let forwarded = async (req: Request, env: Env, host: string) => {
  if (!foreign(host, env)) return null
  let at = await directory(bound(env.DIRECTORY, dirPart.fetch, env))
    .serves(host)
  if (!at?.host.to) return null
  let url = new URL(req.url)
  return apps.moved(req, `https://${at.host.to}${url.pathname}${url.search}`)
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

// The slice of a handler's context the letter door needs (`email` below).
export type Lent = { waitUntil: (work: Promise<unknown>) => void }

// What stands before the routes on every hostname: what the platform owns,
// a custom domain's sign-in, settling and forwarding, space isolation and the
// address a custom domain is carried to. `next` asks the routes (`atApex`,
// `atSpace`) with the request as it was carried.
let hosting = async (
  req: Request,
  env: Env,
  next: (req: Request) => Promise<Response>,
): Promise<Response> => {
  req = collapsed(req)
  let host = hostOf(req, env)
  let r = route(host, new URL(req.url).pathname, env)
  try {
    req = unmounted(req)
    // What the platform owns rather than an app (@yaks/platform/routes `platform`),
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
        r.space != null ? lost(env) : await next(req),
        env,
      )
    }
    // Custom-domain sign-in lands here (identity.ts `handoff`): the one
    // identity door a customer's own hostname answers, caught before `aimed`
    // carries the request off to the app, so this hostname sets its own
    // host-only session cookie rather than the app store answering a sign-in
    // path. It is a foreign host by construction — a space's `.yaks.app`
    // hostname already carries the platform cookie and never needs it.
    if (handedOff(host, asked, env)) {
      return sealed(
        await bound(
          env.IDENTITY,
          (await import('./apex.ts')).identity,
          env,
        ).fetch(req),
        env,
      )
    }
    // A domain mid-provisioning, or one Cloudflare has stopped serving
    // (`settling` above): answered before space isolation and `aimed`,
    // because there is nothing yet to isolate or route to — every path on
    // a host like this gets the same branded page, not just `/`.
    let hold = await settling(env, host)
    if (hold) return sealed(hold, env)
    let sent = await forwarded(req, env, host)
    if (sent) return sealed(sent, env)
    // Space isolation (@yaks/platform/routes `admitted`), before `aimed`
    // moves the address, since what must match is what the browser
    // addressed.
    let given = admitted(req, host, env)
    if ('answer' in given) return sealed(given.answer, env)
    req = given.req
    let carried = r.space == null ? await aimed(req, env, host) : null
    if (carried) {
      req = carried
      r = at(carried, env)
    }
    let answer = await next(req)
    return sealed(given.anyone ? cors(answer) : answer, env)
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
        return sealed(
          Response.json(answer, { status, headers: apps.waited(e) }),
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
}

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
export let email = async (
  message: Inbound,
  env: Env,
  _ctx?: Lent,
): Promise<void> => {
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
}

// The kernel's wrap (@yaks/workerd `Wrap`): `hosting` and the routes inside
// it, with every answer leaving past the sliding session (session.ts `slid`,
// T-35380). A request whose cookie is more than half way through its life is
// answered with a fresh one, so an account that keeps asking never signs out.
// It is wrapped around every route rather than written into one, because
// every door has to slide and the request is the same one at all of them —
// this reads the cookie the browser sent, whatever `hosting` made of the
// request inside.
//
// Its answer on our zone also says how long the kernel took
// (`gateway`, timing.ts), and `cold` on the first request an isolate serves:
// a request's time that is in neither is the runtime's, before our code ran.
let served = 0
export let wrap = (
  req: Request,
  env: Env,
  next: (req: Request) => Promise<Response>,
): Promise<Response> =>
  within(
    env,
    {},
    async () => {
      let started = Date.now(), cold = served++ == 0
      let res = await slid(req, env, await hosting(req, env, next))
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
          `gateway;dur=${Date.now() - started}`,
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
  )

/** The kernel as a Worker's plugin gives it (@yaks/workerd `compose`): the
 * hostname pipeline around the apex's routes and a space's, and the letter
 * door. facets/kernel-worker.ts hands the runtime the same, loaded on the
 * first call. */
export let kernel: WorkerFacet = {
  wrap: (_options, env) => (req, next) => wrap(req, env as Env, next),
  routes: (_options, env) => [
    { method: '*', path: '*', handle: (req) => atApex(req, env as Env) },
    { method: '*', path: '*', handle: (req) => atSpace(req, env as Env) },
  ],
  email: (_options, env) => (message: Inbound, ctx: Lent) =>
    email(message, env as Env, ctx),
}

/** The kernel alone, served in process (probe.ts). */
export let handler = compose({ plugins: ['yak/kernel'] }, {
  'yak/kernel': kernel,
}).default
