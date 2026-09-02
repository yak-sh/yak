// Where a request is going, read from its hostname and path and nothing else
// (D-32318 §Routing). The apex `yaks.app` is the platform's own face;
// `<space>.yaks.app/<app>/…` is an app in a space. A dev host — wrangler dev's
// loopback, the workers.dev preview — serves as the apex, and only there does
// `x-yak-host` stand in for a hostname a test cannot send (fetch refuses a
// Host header): on the platform's own hostnames the header is ignored, so no
// client routes itself into a space by header. Pure: no env, no store.
export let PLATFORM = 'yaks.app'

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

// An address on the platform's own zone: https, and the apex or a hostname
// under it. It is what a sign-in may hand someone back to (T-32593) — a
// stranger's address is nowhere we send anyone, so it answers null and the
// caller goes home instead. Pure, like the rest of this file.
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
