// A stateless version response through the public gateway. It loads no router
// or Durable Object, so an old object or a broken router cannot name the kernel.
export let DEPLOYMENT = '/_yak/version'
export let FRONT_VERSION = 'x-yak-front-version'

export let deployment = (
  req: Request,
  version?: { id?: string },
): Response | null =>
  (req.method == 'GET' || req.method == 'HEAD') &&
    new URL(req.url).pathname == DEPLOYMENT
    ? new Response(
      req.method == 'HEAD'
        ? null
        : JSON.stringify({ kernel: version?.id ?? null }),
      {
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        },
      },
    )
    : null
