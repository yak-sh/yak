import { type Eid, Refused } from '@yaks/graph'

/** A transcript API was given an eid that does not name a session. Writing
 * an entry to one is the caller's own mistake, refused like any other (a
 * door answers it, and a store's write log does not hold it as a failure). */
export class UnknownSession extends Refused {
  constructor(public session: Eid) {
    super(`unknown session ${session}`)
    this.name = 'UnknownSession'
  }
}
