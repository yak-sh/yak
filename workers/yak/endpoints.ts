// In-process HTTP routes share the caller's transport for every outside request.
// The host owns fetch; its current transport is captured when routing starts.
type Handler = (request: Request) => Response | Promise<Response>

export let endpoints = (host: { fetch: typeof fetch }) => {
  let routes = new Map<string, Handler>()
  let outside: typeof fetch
  let routed: typeof fetch = (input, init) => {
    let request = new Request(input, init)
    let route = routes.get(new URL(request.url).origin)
    return route ? Promise.resolve(route(request)) : outside(input, init)
  }
  let open = (handler: Handler) => {
    if (!routes.size) {
      outside = host.fetch
      host.fetch = routed
    }
    let url = `https://${crypto.randomUUID()}.probe.invalid`
    routes.set(url, handler)
    return {
      url,
      stop: () => {
        routes.delete(url)
        if (!routes.size && host.fetch == routed) host.fetch = outside
        return Promise.resolve()
      },
    }
  }
  return {
    open,
    at: (origin: string, request: Request) => {
      let route = routes.get(origin)
      if (!route) throw Error(`No in-process endpoint at ${origin}`)
      return Promise.resolve(route(request))
    },
  }
}
