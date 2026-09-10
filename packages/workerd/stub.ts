// The other shape a Worker takes: the graph does not live in the Worker at
// all. A Durable Object is one graph's home — single-threaded, with its own
// SQLite and its own open sockets — so the Worker in front of it is a
// switchboard: work out WHICH graph this request is for, and hand the request
// to that object unopened.
//
// Unopened matters. The object runs the same `api()` handler, so a request
// forwarded whole arrives with its method, its path, its body and its
// `upgrade` header intact, and the socket the object answers with belongs to
// the client. Nothing here reads the graph.

/** A Durable Object stub: one object, reachable by fetch. */
export type Stub = {
  /** hand a request to the object and answer with its response */
  fetch(request: Request): Promise<Response>
}

/** A Durable Object namespace binding — the part of it a switchboard uses. */
export type Namespace = {
  /** the id of the object with this name, minted the same way every time */
  idFromName(name: string): unknown
  /** the stub for an id */
  get(id: unknown): Stub
}

/**
 * Hand a request to the Durable Object holding the named graph. The name is
 * the graph's identity — a shop's subdomain, a customer id, the first path
 * segment — and the same name always reaches the same object.
 *
 * ```ts
 * export default {
 *   fetch: (request: Request, env: { GRAPHS: Namespace }) =>
 *     forward(env.GRAPHS, new URL(request.url).hostname.split('.')[0], request),
 * }
 * ```
 */
export let forward = (
  ns: Namespace,
  name: string,
  request: Request,
): Promise<Response> => ns.get(ns.idFromName(name)).fetch(request)
