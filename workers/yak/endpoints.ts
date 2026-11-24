// In-process HTTP routes share the caller's transport for every outside request.
// The host owns fetch. Every `endpoints` over one host shares one route table
// and one router, so two of them never route through each other: the router is
// installed while any route is open, and what it found in place is where every
// other request goes.
type Handler = (request: Request) => Response | Promise<Response>
type Host = { fetch: typeof fetch }

let ROUTER = Symbol('endpoints')
type Router = {
  routes: Map<string, Handler>
  outside: typeof fetch
  routed: typeof fetch
}

let router = (host: Host): Router => {
  let held = (host as Host & { [ROUTER]?: Router })[ROUTER]
  if (held) return held
  let routes = new Map<string, Handler>()
  let made: Router = {
    routes,
    outside: host.fetch,
    routed: (input, init) => {
      let request = new Request(input, init)
      let route = routes.get(new URL(request.url).origin)
      return route ? Promise.resolve(route(request)) : made.outside(request)
    },
  }
  Object.defineProperty(host, ROUTER, { value: made })
  return made
}

export let endpoints = (host: Host) => {
  let r = router(host)
  let open = (handler: Handler, domain = 'probe.invalid') => {
    if (!r.routes.size && host.fetch != r.routed) {
      r.outside = host.fetch
      host.fetch = r.routed
    }
    let url = `https://${crypto.randomUUID()}.${domain}`
    r.routes.set(url, handler)
    return {
      url,
      stop: () => {
        r.routes.delete(url)
        if (!r.routes.size && host.fetch == r.routed) host.fetch = r.outside
        return Promise.resolve()
      },
    }
  }
  return {
    open,
    at: (origin: string, request: Request) => {
      let route = r.routes.get(origin)
      if (!route) throw Error(`No in-process endpoint at ${origin}`)
      return Promise.resolve(route(request))
    },
  }
}
