// The query half: the two clauses @yaks/sql cannot compile on its own because
// they follow links, supplied here as an
// {@link https://jsr.io/@yaks/sql | @yaks/sql} Extension.
//
//   `.cites[<=3]->p1`   the posts that reach p1 through at most 3 cites
//   `.cites<-p1`        what p1 reaches: everything it cites, transitively
//   `.edges[cites]`    return each result's links along with it
//
// The walk is a filter, and @yaks/sql compiles it — one recursive CTE, seeded
// at the target and stepped along the arrow (`walkSql`). What that package
// cannot know is the step for a relation: which rows of the edge table carry
// the component a relation name refers to. Only the vocabulary knows that, so
// this extension supplies the step when the walk's path names a relation and
// returns null when it does not, leaving the binder to try the path as a
// reference property instead.
//
// `.edges` is not a filter: it does not change which entities the query
// selects, it asks for their links to be returned alongside them. So it
// compiles to TRUE and the links are fetched by a separate read
// ({@link walk}). It still returns null for a relation the vocabulary does not
// declare, because a clause naming nothing is a typo, not a query that matches
// everything.
//
// This module assumes the storage layout @yaks/sql's SQLite dialect reads and
// @yaks/sqlite creates: an `entity` table of integer ids, one table per
// component keyed by an `entity` owner column, and a reference column holding
// the referenced entity's integer id.

import { type Extension, TRUE, walkSql } from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import { EDGE, relations } from './relations.ts'

let q = (name: string): string => `"${name.replaceAll('"', '""')}"`

// The links of one relation, as the pairs of integer ids they join. Joining
// against the relation's own table is the filter, so there is no union and
// nothing for the planner to prefer over the endpoint seek.
let linked = (tag: string): string =>
  `select l."from" as "from", l."to" as "to" from ${q(EDGE)} l` +
  ` join ${q(tag)} t on t.entity = l.entity`

/**
 * The @yaks/sql extension that compiles the traversal clauses: `compile(ast,
 * vocab, { extend: [traverse(vocab)] })`. Both return null when the vocabulary
 * has no `edge` component, or when they name a relation it does not declare —
 * the walk then falls through to @yaks/sql's own reference-property walk, and
 * `.edges` to its rejection.
 */
export let traverse = (vocab: Vocab): Extension => {
  let rels = relations(vocab)
  let tag = (name: string) => vocab.comp(EDGE) && rels[name]
  return {
    name: '@yaks/edge',
    compile: {
      walk: (clause, site) => {
        if (clause.kind != 'walk' || clause.path.length != 1) return null
        let t = tag(clause.path[0])
        return t ? walkSql(site.owner, clause, linked(t)) : null
      },
      edges: (clause) => {
        if (clause.kind != 'edges') return null
        if (clause.select && !tag(clause.select.type)) return null
        return vocab.comp(EDGE) ? TRUE : null
      },
    },
  }
}
