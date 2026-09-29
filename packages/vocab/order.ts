// Ordering is derived, never hand-ranked. Component and stamped order are plain
// alphabetical; kindOrder is alphabetical refined by the local `before`
// constraints each kind declares, topologically sorted into one total order.
// This module owns that derivation so the runtime and any tool reproduce the
// same order — the order is computed from the vocabulary, not stored as a rank.
//
// A kind that is a mark (it records something that happened to an entity: a
// memory marks the words somebody said) says what happened to an entity, never
// what the entity is. So it follows every kind it does not sort before: a
// comment marked as a memory is still a comment, and a doc that is nothing but
// a memory is a memory.

// A priority topological sort: emit the alphabetically-smallest kind whose
// `before`-predecessors are all placed, so alphabetical is both the base order
// and the tiebreak. `before[k]` lists the kinds k sorts before (k precedes them).
// A `before` naming a kind this subset does not load is no constraint, so a
// document (mail's `before: doc`, canvas's `layout before doc`) composes in any
// subset. A cycle throws — a stale order is silent corruption otherwise.
/**
 * ```ts
 * let before = (k: string) => k == 'memory' ? ['doc'] : []
 * kindOrder(['doc', 'memory', 'task'], before)
 * // ['memory', 'doc', 'task']
 * kindOrder(['doc', 'memory', 'task'], before, (k) => k == 'memory')
 * // ['task', 'memory', 'doc']
 * ```
 */
export let kindOrder = (
  kinds: string[],
  before: (k: string) => string[],
  mark: (k: string) => boolean = () => false,
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
  // Every kind a mark does not sort before, directly or through another, is
  // placed ahead of it; those it does sort before stay behind it, so no cycle
  // is added.
  let behind = (k: string, seen = new Set<string>()): Set<string> => {
    for (let x of before(k)) {
      if (set.has(x) && !seen.has(x)) behind(x, seen.add(x))
    }
    return seen
  }
  for (let m of ks.filter(mark)) {
    let after = behind(m)
    for (let k of ks) if (k != m && !mark(k) && !after.has(k)) preds[m].add(k)
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
