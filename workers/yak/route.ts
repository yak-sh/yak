// Where a request is going, read from its hostname and path and nothing else
// (D-32318 §Routing). The apex `yaks.app` is the platform's own face;
// `<space>.yaks.app/<app>/…` is an app in a space. On loopback, an explicit
// LOCAL_DEV=1 lets `x-yak-host` stand in for a hostname a local test cannot
// send (fetch refuses a Host header). Deployed hosts always ignore the header.
// Pure: only the configured host, no store.
import type { Env } from './env.ts'
import { apex, type Host, spaceHost, url } from './host.ts'

/** A request before the router splits the hostname into an app path. */
export type Arrived = {
  env: Env
  req: Request
  path: string
  space: string | null
}

/** A hostname's door, or null when the path belongs elsewhere. */
export type Door = (at: Arrived) => Promise<Response | null> | Response | null

export let PLATFORM = apex()

export let SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/

// The dashboard: a person's account and the spaces they work in, at the apex
// rather than on any space's hostname, so no app sharing a space's origin can
// reach them (T-39354). A space's home, where a person lands in it, is
// `/manage/<space>` (T-140050), and its other pages `/manage/<space>/<page>`; the
// person's own, wherever they are, are `/manage/account/<page>` (T-136122),
// which no space can be named (`RESERVED` holds `account`).
export let MANAGE = '/manage'
export let ACCOUNT = 'account'
/** A page of one space's. */
export type SpaceView =
  | 'home'
  | 'apps'
  | 'new'
  | 'operator'
  | 'people'
  | 'connections'
  | 'visits'
  | 'selling'
  | 'billing'
  | 'settings'
  | 'trash'
/** A page of the person's own, the same in every space. `space` makes one. */
export type AccountView = 'profile' | 'invite' | 'agents' | 'shared' | 'space'
export type ManageView = SpaceView | AccountView
let SPACE_VIEWS: SpaceView[] = [
  'apps',
  'new',
  'operator',
  'people',
  'connections',
  'visits',
  'selling',
  'billing',
  'settings',
  'trash',
]
let ACCOUNT_VIEWS: AccountView[] = [
  'profile',
  'invite',
  'agents',
  'shared',
  'space',
]
export let accountView = (view: ManageView): view is AccountView =>
  (ACCOUNT_VIEWS as string[]).includes(view)
// The pages before the space moved into the path, `/manage/<page>` with
// `?space=` or none for the person's own, and what each is now: letters
// already sent carry them.
let LEGACY: Record<string, ManageView> = {
  ...Object.fromEntries(SPACE_VIEWS.map((v) => [v, v])),
  connect: 'agents',
}
/** A dashboard page's path. A space's page without a space names the one the
 * person opens first, whichever that is when they follow it. */
export let managePath = (view: ManageView = 'home', space?: string) =>
  accountView(view)
    ? `${MANAGE}/${ACCOUNT}/${view}`
    : view == 'home'
    ? space ? `${MANAGE}/${encodeURIComponent(space)}` : MANAGE
    : space
    ? `${MANAGE}/${encodeURIComponent(space)}/${view}`
    : `${MANAGE}/${view}`
// What a conversation opens by: a task's or a request's eid, or `new`.
let OPEN = /^(new|[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})$/
/** An Operator conversation's own page, the chat app (operator-page.ts
 * `chatPage`): one opened by its task or request, or a new one. */
export let chatPath = (space: string, open = 'new') =>
  `${managePath('operator', space)}/${open}`
/** What a dashboard path asks for: an account page, a space's page (its home
 * when none is named), or an address from before T-136122 (`legacy`), to be
 * sent on. Null is no page. */
export type Managed =
  | { account: AccountView }
  | { space: string; view: SpaceView; open?: string }
  | { legacy: ManageView }
  | { first: true }
export let managed = (path: string): Managed | null => {
  if (!(path == MANAGE || path.startsWith(`${MANAGE}/`))) return null
  let [one, two, ...rest] = path.slice(MANAGE.length).split('/')
    .filter(Boolean)
  // An Operator conversation, on a page of its own (`chatPath`).
  if (two == 'operator' && rest.length == 1 && SLUG.test(one)) {
    return OPEN.test(rest[0])
      ? { space: one, view: 'operator', open: rest[0] }
      : null
  }
  if (rest.length) return null
  if (!one) return { first: true }
  if (one == ACCOUNT) {
    return !two
      ? { account: 'profile' }
      : (ACCOUNT_VIEWS as string[]).includes(two)
      ? { account: two as AccountView }
      : null
  }
  if (!two) {
    return Object.hasOwn(LEGACY, one)
      ? { legacy: LEGACY[one] }
      : SLUG.test(one)
      ? { space: one, view: 'home' }
      : null
  }
  return SLUG.test(one) && (SPACE_VIEWS as string[]).includes(two)
    ? { space: one, view: two as SpaceView }
    : null
}
/** The page an address from before the dashboard named its space in the path
 * stands for (`/_yaks/<page>`, `/manage/<page>`), or null. */
