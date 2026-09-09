// The transitive walk compiled: `.requires[<=3]->T-42` is one recursive CTE,
// seeded at the target and stepped backward along the arrow, so every step is
// a seek on the STEP relation's own endpoint column rather than a scan. The
// depth cap is the recursion's own guard — a cycle terminates by arithmetic,
// not by luck — and `depth > 0` excludes the target itself: reaching is at
// least one hop.
//
// What differs between the two walk shapes is only the STEP: the relation of
// `"from"`/`"to"` integer-id pairs one hop follows. An edge-typed walk's step
// is the edge table narrowed to one tag (@yaks/edge supplies it through the
// extension seam); a column walk's step is a component's own reference column
// beside its owner (bind.ts supplies it). Both land here, so the CTE is written
// once.
//
//   ->  the candidate REACHES the target: seed the target, follow `to` → `from`
//   <-  the target reaches the candidate: seed the target, follow `from` → `to`

import type { Walk } from '@yaks/query'
import { type Cond, type Frag, raw } from './ir.ts'
import { identity } from './ident.ts'

// The seed: the target's spine row, named by eid or by human id (`T-42` is the
// entity numbered 42 — @yaks/id), so one spelling serves both.
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
 * The membership condition a walk compiles to: `owner in (<closure>)`, where
 * `owner` is the SQL naming the candidate row's integer id and `step` is a SQL
 * relation with `"from"` and `"to"` columns — one hop, as integer ids.
 */
export let walkSql = (owner: string, c: Walk, step: string): Cond => {
  let [here, there] = c.dir == '->' ? ['to', 'from'] : ['from', 'to']
  let s = seed(c.target)
  return raw({
    sql: `${owner} in (with recursive __walk(id, depth) as (` +
      ` select id, 0 from entity where ${s.sql}` +
      ` union select d."${there}", __walk.depth + 1 from (${step}) d` +
      ` join __walk on d."${here}" = __walk.id` +
      ` where __walk.depth < ?` +
      `) select id from __walk where depth > 0)`,
    params: [...s.params, c.depth],
  })
}
