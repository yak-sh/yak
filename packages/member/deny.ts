// The refusal. It is shaped like every other refusal a graph throws — an
// Error with a name, a message, and the facts as fields — so it reaches a
// client through @yaks/api's `refusal()` intact, and a caller reads why rather
// than a translated summary of why.
//
// What it says is deliberately the same to a stranger and to a member who is
// merely not allowed: which app, and what would have been enough. What it does
// NOT say is whether the app exists, or who else may reach it — a private app
// is its owner's to disclose, so the door answers a refused read with the same
// nothing a wrong address gets, and only a refused WRITE gets this.

import type { Eid } from '@yaks/graph'
import type { Level } from './words.ts'

/** A write the actor may not make. The status a door answers with is 403 when
 * somebody is signed in and 401 when nobody is — which the door knows and this
 * error does not, so it carries the facts and leaves the choice there. */
export class Denied extends Error {
  /**
   * @param actor who was writing, or `null` for nobody at all
   * @param app the app whose access said no
   * @param need the least level that would have been enough
   */
  constructor(
    public actor: Eid | null,
    public app: Eid,
    public need: Level,
  ) {
    super(
      `${actor ?? 'nobody'} may not write ${app} — ${need} is the least that ` +
        `may`,
    )
    this.name = 'Denied'
  }
}
