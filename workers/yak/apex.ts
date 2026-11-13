// The apex's own pages and doors (kernel.ts routes here): the home page and
// the listings Site caches, sign-in, the dashboard, the admin's directory,
// money, phones and the owner's doors. Loaded on the first request to the
// apex, so an isolate woken for a space's page never compiles them (T-148886).
import * as admin from './admin.ts'
import * as apps from './apps.ts'
import { packageAt } from './cache.ts'
import * as billing from './billing.ts'
import * as budget from './budget.ts'
import * as comp from './comp.ts'
import * as dirPart from './directory.ts'
import { directory } from './directory.ts'
import { copyOf } from './directory-copy.ts'
import { bound, type Env, type Handler } from './env.ts'
import * as gallery from './gallery.ts'
import * as skillPage from './skill-page.ts'
import { PAGE, PUBLISHER } from './gallery-row.ts'
import * as install from './install.ts'
import * as appPage from './app-page.ts'
import * as publisherPage from './publisher-page.ts'
import { call } from './tools.ts'
import { isListing, listed } from './kept-page.ts'
import { sprite } from './icons.ts'
import { lost } from './pages.ts'
import { callback } from './connections.ts'
import { logoDoor } from './catalog.ts'
import { answer as seo } from './seo.ts'
import { LOGOUT, MANAGE } from '@yaks/platform/routes'
import { START } from './newcomer.ts'
import * as pageReport from './page-report.ts'
import { paymentDoor } from './payment-doors.ts'
import * as sell from './sell.ts'
import * as support from './support-door.ts'
import * as supportPage from './support-page.ts'
import * as sweep from './sweep.ts'
import * as tunnel from './tunnel.ts'
import * as site from './site.ts'
import * as funnel from './funnel.ts'
import { isHome, isPage } from './view-point.ts'
import { keep } from './arrival.ts'
import * as variant from './variant.ts'
import * as ads from './ads.ts'

// Doors loaded when a request first reaches one (T-37977). What they import,
// the MCP SDK and zod, the OAuth provider, is evaluated only by an isolate
// that serves one of them, not by every cold start.
export let identity: Handler = async (req, env) =>
  (await import('./identity.ts')).fetch(req, env)
let mcp: Handler = async (req, env) =>
  (await import('./mcp.ts')).fetch(req, env)

