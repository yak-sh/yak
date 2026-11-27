// The refusals for a name a reader writes: one that means no word here, and
// a bare label that means several.

/** A name this vocabulary does not know. One error for every caller, raised
 * here because the vocabulary is what decides: `aim()` raises it for a name no
 * component declares (naming the closest that are, `unknownName`), for a
 * property named without its component (saying which components declare it,
 * `unqualified`), and for a component named
 * with a property it does not declare (saying which ones it does); the storage
 * binder (@yaks/sql) raises it when a presence test names a component it has
 * no table for. `prop` is the name, unadorned. */
export class Unknown extends Error {
  prop: string
  constructor(prop: string, message = `unknown prop: .${prop}`) {
    super(message)
    this.prop = prop
    this.name = 'Unknown'
  }
}

/** The refusal for a bare label that means several words where it is read:
 * it names each by its full label, and one to write: an app's where one is
 * among them, else the first. It is an `Unknown`, so a caller that skips or
 * refuses a name it cannot read does the same with it.
 *
 * ```ts
 * import { Ambiguous } from '@yaks/vocab'
 * import { equal } from '@yaks/testing'
 *
 * equal(
 *   new Ambiguous('cost', ['yourname/trip:cost', '@yaks/model:cost']).message,
 *   '.cost is ambiguous (@yaks/model:cost, yourname/trip:cost) — use ' +
 *     '.yourname/trip:cost',
 * )
 * ```
 */
export class Ambiguous extends Unknown {
  /** the full labels of the words it may mean */
  candidates: string[]
  constructor(label: string, candidates: string[]) {
    let all = candidates.toSorted()
    let use = all.find((c) => !c.startsWith('@')) ?? all[0]
    super(label, `.${label} is ambiguous (${all.join(', ')}) — use .${use}`)
    this.candidates = all
    this.name = 'Ambiguous'
  }
}
