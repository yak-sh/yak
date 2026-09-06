// Where a request is going, read from its hostname and path and nothing else
// (D-32318 §Routing). The apex `yaks.app` is the platform's own face;
// `<space>.yaks.app/<app>/…` is an app in a space. A dev host — wrangler dev's
// loopback, the workers.dev preview — serves as the apex, and only there does
// `x-yak-host` stand in for a hostname a test cannot send (fetch refuses a
// Host header): on the platform's own hostnames the header is ignored, so no
// client routes itself into a space by header. Pure: no env, no store.
export let PLATFORM = 'yaks.app'

// What the plans cost, as a page (public/pricing.html, D-32751). It lives here
// — beside the platform's own name, in the module with no dependencies —
// because both halves of the paid tier need it and they must not import each
// other: billing.ts writes the plan, usage.ts says where a space stands
// against its ceilings, and unseen.ts already joins them.
//
// It is the ONE address the agent surface may give (C-33033 on D-32751):
// OpenAI's app-directory policy forbids a plugin selling a subscription and
// allows explaining that a feature needs a plan and linking to a page that
// describes the plans. So a tool answer may name this and never a checkout
// link — checkout is the signed-in web page's, and email's.
export let PRICING = `https://${PLATFORM}/pricing`

// The agent door, as an address a person types into a connector form: two
// spellings of ONE resource (mcp.ts). `MCP` is lazy — it tells a stranger
// what this place is before anybody has signed in — and `MCP_ASK` never does,
// so a host that decides whether a server needs OAuth by calling it with no
// credential and reading the status gets the 401 and its challenge instead of
// writing down "no auth" (T-34416). Here for the same reason PRICING is: the
// door and the page that teaches somebody to type it must say the same
// string, and pages.ts is identity.ts's, never the other way round.
export let MCP = `https://${PLATFORM}/mcp`
export let MCP_ASK = `${MCP}?auth=required`

// Where signing in happens — one email address and a six-digit code, and the
// same line for somebody who has never been here (signin.ts). It is here
// beside the other two for the same reason: everything that says it must say
// the same string, and the tools that name it in a refusal (tools.ts, anon.ts)
// cannot import identity.ts, which re-exports it, without dragging the
// runtime's own modules into a Deno test.
export let SIGN_IN = `https://${PLATFORM}/login`

// And what an agent's connector form asks for when it will not go and find it
// (T-34414): the authorization server's own addresses and the one scope.
// identity.ts CONFIGURES the provider with these, so they are the same strings
// the two `/.well-known` documents serve, and the connect page TYPES THEM OUT
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
// TWO labels deep on purpose. `route()` below reads everything before
// `.yaks.app` as a space slug, and `SLUG` admits no dot, so `x.y.yaks.app` is
// already outside the space namespace and no person can ever claim the space
// that would shadow our own origin. A one-label name (`origin.yaks.app`)
// would have needed a reserved-word list to hold that line, and a list is a
// thing to forget; the namespace's own shape does not forget.
//
// This is also the reason a domain mid-provisioning reaches the Worker at
// all instead of timing out (T-33036): the CNAME above and the `*/*` route
// mean traffic for ANY custom hostname on this zone arrives here, active or
// not — a visitor of a domain whose DNS, validation or certificate step has
// not finished yet used to get a raw 522 with nothing between them and it.
// index.ts `settling` is the branded page that answers there now.
export let ORIGIN = `origin.saas.${PLATFORM}`

// Where the app serving this request is mounted for the browser that asked:
// the prefix its pages resolve relative URLs against, and the address its own
// `/<app>/` would forward to. `/<app>/` normally, and `/` when a custom
// domain carried the request here — there the app IS the domain's root
// (index.ts `aimed`), even though the address the platform routes on names
// the app's prefix. The router sets this header on a request it rewrote
// itself and strips it off anything a client sent, so it is never a way to
// move an app's address from outside.
export let MOUNT = 'x-yak-mount'

