// The refusal, as a `precondition` hook: a board whose query would quietly
// match nothing.
//
// A board IS its query — membership is never stored — and that is what makes
// this worth a refusal. An empty board looks exactly like a board whose filter
// is right and whose answer happens to be nothing, so a typo in a query is
// invisible forever: no error, no empty state that says why, just a board that
// is always blank. The grammar and the vocabulary already know better, so the
// board is checked at the door, while whoever typed it is still there.
//
// Two ways a query is wrong, both caught in one walk over its clauses:
//
//   ROUTING   `.staus=open` names no column. The vocabulary refuses it.
//   MEMBERS   `.status=complete` names no status. The ladder refuses it.
//
// The second is the one a closed set buys: `complete` and `completed` and `done`
// are all plausible, exactly one is a status, and a query naming either of the
// others is indistinguishable from a board with nothing on it.
//
// The EMPTY query stays legal. It selects nothing on purpose — that is what a
// board nobody has written a filter for should show.
//
// Writing `task.status` itself needs no refusal here: it is declared
// `persist: false`, and @yaks/graph's `admit` phase drops a computed column
// before this hook ever sees the batch.
//
// It runs at `precondition`, inside the transaction and before a row has moved,
// so a refusal rolls the whole batch back — a batch is admitted entirely or not
// at all.

import type { Bundle, Comp, Hook } from '@yaks/graph'
import { comps, Refused } from '@yaks/graph'
import { parse, type Value } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'
import { type Mark, MARKS, statuses } from './words.ts'
import { BOARD, TASK } from './comp.ts'

// Every raw token a value names: a scalar is one, a list is its items, a range
// is its ends. A time phrase is nobody's enum member and is left alone.
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
 * Why this query cannot stand as a board's filter, or `null` when it can: every
 * predicate routes through the vocabulary, and every status it names is one the
 * ladder spells.
 *
 * ```ts
 * import { unroutable } from '@yaks/task'
 *
 * // unroutable('.status=open', vocab)     → null
 * // unroutable('.status=complete', vocab) → 'no such status: complete — …'
 * ```
 */
export let unroutable = (
  query: string,
  vocab: Vocab,
  marks: Mark[] = MARKS,
): string | null => {
  let known = statuses(marks)
  try {
    for (let c of parse(query).clauses) {
      if (c.kind != 'pred') continue
      let hops = vocab.aim(c.path.join('.'), c.op == '!' && c.path.length == 1)
      let last = hops[hops.length - 1]
      if (!last || last.comp != TASK || last.prop != 'status') continue
      // An empty value is the absence form (`.status=`), which names nothing.
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
 * The `precondition` hook: refuse a board whose query does not route, or which
 * names a status outside the closed set. Registered by
 * {@link https://jsr.io/@yaks/task/doc/~/tasks | tasks}; exported on its own for
 * a graph that wants the check without the vocabulary.
 */
export let guarding =
  (vocab: Vocab, marks: Mark[] = MARKS): Hook => (bundles) => {
    for (let b of bundles) {
      for (let [name, comp] of comps(b)) checked(b, name, comp, vocab, marks)
    }
    return bundles
  }

// One component patch of one bundle. A `null` comp is a drop, which states no
// query at all.
let checked = (
  b: Bundle,
  name: string,
  comp: Comp | null,
  vocab: Vocab,
  marks: Mark[],
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
