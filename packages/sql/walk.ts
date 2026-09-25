// The transitive walk compiled: `.requires[<=3]->T-42` becomes one recursive
// CTE, seeded at the target entity and stepped backward along the reference, so
// every step is an index seek on the step relation's own endpoint column rather
// than a scan. The default union deduplicates on id alone, so cycles terminate
// and a node reachable by two paths of different lengths is never expanded
// twice. The outer limit stops the queue at the nearest WALK_LIMIT nodes,
// excluding the seed. Only an explicit depth cap in the query adds a depth
// column; its arithmetic then bounds the recursion.
//
// The only difference between the two kinds of walk is the step: the relation
// of `"from"`/`"to"` integer id pairs that one hop follows. For an edge-typed
// walk the step is the edge table narrowed to one edge type, which @yaks/edge
// supplies as an extension; for a reference walk it is a component's reference
// column beside its owner column, which bind.ts supplies. Both end up here, so
// the CTE is written once.
//
//   ->  the candidate reaches the target: seed the target, follow `to` → `from`
//   <-  the target reaches the candidate: seed the target, follow `from` → `to`

import { type Walk, WALK_LIMIT } from '@yaks/query'
import { type Expr, type Frag, type Query, raw } from './ast.ts'
import { render } from './render.ts'
import { identity } from './ident.ts'

// The seed: the target's row in the entity table, named by eid or by a
// human-readable id (`T-42` is the entity numbered 42 — @yaks/id), so one
// syntax serves both.
let seed = (target: string): Frag => {
  let id = identity('eid', target)
  if (!id) return { sql: 'eid = ?', params: [target] }
  let arms = [
    ...id.eids.map(() => 'eid = ?'),
    ...id.nums.map(() => 'num = ?'),
  ]
  return { sql: arms.join(' or '), params: [...id.eids, ...id.nums] }
}

// The set of reachable entities as a relation of one `id` column, with the
// seed resolved, cycles handled, the explicit hop cap and the default row
// limit. `step` projects `"from"`/`"to"` integer owner ids.
let reached = (c: Walk, step: Frag): Frag => {
  let [here, there] = c.dir == '->' ? ['to', 'from'] : ['from', 'to']
  let s = seed(c.target)
  let bounded = c.depth != null
  return {
    sql: `with recursive __walk(id${bounded ? ', depth' : ''}) as (` +
      ` select id${bounded ? ', 0' : ''} from entity where ${s.sql}` +
      ` union select d."${there}"${bounded ? ', __walk.depth + 1' : ''}` +
      ` from (${step.sql}) d` +
      ` join __walk on d."${here}" = __walk.id` +
      (bounded ? ` where __walk.depth < ?` : '') +
      `) select id from __walk where ` +
      (bounded
        ? `depth > 0`
        : `id != (select id from entity where ${s.sql}) limit ?`),
    params: c.depth != null
      ? [...s.params, ...step.params, c.depth]
      : [...s.params, ...step.params, ...s.params, WALK_LIMIT],
  }
}

/**
 * A walk as a condition on `owner`, the candidate row's integer id: it holds
 * for the rows `step` reaches from the walk's target. `step` selects one hop
 * as `"from"` and `"to"` integer ids — the edge table narrowed to one
 * relation, or a component's owner beside its reference column.
 */
export let walk = (owner: Expr, c: Walk, step: Query): Expr => {
  let o = render(owner)
  let rows = reached(c, render(step))
  return raw(`${o.sql} in (${rows.sql})`, [...o.params, ...rows.params])
}
