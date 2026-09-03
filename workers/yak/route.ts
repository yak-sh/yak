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
