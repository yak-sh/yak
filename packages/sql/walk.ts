// The transitive walk compiled: `.requires[<=3]->T-42` becomes one recursive
// CTE, seeded at the target entity and stepped backward along the reference, so
// every step is an index seek on the step relation's own endpoint column rather
// than a scan. The default UNION deduplicates on id alone, so cycles terminate
// and a node reachable by two paths of different lengths is never expanded
// twice. The outer LIMIT stops the queue at the nearest WALK_LIMIT nodes,
// excluding the seed. Only an explicit depth cap in the query adds a depth
// column; its arithmetic then bounds the recursion.
//
// The only difference between the two kinds of walk is the STEP: the relation
// of `"from"`/`"to"` integer id pairs that one hop follows. For an edge-typed
// walk the step is the edge table narrowed to one edge type, which @yaks/edge
// supplies as an extension; for a column walk it is a component's reference
// column beside its owner column, which bind.ts supplies. Both end up here, so
// the CTE is written once.
//
//   ->  the candidate REACHES the target: seed the target, follow `to` → `from`
//   <-  the target reaches the candidate: seed the target, follow `from` → `to`

import { type Walk, WALK_LIMIT } from '@yaks/query'
import { type Cond, type Frag, raw } from './ir.ts'
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

/**
 * The set of reachable entities as a relation of one `id` column. Callers that
 * need the reached ids and callers that need a membership condition share this
 * one statement, including how the seed is resolved, how cycles are handled,
 * the explicit hop cap and the default row limit. `step` must project
 * `"from"`/`"to"` integer owner ids.
 */
export let walkRows = (c: Walk, step: string): Frag => {
  let [here, there] = c.dir == '->' ? ['to', 'from'] : ['from', 'to']
  let s = seed(c.target)
  let bounded = c.depth != null
  return {
    sql: `with recursive __walk(id${bounded ? ', depth' : ''}) as (` +
      ` select id${bounded ? ', 0' : ''} from entity where ${s.sql}` +
      ` union select d."${there}"${bounded ? ', __walk.depth + 1' : ''}` +
      ` from (${step}) d` +
      ` join __walk on d."${here}" = __walk.id` +
      (bounded ? ` where __walk.depth < ?` : '') +
      `) select id from __walk where ` +
      (bounded
        ? `depth > 0`
        : `id != (select id from entity where ${s.sql}) limit ?`),
    params: c.depth != null
      ? [...s.params, c.depth]
      : [...s.params, ...s.params, WALK_LIMIT],
  }
}

/**
 * The membership condition a walk compiles to: `owner in (<reachable ids>)`,
 * where `owner` is the SQL naming the candidate row's integer id.
 */
export let walkSql = (owner: string, c: Walk, step: string): Cond => {
  let rows = walkRows(c, step)
  return raw({ sql: `${owner} in (${rows.sql})`, params: rows.params })
}
