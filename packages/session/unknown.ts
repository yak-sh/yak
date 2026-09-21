import type { Eid } from '@yaks/graph'

/** A transcript API was given an eid that does not name a session. */
export class UnknownSession extends Error {
  constructor(public session: Eid) {
    super(`unknown session ${session}`)
    this.name = 'UnknownSession'
  }
}
