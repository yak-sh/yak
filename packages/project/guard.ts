// The `precondition` hook that refuses a board whose query would quietly match
// nothing.
//
// A board is its query — membership is never stored — and that is what makes
// this worth refusing over. An empty board looks exactly like a board whose
// filter is right and whose answer happens to be nothing, so a typo in a query
// is invisible forever: no error, no empty state explaining itself, just a
// board that is always blank. The query grammar and the vocabulary already know
// better, so the board is checked as it is written, while whoever typed it is
// still there.
//
// Two ways a query is wrong, both caught in one walk over its clauses:
//
//   Routing   `.staus=open` names no property. The vocabulary refuses it.
//   Members   `.status=complete` names no status. The status set refuses it.
//
// The second is what a closed set of statuses buys: `complete` and `completed`
// and `done` are all plausible, exactly one is a status, and a query naming
// either of the others is indistinguishable from a board with nothing on it.
//
// The empty query stays legal. It selects nothing on purpose — that is what a
// board nobody has written a filter for should show.
//
// Writing `task.status` itself needs no refusal here: it is declared
// `computed: true`, and @yaks/graph's `admit` phase drops a computed property
// before this hook ever sees the write.
//
// The hook runs at `precondition`, inside the transaction and before any row
// has changed, so a refusal rolls the whole write back: the list of changes
// passed to `graph.apply()` is committed entirely or not at all.

import type { Bundle, Comp, Hook } from '@yaks/graph'
import { comps, Refused } from '@yaks/graph'
import { parse, type Value } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'
import { declared, type Mark, statuses, TASK } from '@yaks/task'
import { BOARD } from './comp.ts'

// Every raw token a value contains: a scalar is one, a list is its items, a
// range is its ends. A time phrase is nobody's enum member and is left alone.
let tokens = (v: Value | null): string[] =>
  !v
    ? []
    : v.kind == 'scalar'
    ? [v.raw]
    : v.kind == 'list'
    ? v.items.flatMap(tokens)
    : v.kind == 'range'
    ? [...tokens(v.lo), ...tokens(v.hi)]
    : []

/**
 * Returns why this query cannot stand as a board's filter, or `null` when it
 * can: every predicate must route through the vocabulary, and every status it
 * names must be one the status set contains.
 *
 * ```ts
 * import { unroutable } from '@yaks/project'
 *
 * // unroutable('.status=open', vocab)     → null
 * // unroutable('.status=complete', vocab) → 'no such status: complete — …'
 * ```
 */
export let unroutable = (
  query: string,
  vocab: Vocab,
  marks?: Mark[],
): string | null => {
  // Pass the marks and the status set is theirs; pass none and it is the one
  // the vocabulary declares, which is how a board in a graph that leases its
  // tasks knows `wip` without @yaks/project being told about @yaks/session.
  let known = marks ? statuses(marks) : declared(vocab)
  try {
    for (let c of parse(query).clauses) {
      if (c.kind != 'pred') continue
      let hops = vocab.aim(c.path.join('.'), c.op == '!' && c.path.length == 1)
      let last = hops[hops.length - 1]
      if (!last || last.comp != TASK || last.prop != 'status') continue
      // An empty value is the absence form (`!status`), which names nothing.
      for (let t of tokens(c.value).filter(Boolean)) {
        if (!known.includes(t)) {
          return `no such status: ${t} — this board knows ${known.join(', ')}`
        }
      }
    }
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

/**
 * The `precondition` hook: refuses a board whose query does not route, or which
 * names a status outside the closed set. Registered by
 * {@link https://jsr.io/@yaks/project/doc/~/projects | projects}; exported on
 * its own for a graph that wants the check without the rest of the plugin.
 */
export let guarding = (vocab: Vocab, marks?: Mark[]): Hook => (bundles) => {
  for (let b of bundles) {
    for (let [name, comp] of comps(b)) checked(b, name, comp, vocab, marks)
  }
  return bundles
}

// Checks one component of one bundle. A `null` component is a deletion, which
// carries no query at all.
let checked = (
  b: Bundle,
  name: string,
  comp: Comp | null,
  vocab: Vocab,
  marks?: Mark[],
): void => {
  if (!comp || name != BOARD || comp.query == null) return
  let why = unroutable(String(comp.query), vocab, marks)
  if (why) {
    throw new Refused(
      `board ${b.entity.eid} refused: ${why} — a board IS its query, so one ` +
        `that cannot be routed matches nothing and never says why`,
    )
  }
}