// The apex: the platform's own pages and doors.
let atApex = async (req: Request, env: Env, path: string) => {
  let noticed = path.match(/^\/mail\/([a-z0-9-]+)$/)
  if (noticed) {
    return (await import('./mail-receipts.ts')).receipts(req, env, noticed[1])
  }
  if (path.startsWith('/__packages/')) {
    // The canonical origin is common to every app. Files caches compiler
    // assets by content, without a tenant or release discriminator.
    return (await import('./files.ts')).door(env).fetch(
      new Request(packageAt(path), {
        method: req.method,
        headers: req.headers,
      }),
    )
  }
  if (path == '/icons.svg') {
    return new Response(sprite(), {
      headers: {
        'content-type': 'image/svg+xml',
        'cache-control': 'public, max-age=3600',
      },
    })
  }
  // The dashboard (apps.ts `manage`): the part that draws a space's pages.
  if (path == MANAGE || path.startsWith(`${MANAGE}/`)) {
    return bound(env.APPS, apps.fetch, env).fetch(req)
  }
  // A TV paired by a code (screen.ts): its page, and the phone's.
  if (path == '/tv' || path.startsWith('/tv/')) {
    return (await import('./screen.ts')).fetch(req, env)
  }
  if (
    path == '/login' || path.startsWith('/login/') || path == '/connect' ||
    path == START ||
    path == '/invite' || path == LOGOUT ||
    // Closing a space (identity.ts `closing`, T-33166): a signed-in page and
    // its form, so it belongs with the rest of the cookie's surface rather
    // than at the connector door an agent speaks to.
    path.startsWith('/space/') ||
    path.startsWith('/oauth/') || path.startsWith('/.well-known/oauth-')
  ) {
    return bound(env.IDENTITY, identity, env).fetch(req)
  }
  // Money, before the connector. `/api/*` at the apex is otherwise all
  // mcp.ts's, a door that answers a JSON 404 to everything but `/mcp`. The
  // checkout and portal doors sit under that prefix because they are the same
  // part (billing.ts) and are reachable only from a signed-in page — never
  // from a tool answer (C-33033).
  if (path.startsWith('/api/billing/')) {
    return bound(env.BILLING, billing.fetch, env).fetch(req)
  }
  // The payment provider's webhook doors (payment-doors.ts), each its own
  // endpoint with its own signing secret. Not under `/api/` — that prefix is
  // the graph's — and guarded all the same, as every write is (@yaks/platform/routes
  // `guarded`). It costs them nothing: a provider posts server to server with
  // no Origin at all, and an absent Origin is allowed (@yaks/platform/routes `sameOrigin`).
  let paid = await paymentDoor(req, env)
  if (paid) return paid
  // A phone's doors, for any provider config.ts `phoneConfig` lends as `via`
  // (phones.ts): its texts, their outcomes and its calls ringing, as it
  // posts them (operator-texts.ts); a call's audio, streamed to the Operator
  // it reached (operator-calls.ts); and the texts to a person's own number,
  // as its callback sends them under the ticket it was given
  // (operator-line.ts). A speech provider whose own line carries calls
  // rings `/<provider>/calls` (operator-carried.ts).
  let [, via, door] = /^\/([^/]+)\/([^/]+)$/.exec(path) ?? []
  if (via && door == 'calls') {
    let { carriedDoor, carrierNamed } = await import('./operator-carried.ts')
    let carrier = carrierNamed(via)
    if (carrier) return carriedDoor(req, env, carrier)
  }
  let phone = via &&
    await import('./phones.ts').then((p) => p.phoneNamed(env, via))
  if (phone && door == 'webhook') {
    let { textDoor } = await import('./operator-texts.ts')
    return textDoor(req, env, via)
  }
  if (phone && door == 'stream') {
    let { streamDoor } = await import('./operator-calls.ts')
    return streamDoor(req, env)
  }
  if (phone && phone.own) {
    let { lineDoor } = await import('./operator-line.ts')
    return lineDoor(req, env, via, phone.own)
  }
  // What the platform takes from a sale (sell.ts `fees`, T-34554), read and
  // set by whoever owns the `yak` space. Before the connector, for the reason
  // the billing doors are: `/api/*` at the apex is otherwise all mcp.ts's, and
  // this is not a tool — the connector's roster is fixed and public (T-34541),
  // and a rate is the owner's own door, not a thing an agent may move.
  if (path == '/api/fee') return sell.fees(req, env)
  // A space's model budget, set by the same owner (budget.ts, T-137556),
  // before the connector for the same reason as the fee's.
  if (path == '/api/budget') return budget.fetch(req, env)
  if (path == '/api/comp') return comp.fetch(req, env)
  // TaskMaster's answers to support threads (support-door.ts), the owner's
  // door, before the connector for the same reason as the fee's.
  if (path == support.PATH) return support.fetch(req, env)
  // A support thread's own page (support-page.ts), signed in: the link the
  // feedback tool answers with and the person's Updates lead to.
  if (path.startsWith(`${supportPage.PATH}/`)) {
    return supportPage.answer(req, env, path)
  }
  // The tunnel a space has to a machine (tunnel.ts, T-39585): the owner's own
  // door, before the connector for the same reason as the fee's.
  if (path == '/api/tunnel') return tunnel.fetch(req, env)
  // The store mover's sweep (sweep.ts, D-45640): the owner's door onto every
  // store's rehearsal and wake, before the connector for the same reason.
  if (
    path == sweep.PATH || path == sweep.IDLE_PATH ||
    path == sweep.ACCOUNT_PATH || path == sweep.RELOCATE_PATH ||
    path == sweep.OPERATOR_PATH || path == sweep.STORE_COPY_PATH
  ) {
    return sweep.fetch(req, env)
  }
  // What breaks in the platform's own pages (page-report.ts), before the
  // connector for the same reason as the fee's.
  if (path == pageReport.PATH) return pageReport.answer(req, env)
  // A click on a home-page call to action (funnel.ts), before the connector
  // for the same reason.
  if (path == funnel.CLICKED) return funnel.clicked(req, env)
  // The funnel as data for the box's admin_funnel tool (admin.ts
  // `funnelDoor`), the owner's door, before the connector for the same reason.
  if (path == admin.FUNNEL) return admin.funnelDoor(req, env)
  if (path == '/mcp' || path.startsWith('/api/')) {
    return bound(env.MCP, mcp, env).fetch(req)
  }
  // The one static token OpenAI's apps directory fetches to verify the domain.
  // Not identity.ts's — the oauth well-known is that door's metadata; this is a
  // separate single verification string, served from a secret so the repo
  // carries no token, and 404 when unset.
  if (path == '/.well-known/openai-apps-challenge') {
    return env.OPENAI_APPS_CHALLENGE == null ? lost(env) : new Response(
      env.OPENAI_APPS_CHALLENGE,
      { headers: { 'content-type': 'text/plain; charset=utf-8' } },
    )
  }
  // Crawlers, connection callbacks and the catalog's logos are the apex's
  // own doors.
  let said = await seo(req, path, env, () =>
    publisherPage.addresses(
      directory(bound(env.DIRECTORY, dirPart.fetch, env), {
        copy: copyOf(env),
        time: env.CLOCK,
        public: true,
      }),
      env,
    )) ??
    await callback({ env, req, path, space: null }) ??
    await logoDoor(env, path)
  if (said) return said
  // The apex's public pages are cached behind a separate entrypoint; only
  // these paths reach it, without credentials or unbounded query strings.
  if ((req.method == 'GET' || req.method == 'HEAD') && isListing(path)) {
    let page = await site.forward(req, env, listed(req, path))
    if (isHome(req, path, page)) funnel.step(env, 'home', req)
    return page
  }
  // The gallery's ticketed review stays on this uncached gateway.
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env), {
    copy: copyOf(env),
    time: env.CLOCK,
  })
  if (path == install.PATH) return install.answer(req, env, dir)
  // A published app's own page (app-page.ts): read from the offers on every
  // visit, so an unpublished app's page is gone the moment it is.
  if (path.startsWith(PAGE)) {
    return appPage.answer(req, env, path, dir)
  }
  // A listed skill's page (skill-page.ts), read the same way.
  if (path.startsWith(skillPage.PATH)) {
    return skillPage.answer(req, env, path, dir)
  }
  // A publisher's page (publisher-page.ts): what a space shares in public.
  if (path.startsWith(PUBLISHER)) {
    return publisherPage.answer(req, env, path, dir)
  }
  if (path == gallery.REVIEW) {
    let shown = await gallery.answer(req, env, path, dir, call)
    if (shown) return shown
  }
  // The platform admin's directory, signed in and uncached like the review.
  let directed = await admin.answer(req, env, path, dir)
  if (directed) return directed
  return site.statics(req, env, path, dir)
}

// An answer at the apex a person opened: it keeps the arrival its link carried
// (arrival.ts), and a page tells the ad network whose click brought it
// (ads.ts).
let seen = (req: Request, env: Env, page: Response) => {
  if (isPage(req, page)) ads.after(env, 'view', req)
  return variant.keep(req, keep(req, page))
}

/** An apex request's answer, leaving through `seen`. */
export let answer = async (req: Request, env: Env, path: string) =>
  seen(req, env, await atApex(req, env, path))
