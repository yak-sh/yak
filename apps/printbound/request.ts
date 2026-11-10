// Where the app is mounted: the platform's word for it, else under its own
// name, else at the root.
let mounted = (request: Request) => {
  let app = request.headers.get('x-yak-app')
  return request.headers.get('x-yak-mount') ?? (app ? `/${app}/` : '/')
}

/** Normalize the trusted app mount once, preserving bodies and the original
 * public address for links and payment returns. */
export let relative = (request: Request): Request => {
  let url = new URL(request.url)
  let mount = mounted(request)
  if (mount !== '/' && url.pathname === mount.replace(/\/$/, '')) {
    url.pathname = '/'
  } else if (url.pathname.startsWith(mount)) {
    url.pathname = '/' + url.pathname.slice(mount.length)
  }
  let result = new Request(url, request)
  result.headers.set('x-yak-address', request.url)
  return result
}

export let appBase = (request: Request): URL =>
  new URL(
    mounted(request),
    request.headers.get('x-yak-address') ?? request.url,
  )