export let manageView = (path: string): ManageView | null => {
  let at = managed(path)
  return !at ? null : 'first' in at ? 'home' : 'legacy' in at ? at.legacy : null
}
/** One space's dashboard page, as an address to put in a letter or an
 * answer. */
export let manageAt = (
  space: string,
  view: ManageView = 'home',
  env: Host = {},
) => url(env, managePath(view, space))
/** A connections page's address, still naming the testing integrations it
 * was opened for (connections.ts `enabled`), so its forms and a sign-in begun
 * there come back to the page as it was. */
export let enabling = (to: string, enable: string[] = []) =>
  enable.length
    ? `${to}${to.includes('?') ? '&' : '?'}enable=${
      enable.map(encodeURIComponent).join(',')
    }`
    : to

// The path the platform keeps on every space's hostname, outside the
// app-slug namespace: a service's webhooks arrive under it (connections.ts
// `HOOKS`), and the dashboard's addresses from when it lived there move to
// the apex.
export let OURS = '/_yaks'

// Where a sign-in link is spent (link.ts). Under `/login/`, so index.ts
// already routes it to the identity part with the rest of the sign-in surface.
export let LINK = '/login/link'

/** Where signing out is posted (identity.ts). */
export let LOGOUT = '/logout'

/** Where an invitation is accepted, on the platform's own host (invite.ts). */
export let INVITE = '/invite'

// What the plans cost, as a page (public/pricing.html, D-32751). It lives here
// — beside the platform's own name, in the module with no dependencies —
// because both halves of the paid tier need it and they must not import each
// other: billing.ts writes the plan, usage.ts says where a space stands
// against its ceilings, and unseen.ts already joins them.
//
// It is the one address the agent surface may give (C-33033 on D-32751):
// OpenAI's app-directory policy forbids a plugin selling a subscription and
// allows explaining that a feature needs a plan and linking to a page that
// describes the plans. So a tool answer may name this and never a checkout
// link — checkout is the signed-in web page's, and email's.
export let PRICING = url({}, '/pricing')

/** Signed-in plan settings; login preserves this destination. Never checkout. */
export let planSettings = (slug: string, env: Host = {}) =>
  manageAt(slug, 'billing', env)

// One MCP resource, requiring sign-in by default. The explicit required URL
// remains for existing connectors; mixed auth is opt-in at `?auth=mixed`.
export let MCP = url({}, '/mcp')
export let MCP_ASK = `${MCP}?auth=required`

// Where signing in happens — one email address and a six-digit code, and the
// same line for somebody who has never been here (signin.ts). It is here
// beside the other two for the same reason: everything that says it must say
// the same string, and the tools that name it in a refusal (tools.ts, anon.ts)
// cannot import identity.ts, which re-exports it, without dragging the
// runtime's own modules into a Deno test.
export let SIGN_IN = url({}, '/login')

/** Where someone who has not signed in is sent: the login page, already
 * carrying the page to hand them back to (T-32593). Whether that address is
 * one to follow is the login door's to decide. */
export let signInAt = (page: string, env: Host) => {
  let to = new URL(`https://${apex(env)}/login`)
  to.searchParams.set('return', page)
  return to.href
}
/** The page that installs a published app by its name (install.ts). Here
 * beside the sign-in address, since a visitor's bar (visit.ts) sends a
 * stranger through the one to the other. */
export let INSTALL = '/install'
export let installAt = (name: string) =>
  `${INSTALL}?name=${encodeURIComponent(name)}`

export let says = (env: Host = {}) =>
  `sign in at ${url(env, '/login')} to reach your apps from here`

// And the sentence every refusal says about it: what a person's agent reads
// when it asked for something nobody signed in may have. It lives here beside
// the address rather than at one of the doors, because three of them say it —
// the 401 and its challenge (identity.ts), and the tools a stranger is shown
// but may not call (anon.ts `barred`).
export let SAYS = says()

