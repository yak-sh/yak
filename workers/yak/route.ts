// Where a request is going, read from its hostname and path and nothing else
// (D-32318 §Routing). The apex `yaks.app` is the platform's own face;
// `<space>.yaks.app/<app>/…` is an app in a space. A dev host — wrangler dev's
// loopback, the workers.dev preview — serves as the apex, and only there does
// `x-yak-host` stand in for a hostname a test cannot send (fetch refuses a
// Host header): on the platform's own hostnames the header is ignored, so no
// client routes itself into a space by header. Pure: no env, no store.
export let PLATFORM = 'yaks.app'

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
export let doorway = (pathname: string) =>
  pathname == '/mcp' || /^(?:\/[^/]+)?\/api\//.test(pathname)

// The browser's own word for the page that asked, against the hostname it
// asked AT. Every space is a subdomain of one registrable domain, so sibling
// spaces are SAME-SITE: `SameSite=Lax` does not keep the session cookie off a
// request one space's page aims at another's, and a websocket handshake is
// outside the same-origin policy altogether. This is the line that separates
// them, and it is the whole of it — we send no CORS headers, so nothing a
// browser is allowed to read here was ever cross-origin.
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
