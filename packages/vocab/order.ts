// Ordering is DERIVED, never hand-ranked. Component and stamped order are plain
// alphabetical; kindOrder is alphabetical refined by the local `before`
// constraints each kind declares, topologically sorted into one total order.
// This module owns that derivation so the runtime and any tool reproduce the
// same order — the order is a function of the vocabulary, not a stored rank.

// A priority topological sort: emit the alphabetically-smallest kind whose
// `before`-predecessors are all placed, so alphabetical is both the base order
// and the tiebreak. `before[k]` lists the kinds k sorts BEFORE (k precedes them).
// A `before` naming a kind this subset does not load is no constraint, so a
// document (mail's `before: doc`, canvas's `layout before doc`) composes in any
// subset. A cycle refuses — a stale order is silent corruption otherwise.
export let kindOrder = (
  kinds: string[],
  before: (k: string) => string[],
): string[] => {
  let ks = [...kinds].sort()
  let set = new Set(ks)
  // preds[x] = the kinds that must be placed before x
  let preds: Record<string, Set<string>> = {}
  for (let k of ks) preds[k] = new Set()
  for (let k of ks) {
    for (let x of before(k)) {
      if (!set.has(x)) continue // target absent from this subset: no constraint
      preds[x].add(k) // k before x ⇒ k is a predecessor of x
    }
  }
  let out: string[] = []
  let placed = new Set<string>()
  while (out.length < ks.length) {
    let ready = ks.find((k) =>
      !placed.has(k) && [...preds[k]].every((p) => placed.has(p))
    )
    if (!ready) throw new Error('cycle in kind `before` constraints')
    out.push(ready)
    placed.add(ready)
  }
  return out
}