// And what an agent's connector form asks for when it will not go and find it
// (T-34414): the authorization server's own addresses and the one scope.
// identity.ts configures the provider with these, so they are the same strings
// the two `/.well-known` documents serve, and the connect page types them out
// for a person whose form has empty boxes. Paths, not absolute URLs, because
// the provider matches an endpoint by hostname and path and the probe kernel
// is not at this hostname; the page absolutes them against PLATFORM.
export let OAUTH = {
  authorize: '/oauth/authorize',
  token: '/oauth/token',
  register: '/oauth/register',
  scope: 'graph',
}

// The Cloudflare for SaaS fallback origin (T-33036): the name a customer's
// own hostname is CNAME'd to, and the one place that name is written — the
// attach flow and the guide both read it here.
//
// Two labels deep on purpose. `route()` below reads everything before
// `.yaks.app` as a space slug, and `SLUG` admits no dot, so `x.y.yaks.app` is
// already outside the space namespace and no person can ever claim the space
// that would shadow our own origin. A one-label name (`origin.yaks.app`)
// would have needed a reserved-word list to hold that line, and a list is a
// thing to forget; the namespace's own shape does not forget.
//
// This is also the reason a domain mid-provisioning reaches the Worker at
// all instead of timing out (T-33036): the CNAME above and the `*/*` route
// mean traffic for any custom hostname on this zone arrives here, active or
// not — a visitor of a domain whose DNS, validation or certificate step has
// not finished yet used to get a raw 522 with nothing between them and it.
// index.ts `settling` is the branded page that answers there now.
export let ORIGIN = `origin.saas.${PLATFORM}`

// Where the app serving this request is mounted for the browser that asked:
// the prefix its pages resolve relative URLs against, and the address its own
// `/<app>/` would forward to. `/<app>/` normally, and `/` when a custom
// domain carried the request here — there the app is the domain's root
// (index.ts `aimed`), even though the address the platform routes on names
// the app's prefix. The router sets this header on a request it rewrote
// itself and strips it off anything a client sent, so it is never a way to
// move an app's address from outside.
export let MOUNT = 'x-yak-mount'

/** The header an app's own worker carries its sealed visitor in, coming back
 * through its service binding (dispatch.ts). */
export let GRANT = 'x-yak-grant'

/** Whether a request carries one, valid or not: it is the kernel's to open. */
export let bearing = (req: Request) => req.headers.has(GRANT)

// The addresses on a space's hostname its apps never answer: a repository
// (git_door.ts) and a service's webhooks (connections.ts). They come before
// the apps and before the edge's kept pages.
export let DOORS = /^\/([^/.]+)\.git\/(info\/refs|git-upload-pack)$/
export let BARE = /^\/([^/.]+)\/info\/refs$/
export let spaceDoor = (path: string) =>
  DOORS.test(path) || BARE.test(path) || path.startsWith(`${OURS}/hooks/`)

/** The browser-facing URL retained when the router aims a custom domain. */
export let ADDRESS = 'x-yak-address'

export type Route = {
  // null at the apex
  space: string | null
  // null at a space's bare hostname, or when the first segment is no slug
  app: string | null
  // inside an app: '' for `/<app>` itself (the caller adds the slash), else
  // the path from its slash; at the apex or a bare space, the whole path
  path: string
}

// The slugs no space or app may take, because at `<slug>.yaks.app` and at
// `<slug>@yaks.app` (post.ts `mailFrom`) they would read as the platform
// speaking (T-37886): a sign-in page at `login.yaks.app`, a letter from
// `security@yaks.app`. The doors that mint an address check it (tools.ts
// `fresh`, directory.ts `free` and `own`, identity.ts `choose`); an address
// already held keeps working. `yak` is the platform's own space (directory.ts
// `META`), and `origin` and `saas` its custom-hostname origin (`ORIGIN`).
// `sha` and `git` are the platform's own key prefixes in the files bucket
// (versions.ts `SHA`, gitobj.ts `BODY`): a space's files are kept under its
// slug, so a space by either name would share storage with the platform's.
export let RESERVED = new Set([
  'abuse',
  'account',
  'accounts',
  'admin',
  'administrator',
  'api',
  'app',
  'apps',
  'auth',
  'billing',
  'cf-bounce',
  'checkout',
  'connect',
  'dashboard',
  'docs',
  'email',
  'git',
  'hello',
  'help',
  'hostmaster',
  'login',
  'logout',
  'mail',
  'manage',
  'mcp',
  'mx',
  'no-reply',
  'noreply',
  'oauth',
  'official',
  'origin',
  'password',
  'pay',
  'payment',
  'payments',
  'postmaster',
  'pricing',
  'privacy',
  'root',
  'saas',
  'secure',
  'security',
  'settings',
  'sha',
  'sign-in',
  'sign-up',
  'signin',
  'signup',
  'staff',
  'status',
  'stripe',
  'support',
  'system',
  'terms',
  'verify',
  'webmaster',
  'www',
  'yak',
  'yaks',
])

