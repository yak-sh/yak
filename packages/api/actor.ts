// Who is writing. A bundle can SAY anything — including whose name is on it —
// so the door is the only place that can know. Every batch that arrives here
// has its `$actor` component thrown away and replaced by the identity the
// host's `authenticate` returned for THIS request. A client that sends
// `$actor: { by: 'someone-else' }` is not refused; it is simply overwritten,
// because there is nothing to argue about: the graph stamps what reached it,
// and what reaches it is what the door decided.
//
// An unauthenticated request writes with no actor at all — the batch lands
// unattributed rather than attributed to a guess. A door that would rather
// refuse throws `Unauthorized` from its `authenticate`.

import type { Bundle, Change, Entity } from '@yaks/graph'

/**
 * How the host names the writer of a request: the entity making it, or `null`
 * for nobody. Throwing {@link https://jsr.io/@yaks/api/doc/~/Unauthorized |
 * Unauthorized} refuses the request with a 401.
 *
 * It runs on EVERY request the handler answers — a read, a write and a socket
 * upgrade alike — so a door that gates reads gates them here.
 *
 * ```ts
 * let authenticate = (request: Request) => {
 *   let key = request.headers.get('authorization')
 *   return key ? { eid: memberOf(key) } : null
 * }
 * ```
 */
export type Authenticate = (
  request: Request,
) => Entity | null | Promise<Entity | null>

/**
 * A batch signed by the door: every bundle's `$actor` replaced by this writer,
 * or removed when there is none. What a client sent is never kept.
 */
export let signed = (change: Change, who: Entity | null): Change =>
  change.map((b) => {
    let out: Bundle = { ...b }
    delete out.$actor
    if (who) out.$actor = { by: who.eid }
    return out
  })
