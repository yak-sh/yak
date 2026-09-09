// The refusal. Shaped like every other refusal a graph throws — an Error with a
// name, a message, and the facts as fields — so a caller reads why rather than
// a translated summary of why, and a door can turn it into a status code
// without parsing prose.
//
// It is also the input to the audit: the three eids it carries are exactly
// what the `conflict` record needs, so the refusal that rolls a batch back is
// the same value that writes the record of it once the rollback is done.

import type { Eid } from '@yaks/graph'

/**
 * A lock somebody else holds. The take is refused and the whole batch rolls
 * back: a lock is a lease, not a patch, so the way to get one is to wait for
 * the holder to let go — never to write over them.
 *
 * The three eids are the audit: `@yaks/session`'s `audit` hook turns a thrown
 * `Bounced` into a `conflict` record after the rollback.
 */
export class Bounced extends Error {
  /**
   * @param on the entity both sessions wanted
   * @param loser the session whose take was refused
   * @param holder the session that already held the lock
   */
  constructor(
    public on: Eid,
    public loser: Eid,
    public holder: Eid,
  ) {
    super(`${on} is already claimed by ${holder}`)
    this.name = 'Bounced'
  }
}