// Where a hostname somebody else owns is served from: the address on our own
// zone that the request is carried to, and the mount the app sits at there
// (T-34596). The directory says which place the domain names — a space, or one
// app of it — and this is the whole of what that difference means.
//
// A domain on a space is that space's own hostname with the path untouched, so
// it routes through `route()` and every rung of apps.ts exactly as
// `<space>.yaks.app` does: the front page at `/`, each app at `/<app>/`, the
// space's own doors where they always were. There is no second path rule for
// it, because it is the rule.
//
// A domain on an app is that app's prefix under the same hostname, mounted at
// `/`: `herbusiness.com/menu` is `<space>.yaks.app/<app>/menu`, and the mount
// says the app's pages resolve from the domain's root rather than from the
// prefix the platform routed by. Both may point at one space at once — the
// app's own domain opens it at `/`, the space's opens it at `/<app>/`.
export let aimedAt = (
  space: string,
  app: string | null,
  pathname: string,
  env: Host = {},
) => ({
  host: spaceHost(env, space),
  pathname: app ? `/${app}${pathname}` : pathname,
  mount: app ? '/' : null,
})

let dev = (host: string) =>
  host == 'localhost' || host == '127.0.0.1' || host == '[::1]' ||
  host.endsWith('.localhost')

export let hostOf = (req: Request, env: Host = {}) => {
  let host = new URL(req.url).hostname.toLowerCase()
  return env.LOCAL_DEV == '1' && dev(host)
    ? (req.headers.get('x-yak-host') ?? host).toLowerCase()
    : host
}

// A hostname that is neither ours nor a dev host — someone else's domain,
// which the directory may know as a customer's (T-33037). Everything the
// platform already answers on is not foreign, so every route that exists
// today is decided before this is ever asked: the apex, a space, a dev host,
// and `x.y.yaks.app`, which was the apex before custom domains and still is.
export let foreign = (host: string, env: Host = {}) =>
  !dev(host) && host != apex(env) && !host.endsWith(`.${apex(env)}`)

// An address on the platform's own zone: https, and the apex or a hostname
// under it. It is what a sign-in may hand someone back to (T-32593) — a
// stranger's address is nowhere we send anyone, so it answers null and the
// caller goes home instead. Pure, like the rest of this file.
//
// A custom domain is deliberately not on the zone (T-33037). We serve it, but
// the return address arrives from whoever asked, this check is the only thing
// between that and an open redirect, and it is pure and synchronous — reading
// the directory here to see whether a stranger's hostname is a customer's
// would make the one guard in the path an async lookup that can fail open.
// Nothing is lost by refusing: the platform session cookie is `yaks.app`'s, so
// a person handed back to `herbusiness.com` would arrive signed out anyway.
// index.ts serves a custom domain at its app's own address on this zone, so
// sign-in hands them back there, signed in. A domain that wants to keep
// someone on their own hostname needs its own verified return, not a wider
// `onZone`.
export let onZone = (href: string, env: Host = {}) => {
  // A bare path is on the zone by construction, and it is what the platform's
  // own returns are made of (`/login?return=/connect`), so refusing one threw
  // away every address we minted ourselves. `//host` — and `/\host`, which a
  // browser reads the same way — is a stranger's URL wearing a path's
  // clothes, and is refused with the rest.
  if (href.startsWith('/')) return /^\/[/\\]/.test(href) ? null : href
  let url
  try {
    url = new URL(href)
  } catch {
    return null
  }
  let host = url.hostname.toLowerCase()
  return url.protocol == 'https:' &&
      (host == apex(env) || host.endsWith(`.${apex(env)}`))
    ? url.href
    : null
}

export let route = (host: string, pathname: string, env: Host = {}): Route => {
  let space = host.endsWith(`.${apex(env)}`)
    ? host.slice(0, -apex(env).length - 1)
    : null
  if (space == null || !SLUG.test(space)) {
    return { space: null, app: null, path: pathname }
  }
  let [, first, ...rest] = pathname.split('/')
  if (!first || !SLUG.test(first)) return { space, app: null, path: pathname }
  return {
    space,
    app: first,
    path: pathname.length > first.length + 1 ? `/${rest.join('/')}` : '',
  }
}

