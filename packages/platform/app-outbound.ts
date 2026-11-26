import { apex, type Host } from './host.ts'
import { bearing, queryRequest } from './routes.ts'

export let upgrading = (req: Request): boolean =>
  req.headers.get('upgrade')?.toLowerCase() === 'websocket'

let CALLER = 'x-yak-outbound-caller'

type Outbound = {
  fetch(req: Request): Promise<Response>
  send(req: Request, caller: unknown): Promise<Response>
}

/** Attribute a platform request to the app named by the dispatch binding. */
export let appRequest = (req: Request, app: string): Request => {
  let headers = new Headers(req.headers)
  headers.set('cf-connecting-ip', app)
  return new Request(req, { headers })
}

/** A worker's Store read can use the query entrypoint. That entrypoint still
 * opens the grant and checks the app, reader and Store against the directory. */
export let appQuery = (
  req: Request,
  caller: unknown,
  env: Host,
): Request | null => {
  if (
    !caller || typeof caller != 'object' || !('app' in caller) ||
    typeof caller.app != 'string' || req.method != 'GET' || !bearing(req)
  ) {
    return null
  }
  let { protocol, hostname } = new URL(req.url)
  return protocol == 'https:' && hostname.endsWith(`.${apex(env)}`) &&
      queryRequest(req, env)
    ? appRequest(req, caller.app)
    : null
}

/** Carry an upgrade over the private service's HTTP interface. RPC cannot
 * serialize the WebSocket attached to a 101 response. */
export let outgoing = (
  req: Request,
  caller: unknown,
  service: Outbound,
): Promise<Response> => {
  if (!upgrading(req)) return service.send(req, caller)
  let headers = new Headers(req.headers)
  headers.set(CALLER, JSON.stringify(caller))
  return service.fetch(new Request(req, { headers }))
}

/** Unwrap the caller supplied by the outbound Worker.
 * Only its private service binding reaches this entrypoint. */
export let incoming = <T>(
  req: Request,
  serve: (req: Request, caller: T) => Promise<Response>,
): Promise<Response> => {
  let headers = new Headers(req.headers)
  let caller = headers.get(CALLER)
  if (!upgrading(req) || !caller) {
    return Promise.resolve(new Response(null, { status: 400 }))
  }
  headers.delete(CALLER)
  return serve(new Request(req, { headers }), JSON.parse(caller) as T)
}