export type Route = {
  // null at the apex
  space: string | null
  // null at a space's bare hostname, or when the first segment is no slug
  app: string | null
  // inside an app: '' for `/<app>` itself (the caller adds the slash), else
  // the path from its slash; at the apex or a bare space, the whole path
  path: string
}

export let SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/

let dev = (host: string) =>
  host == 'localhost' || host == '127.0.0.1' || host.endsWith('.localhost') ||
  host.endsWith('.workers.dev')

export let hostOf = (req: Request) => {
  let host = new URL(req.url).hostname.toLowerCase()
  return dev(host)
    ? (req.headers.get('x-yak-host') ?? host).toLowerCase()
    : host
}

// A hostname that is neither ours nor a dev host — someone else's domain,
// which the directory may know as a customer's (T-33037). Everything the
// platform already answers on is not foreign, so every route that exists
// today is decided before this is ever asked: the apex, a space, a dev host,
// and `x.y.yaks.app`, which was the apex before custom domains and still is.
export let foreign = (host: string) =>
  !dev(host) && host != PLATFORM && !host.endsWith(`.${PLATFORM}`)

// An address on the platform's own zone: https, and the apex or a hostname
// under it. It is what a sign-in may hand someone back to (T-32593) — a
// stranger's address is nowhere we send anyone, so it answers null and the
// caller goes home instead. Pure, like the rest of this file.
//
// A custom domain is deliberately NOT on the zone (T-33037). We serve it, but
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
export let onZone = (href: string) => {
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
      (host == PLATFORM || host.endsWith(`.${PLATFORM}`))
    ? url.href
    : null
}