// What the PLATFORM owns rather than an app, read from the hostname and the
// path. The whole rule in one idea: `/.well-known/` is where a site grants
// authority over its own name, and the name under `<space>.yaks.app` is ours
// — a space rents a label of our hostname, it does not own it.
//
// The test is NOT whether a file is host-scoped. `robots.txt` is host-scoped
// and stays the app's, deliberately: a robots file grants nobody anything,
// it is a preference about the site, and the site's face is the home app.
// The test is whether the file hands somebody a capability over a name we
// own. `assetlinks.json` grants a native Android app the right to intercept
// URLs for the whole hostname; `apple-app-site-association` does the same on
// iOS; an HTTP-01 challenge yields a publicly trusted certificate for a
// hostname on our zone. A space's app must not be able to grant those on our
// name, and that holds for the HOME app too, which otherwise answers every
// address no other app claims (T-33040) — which is how all of this landed in
// an app in the first place, and why top-level routing has to say out loud
// that it wins.
//
// The whole prefix rather than the three files, because a list of names that
// grant authority is a thing to forget — the next one ships without us —
// and on our own hostname there is nothing under it we lose by keeping.
//
// The same files are the app's on a customer's own domain (`foreign`), by
// this idea rather than despite it: there the name is theirs, so the
// authority is theirs to grant. Proving domain control to a third party is
// exactly what `pki-validation` is for at Sectigo and DigiCert, Stripe asks
// for `apple-developer-merchantid-domain-association` before Apple Pay
// works, App Links, Universal Links, `security.txt`, WebFinger, Matrix
// delegation and fediverse verification all live here, and obtaining a
// certificate for your own domain is your own business. Nothing is reserved
// there, and there is no list of exceptions to keep: a path is the
// platform's when the platform has something to serve at it, and everything
// else falls through to the app. The apps-directory token is the shape of
// that — the apex has content at `/.well-known/openai-apps-challenge` and
// answers it (index.ts), while `/.well-known/anything-else` is nobody's and
// 404s. When Stripe or Apple Pay needs to answer somewhere, it will answer
// because it has content, not because a string was added to a table.
//
// Our own renewal of a customer's custom-hostname certificate is not at risk
// from that. This zone has a `*/*` Worker route (wrangler.toml, T-33036), and
// Cloudflare warns it can intercept a CA's request
// (developers.cloudflare.com/ssl/edge-certificates/changing-dcv-method/troubleshooting/).
// Measured 2026-09-03: with that route live and the Worker answering these
// paths itself, a probe hostname was attached as a custom hostname and
// ssl.com issued its certificate within a minute, while a request to
// `/.well-known/acme-challenge/x` on that hostname reached the Worker and got
// its soft 404. Cloudflare's edge answers the CA before the route ever runs.
// That measurement is also why the platform can answer its own 404 on our
// hostnames instead of passing a request through to a fallback origin that is
// deliberately originless (`AAAA 100::`).
export let platform = (host: string, pathname: string, env: Host = {}) =>
  !foreign(host, env) && pathname.startsWith('/.well-known/')

// What a page at another address may not ask for here, read from the method
// and the path (`sameOrigin` below is the check itself).
//
// Every write, wherever it is aimed. Sibling spaces are same-site, so any
// form a page in anybody's space aims at a door that acts on the session
// cookie arrives with the cookie. A list of the doors that write was the
// guard once, and every door added after it was open: the OAuth consent, the
// space delete, the standing link and the address picker were all forged from
// a free space (T-37874), as the billing webhook had been by being renamed
// out of the list (T-35357). The method is the one thing a new door cannot
// forget to say. Guarding costs a server-to-server caller nothing — Stripe
// posts with no `Origin`, and an absent one is allowed.
//
// Except the two doors the OAuth provider answers with CORS on purpose:
// token and registration read no cookie at all, a code, its PKCE verifier
// and a client's own metadata being the whole of what they take, and a
// browser-based client posts to them from its own origin.
//
// And the doors the graph answers at, whatever the method: an app's
// `/<app>/api/…`, a front page's own `/api/…` (apps.ts `fetch` serves the home
// app everything no other app claims), and the connector at `/mcp`, where a
// socket or a stream is a read that carries the session's write grant.
// Pages, files and images are deliberately not here — an app's bytes are the
// web's, and a cross-origin GET of one carries no `Origin` anyway. The shape
// over-reaches a little: a static asset at `/x/api/y` on the apex matches too,
// which costs nothing, since nothing a browser fetches cross-origin without
// CORS can read the answer either way.
export let guarded = (method: string, pathname: string) =>
  (method != 'GET' && method != 'HEAD' && method != 'OPTIONS' &&
    pathname != OAUTH.token && pathname != OAUTH.register) ||
  pathname == '/mcp' || /^(?:\/[^/]+)?\/api\//.test(pathname)

