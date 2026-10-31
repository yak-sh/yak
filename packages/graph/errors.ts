// Graph refusals and their public status, shared by readers and writers.
import type { Eid } from './bundle.ts'
import { token } from './sha256.ts'
export { STATUS, status } from './status.ts'

/** Where a refusal points: the entity as the batch named it (its `$alias`
 * when the batch made it), and the component and property at fault. A form
 * shows the refusal beside the field it is about. */
export type Where = { eid?: Eid; comp?: string; prop?: string }

/** A refused graph operation: its message says what prevented it, and
 * `eid`, `comp` and `prop` say where, when one entity's field is at fault.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * let no = new Refused('doc.title is required', { eid: '$1', comp: 'doc', prop: 'title' })
 * equal([no.eid, no.comp, no.prop], ['$1', 'doc', 'title'])
 * equal('eid' in new Refused('the name is held'), false)
 * ```
 */
export class Refused extends Error {
  declare eid?: Eid
  declare comp?: string
  declare prop?: string
  /**
   * @param message what prevented the requested operation
   * @param at the field it is about, when one is
   */
  constructor(message: string, at: Where = {}) {
    super(message)
    this.name = 'Refused'
    for (let [k, v] of Object.entries(at)) {
      if (v != null) Object.assign(this, { [k]: v })
    }
  }
}

/** Refuse a caller's unknown options before any work starts. */
export let knownOptions = (value: object, names: readonly string[]): void => {
  let unknown = Object.keys(value).filter((key) => !names.includes(key))
  if (unknown.length) {
    throw new Refused(
      `unknown option ${
        unknown.map((key) => JSON.stringify(key)).join(', ')
      }; options: ${names.join(', ')}`,
    )
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