export let route = (host: string, pathname: string): Route => {
  let space = host.endsWith(`.${PLATFORM}`)
    ? host.slice(0, -PLATFORM.length - 1)
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
// path. The whole rule in one idea: `/.well-known/` is where a site GRANTS
// AUTHORITY over its own name, and the name under `<space>.yaks.app` is ours
// — a space rents a label of our hostname, it does not own it.
//
// The test is NOT whether a file is host-scoped. `robots.txt` is host-scoped
// and stays the app's, deliberately: a robots file grants nobody anything,
// it is a preference about the site, and the site's face is the home app.
// The test is whether the file hands somebody a CAPABILITY over a name we
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
// The SAME files are the app's on a customer's own domain (`foreign`), by
// this idea rather than despite it: there the name is theirs, so the
// authority is theirs to grant. Proving domain control to a third party is
// exactly what `pki-validation` is for at Sectigo and DigiCert, Stripe asks
// for `apple-developer-merchantid-domain-association` before Apple Pay
// works, App Links, Universal Links, `security.txt`, WebFinger, Matrix
// delegation and fediverse verification all live here, and obtaining a
// certificate for your own domain is your own business. Nothing is reserved
// there, and there is no list of exceptions to keep: a path is the
// platform's when the platform has something to SERVE at it, and everything
// else falls through to the app. The apps-directory token is the shape of
// that — the apex has content at `/.well-known/openai-apps-challenge` and
// answers it (index.ts), while `/.well-known/anything-else` is nobody's and
// 404s. When Stripe or Apple Pay needs to answer somewhere, it will answer
// because it HAS content, not because a string was added to a table.
//
// Our own renewal of a customer's custom-hostname certificate is not at risk
// from that. This zone has a `*/*` Worker route (wrangler.toml, T-33036), and
// Cloudflare warns it can intercept a CA's request
// (developers.cloudflare.com/ssl/edge-certificates/changing-dcv-method/troubleshooting/).
// MEASURED 2026-09-03: with that route live and the Worker answering these
// paths itself, a probe hostname was attached as a custom hostname and
// ssl.com issued its certificate within a minute, while a request to
// `/.well-known/acme-challenge/x` on that hostname reached the Worker and got
// its soft 404. Cloudflare's edge answers the CA before the route ever runs.
// That measurement is also why the platform can answer its own 404 on our
// hostnames instead of passing a request through to a fallback origin that is
// deliberately originless (`AAAA 100::`).
export let platform = (host: string, pathname: string) =>
  !foreign(host) && pathname.startsWith('/.well-known/')

// The doors the graph answers at, read from the path a browser asked for:
// an app's `/<app>/api/…`, a front page's own `/api/…` (apps.ts `fetch`
// serves the home app everything no other app claims), and the connector at
// `/mcp`. Pages, files and images are deliberately NOT here — an app's bytes
// are the web's, and a cross-origin GET of one carries no `Origin` anyway.
// The shape over-reaches a little: a static asset at `/x/api/y` on the apex
// matches too, which costs nothing, since nothing a browser fetches
// cross-origin without CORS can read the answer either way.
//
// The drop door is here too (drop.ts, T-34230). It is not a graph door — it is
// a form a member posts a file to — but it CHANGES a space with nothing but
// the session cookie behind it, and sibling spaces are same-site, so a page in
// anybody's space could aim a form at anybody else's `/deploy` and the cookie
// would ride along. Same guard, same reason.
export let doorway = (pathname: string) =>
  pathname == '/mcp' || pathname == '/deploy' ||
  /^(?:\/[^/]+)?\/api\//.test(pathname)

// The browser's own word for the page that asked, against the hostname it
// asked AT. Every space is a subdomain of one registrable domain, so sibling
// spaces are SAME-SITE: `SameSite=Lax` does not keep the session cookie off a
// request one space's page aims at another's, and a websocket handshake is
// outside the same-origin policy altogether. This is the line that separates
// them, and it is the whole of it everywhere except the one door below, where
// the answer carries CORS headers precisely because no cookie was read.
//
// ABSENT is allowed on purpose. A browser sends `Origin` on every
// cross-origin fetch and on every handshake, so refusing only a MISMATCH
// closes the browser attack completely; curl, a server-to-server client and
// the kernel's own internal requests send none and have no page to be tricked
// through. Requiring the header would break them for no security at all.
//
// Hostname only: scheme and port differ between a dev host and the platform,
// and neither is what a space is isolated by.
export let sameOrigin = (host: string, origin: string | null) => {
  if (!origin) return true
  try {
    return new URL(origin).hostname.toLowerCase() == host.toLowerCase()
  } catch {
    // `Origin: null` — a sandboxed frame, an opaque origin — is a stranger.
    return false
  }
}

// The one door above that a stranger's page may reach anyway (T-33408), and
// the shape of the whole permission: the app's READ door, asked with GET, and
// answered as NOBODY — the router drops the request's credentials before it is
// served and sends `Access-Control-Allow-Origin: *` with no
// `Access-Control-Allow-Credentials` beside it, which is the browser's own
// guarantee that no cookie was used and none can be read (index.ts `cors`).
//
// It is safe because what `sameOrigin` closes is AMBIENT CREDENTIALS, not
// secrecy: a public app's rows already answer to anyone with curl, and the
// attack was the session cookie riding along on a request one space's page
// aimed at another's. Take the cookie away and the request is curl with a
// referrer. What the caller may then read is the app's own `access`, unchanged
// and decided downstream: `public` and `open` answer a stranger, `private`
// refuses one.
//
// WRITES are not here and must not be. An `open` app lets a stranger write —
// with the link, from its own page — and a cross-origin write is the forgery
// origin_test.ts fires. Nor is `/ws`, which is a read but carries the write
// grant on the same socket, nor `/graph`, `/me` or `/blob`: this is the door
// the answer is DATA at, and nothing else has asked to be shared.
//
// No preflight door is needed and none is built: a GET with no author-set
// headers is a CORS simple request, so the browser sends it and reads the
// answer with no `OPTIONS` in between. A client that adds a header would need
// one, and can ask for it when it exists.
export let shared = (method: string, pathname: string) =>
  (method == 'GET' || method == 'HEAD') &&
  /^(?:\/[^/]+)?\/api\/query$/.test(pathname)
