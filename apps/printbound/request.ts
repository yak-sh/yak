/** Normalize the trusted app mount once, preserving bodies and the original
 * public address for links and payment returns. */
export let relative = (request: Request): Request => {
  let url = new URL(request.url)
  let mount = request.headers.get('x-yak-mount') ??
    `/${request.headers.get('x-yak-app') ?? ''}/`
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
    request.headers.get('x-yak-mount') ??
      `/${request.headers.get('x-yak-app') ?? ''}/`,
    request.headers.get('x-yak-address') ?? request.url,
  )
