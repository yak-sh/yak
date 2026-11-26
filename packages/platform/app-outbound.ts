export let upgrading = (req: Request): boolean =>
  req.headers.get('upgrade')?.toLowerCase() === 'websocket'

let CALLER = 'x-yak-outbound-caller'

type Outbound = {
  fetch(req: Request): Promise<Response>
  send(req: Request, caller: unknown): Promise<Response>
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

/** Unwrap the caller supplied by the dispatch namespace's outbound Worker.
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
