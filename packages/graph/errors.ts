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

/** A write that does not fit what the graph keeps: a component or property its
 * vocabulary does not declare, a value of the wrong type, a server-owned
 * property, a bundle of the wrong shape. The writer's code is wrong about the
 * words, which no rule chose, so it says `misfit` beside the refusal: a door
 * can tell a writer's mistake from a deliberate no (a name somebody holds, a
 * value a schema bounds). It is still a `Refused`, answered as one. */
export class Misfit extends Refused {
  misfit = true
}

/** Whether a refusal says the write did not fit the graph ({@link Misfit}),
 * thrown here or relayed from another door's answer.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * equal(misfit(new Misfit('book.pages is a number')), true)
 * equal(misfit(new Refused('the name is held')), false)
 * equal(misfit({ error: 'Refused', message: 'm', misfit: true }), true)
 * ```
 */
export let misfit = (refusal: unknown): boolean =>
  (refusal as { misfit?: unknown } | null)?.misfit === true

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
