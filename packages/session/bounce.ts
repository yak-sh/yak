// The two refusals. Both are shaped like every other refusal a graph throws —
// an Error with a name, a message, and the facts as fields — so a caller reads
// why rather than a translated summary of why, and a door can turn either into
// a status code without parsing prose.
//
// `Bounced` is the interesting one: it is also the input to the audit. The
// three eids it carries are exactly what the `conflict` record needs, so the
// refusal that rolls a batch back is the same value that writes the record of
// it once the rollback is done.

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
   * @param on the entity both runs wanted
   * @param loser the run whose take was refused
   * @param holder the run that already held the lock
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

/**
 * A stop aimed at a run that is not going. Stopping is a lever, not a note: it
 * may only be pulled on a run that is still there, so a stop for a run that
 * already ended (or was never seen) is refused rather than left lying around
 * as a request nothing will ever answer.
 */
export class NotRunning extends Error {
  /**
   * @param target the run the stop was aimed at
   * @param status what that run says it is, or `null` when it says nothing —
   * `undefined` when there is no such run at all
   */
  constructor(
    public target: Eid,
    public status: string | null | undefined,
  ) {
    super(
      `stop_request refused: ${target} is ${
        status === undefined ? 'gone' : status ?? 'not running'
      }`,
    )
    this.name = 'NotRunning'
  }
}
