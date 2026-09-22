// Who is writing. A client can put anything in the JSON it posts — including
// whose name is on it — so the request handler is the only place that can
// know. Every array of bundles that arrives here has its `$actor` component
// discarded and replaced by the identity the application's `authenticate`
// returned for this request. A client that sends `$actor: { by: 'someone
// else' }` is not refused; it is simply overwritten, because there is nothing
// to argue about: the graph stamps what reached it, and what reaches it is
// what this handler decided.
//
// An unauthenticated request writes with no actor at all — the changes are
// stored unattributed rather than attributed to a guess. An application that
// would rather refuse throws `Unauthorized` from its `authenticate`.

import type { Actor } from '@yaks/graph'

/**
 * How the application names the writer of a request: the actor making it, or
 * `null` for nobody. Throwing
 * {@link https://jsr.io/@yaks/api/doc/~/Unauthorized | Unauthorized} answers
 * the request with a 401.
 *
 * An actor is the pair a write is stamped with — `by` the identity it acts
 * for, and `via` whatever it came through: a session, a connector, or the
 * server itself. An application that knows only the identity returns only
 * `by`.
 *
 * It runs on every request the handler answers — a read, a write and a
 * WebSocket upgrade alike — so an application that restricts reads restricts
 * them here.
 *
 * ```ts
 * let authenticate = (request: Request) => {
 *   let key = request.headers.get('authorization')
 *   return key ? { by: memberOf(key) } : null
 * }
 * ```
 */
export type Authenticate = (
  request: Request,
) => Actor | null | Promise<Actor | null>

// The bundles signed by this handler: every bundle's `$actor` replaced by
// this writer, or removed when there is none. What a client sent is never
// kept. It is defined in @yaks/graph beside `land` — signing a write is a
// fact about a graph, not about HTTP — and re-exported here, where `/apply`
// reaches for it.
export { signed } from '@yaks/graph'