// The browser's own word for the page that asked, against the hostname it
// asked at. Every space is a subdomain of one registrable domain, so sibling
// spaces are same-site: `SameSite=Lax` does not keep the session cookie off a
// request one space's page aims at another's, and a websocket handshake is
// outside the same-origin policy altogether. This is the line that separates
// them, and it is the whole of it everywhere except the one door below, where
// the answer carries CORS headers precisely because no cookie was read.
//
// Absent is allowed on purpose. A browser sends `Origin` on every
// cross-origin fetch and on every handshake, so refusing only a mismatch
// closes the browser attack completely; curl, a server-to-server client and
// the kernel's own internal requests send none and have no page to be tricked
// through. Requiring the header would break them for no security at all.
//
// Hostname only: scheme and port differ between a dev host and the platform,
// and neither is what a space is isolated by.
//
// The apex is no sibling: it is the platform's own pages, with no app's code
// in them, and the dashboard there aims at a space's doors (pages.ts `desk`:
// the drop zone, the builder's socket). A page that could forge a request
// from the apex could already consent to an agent or close a space there, so
// admitting it here gives nothing away.
export let sameOrigin = (
  host: string,
  origin: string | null,
  env: Host = {},
) => {
  if (!origin) return true
  try {
    let from = new URL(origin).hostname.toLowerCase()
    return from == host.toLowerCase() || from == apex(env)
  } catch {
    // `Origin: null` — a sandboxed frame, an opaque origin — is a stranger.
    return false
  }
}

// The one door above that a stranger's page may reach anyway (T-33408), and
// the shape of the whole permission: the app's read door, asked with GET, and
// answered as nobody — the router drops the request's credentials before it is
// served and sends `Access-Control-Allow-Origin: *` with no
// `Access-Control-Allow-Credentials` beside it, which is the browser's own
// guarantee that no cookie was used and none can be read (index.ts `cors`).
//
// It is safe because what `sameOrigin` closes is ambient credentials, not
// secrecy: a public app's rows already answer to anyone with curl, and the
// attack was the session cookie riding along on a request one space's page
// aimed at another's. Take the cookie away and the request is curl with a
// referrer. What the caller may then read is the app's own `access`, unchanged
// and decided downstream: `public` and `open` answer a stranger, `private`
// refuses one.
//
// Writes are not here and must not be. An `open` app lets a stranger write —
// with the link, from its own page — and a cross-origin write is the forgery
// origin_test.ts fires. Nor is `/ws`, which is a read but carries the
// write grant on the same socket, nor `/graph`, `/me` or `/blob`: this is the
// door the answer is data at, and nothing else has asked to be shared.
//
// No preflight door is needed and none is built: a GET with no author-set
// headers is a CORS simple request, so the browser sends it and reads the
// answer with no `OPTIONS` in between. A client that adds a header would need
// one, and can ask for it when it exists.
export let shared = (method: string, pathname: string) =>
  (method == 'GET' || method == 'HEAD') &&
  /^(?:\/[^/]+)?\/api\/query$/.test(pathname)

// A sandboxed app's page asking its own doors (installed.ts, D-37901): the
// path carries its page token as `/<app>/~<token>/…`, or `/~<token>/…` for a
// front page or an app on its own domain. Such a page has an opaque origin,
// so it sends `Origin: null`, which `sameOrigin` refuses — and it should,
// everywhere a cookie could ride along. Here none may: the router takes the
// cookie off before the request is served and marks the answer readable by
// any origin (index.ts), because the credential is the token in the URL,
// which no browser attaches on its own. What the token opens is the one app
// it was sealed for; every other request on such a path is anonymous.
export let paged = (pathname: string) =>
  /^(?:\/[^/]+)?\/~[^/]+(?:\/|$)/.test(pathname) ||
  /^\/[^/]+\/_preview\/[^/]+(?:\/|$)/.test(pathname)
