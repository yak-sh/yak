// The query half: the two clauses @yaks/sql declines on its own because they
// walk links, compiled here as an {@link https://jsr.io/@yaks/sql | @yaks/sql}
// Extension.
//
//   `.reaches[cites,<=3]=p1`   the posts that reach p1 through at most 3 cites
//   `.edges[cites]!`           carry the incident links back with the answer
//
// `.reaches` is a filter, and it is the one that needs SQL: a bounded
// transitive closure is a recursive CTE, walked BACKWARD from the target so
// every step is an index seek on the edge's own `to` column rather than a scan.
// The depth cap is the recursion's own guard, so a cycle terminates by
// arithmetic and not by luck. `depth > 0` excludes the target itself —
// reaching is at least one hop.
//
// `.edges` is a RIDER, not a filter: it does not change which entities the
// query selects, it asks for their links to be delivered beside them. So it
// compiles to TRUE and the delivery is a read of its own ({@link walk}). It
// still declines a relation the vocabulary does not declare, because a rider
// naming nothing is a typo, not a query that matches everything.
//
// This module assumes the storage layout @yaks/sql's SQLite dialect reads and
// @yaks/sqlite builds: an `entity` spine of integer ids, one table per
// component keyed by an `entity` owner column, and a reference column holding
// the referent's integer id.

import { type Extension, raw, TRUE } from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import { EDGE, relations } from './relations.ts'

let q = (name: string): string => `"${name.replaceAll('"', '""')}"`

// The link store as one relation: every edge wearing this tag, as the pair of
// integer ids it joins. The tag component IS the type test, so there is no
// union and nothing for the planner to prefer over the endpoint seek.
let linked = (tag: string): string =>
  `select l."from" as "from", l."to" as "to" from ${q(EDGE)} l` +
  ` join ${q(tag)} t on t.entity = l.entity`

/**
 * The @yaks/sql extension that compiles the traversal clauses:
 * `compile(ast, vocab, { extend: [traverse(vocab)] })`. Both clauses decline
 * (leaving @yaks/sql to refuse them as unsupported) when the vocabulary has no
 * `edge` component, or when they name a relation it does not declare.
 */
export let traverse = (vocab: Vocab): Extension => {
  let rels = relations(vocab)
  let tag = (name: string) => vocab.comp(EDGE) && rels[name]
  return {
    name: '@yaks/edge',
    compile: {
      reaches: (clause, site) => {
        if (clause.kind != 'reaches') return null
        let t = tag(clause.edgeType)
        if (!t) return null
        return raw({
          sql: `${site.owner} in (with recursive __reach(id, depth) as (` +
            ` select id, 0 from entity where eid = ?` +
            ` union select d."from", __reach.depth + 1 from (${linked(t)}) d` +
            ` join __reach on d."to" = __reach.id` +
            ` where __reach.depth < ?` +
            `) select id from __reach where depth > 0)`,
          params: [clause.target, clause.depth],
        })
      },
      edges: (clause) => {
        if (clause.kind != 'edges') return null
        if (clause.select && !tag(clause.select.type)) return null
        return vocab.comp(EDGE) ? TRUE : null
      },
    },
  }
}
