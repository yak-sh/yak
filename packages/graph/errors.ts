// Graph refusals and their public status, shared by readers and writers.
import type { Eid } from './bundle.ts'
import { token } from './sha256.ts'
export { STATUS, status } from './status.ts'

/** A refused graph operation: its message says what prevented it. */
export class Refused extends Error {
  /** @param message what prevented the requested operation */
  constructor(message: string) {
    super(message)
    this.name = 'Refused'
  }
}

/** A refused precondition: which property changed, and what it holds now. The
 * committed value is included so the caller can merge onto it. */
export class Stale extends Error {
  /** The token for the current value, ready for a merged replacement. */
  was: string | null

  /**
   * @param eid the entity whose property changed
   * @param comp the component it lives on
   * @param prop the property itself
   * @param current the value the graph holds now (`null` if it holds none)
   */
  constructor(
    public eid: Eid,
    public comp: string,
    public prop: string,
    public current: unknown,
  ) {
    super(
      `${comp}.${prop} of ${eid} has moved since it was read\n` +
        `current: ${JSON.stringify(current)}\nwas: ${token(current)}`,
    )
    this.was = token(current)
    this.name = 'Stale'
  }
}
