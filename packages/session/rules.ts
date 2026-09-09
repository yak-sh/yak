// The native rules: what a batch may say about a transcript, checked inside the
// transaction before anything moves.
//
// A `fork.from` names an entry that exists. A `using` names a provider and a
// model that exist. Both are references, so the vocabulary already refuses a
// dangling id at the engine on SQLite; this hook says WHY in words, and holds
// on a store with no foreign keys (@yaks/ram, a browser tab). A referent
// minted in the same batch counts: the batch is the world as it will be.
//
// `session.rewind` — when a claimed task settles, mint the forks that continue
// on the parent task and on each open unclaimed child — belongs here as a
// Rule, in-transaction, but it reads `claim` and the task tree, which this
// package does not know. It is registered where @yaks/task and @yaks/session
// meet (TODO T-35021: rules.ts `rewind`, once `session.status` can be read
// in a rule's match).

import type { Bundle, Comp, Hook } from '@yaks/graph'
import { then } from '@yaks/graph'
import { MODEL, PROVIDER } from '@yaks/model'
import { ENTRY, FORK, USING } from './native.ts'

/** A reference in a native comp named something that is not what it must be. */
export class Unnamed extends Error {
  constructor(public comp: string, public column: string, public eid: string) {
    super(`${comp}.${column} names ${eid}, which is not a ${column}`)
    this.name = 'Unnamed'
  }
}

let ref = (b: Bundle, comp: string, col: string) => {
  let v = (b[comp] as Comp | null | undefined)?.[col]
  return v == null ? undefined : String(v)
}

// [comp, column, eid, the comp the referent must wear]
type Check = [string, string, string, string]

let checks = (b: Bundle): Check[] => {
  let out: Check[] = []
  let from = ref(b, FORK, 'from')
  if (from) out.push([FORK, 'from', from, ENTRY])
  let provider = ref(b, USING, PROVIDER)
  if (provider) out.push([USING, PROVIDER, provider, PROVIDER])
  let model = ref(b, USING, MODEL)
  if (model) out.push([USING, MODEL, model, MODEL])
  return out
}

/** The precondition: every `fork.from` is an entry; every `using.provider` is a
 * provider and `using.model` a model — in the graph, or in this batch. */
export let naming: Hook = (bundles, tx) => {
  let all = bundles.flatMap(checks)
  if (!all.length) return bundles
  let inBatch = (eid: string, comp: string) =>
    bundles.some((b) => b.entity.eid == eid && comp in b)
  let asked = all.filter(([, , eid, comp]) => !inBatch(eid, comp))
  if (!asked.length) return bundles
  return then(tx.get(asked.map(([, , eid]) => eid)), (found) => {
    for (let [comp, col, eid, must] of asked) {
      let hit = found.find((b) => b.entity.eid == eid)
      if (!hit || !(must in hit)) throw new Unnamed(comp, col, eid)
    }
    return bundles
  })
}
