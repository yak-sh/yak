// The denial. It is shaped like every other error a graph throws — an Error
// with a name, a message, and the facts as fields — so it reaches a client
// through @yaks/api's `refusal()` intact and a caller reads the facts rather
// than a translated summary of them.
//
// What it reports is deliberately the same to a stranger and to a member who is
// merely not allowed: which act, which app, and which level would have been
// enough. What it does NOT report is whether the app exists, or who else may
// reach it — a private app is its owner's to disclose. A caller that would
// rather tell a stranger nothing at all still can: this carries the facts, and
// what to put in the response is the caller's decision.

import type { Eid } from '@yaks/graph'
import type { Level } from './words.ts'

/** An act the principal is not allowed to perform. The HTTP status is 403 when
 * somebody is signed in and 401 when nobody is — which the HTTP layer knows and
 * this error does not, so it carries the facts and leaves that choice there. */
export class Denied extends Error {
  /**
   * @param actor who was acting, or `null` for an anonymous request
   * @param app the app whose access rules refused it
   * @param need the least level that would have been enough
   * @param act which of the two rules refused it (default: `write`)
   */
  constructor(
    public actor: Eid | null,
    public app: Eid,
    public need: Level,
    public act: 'read' | 'write' = 'write',
  ) {
    super(
      `${actor ?? 'nobody'} may not ${act} ${app} — ${need} is the least ` +
        `that may`,
    )
    this.name = 'Denied'
  }
}
