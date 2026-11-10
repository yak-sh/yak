// The query half: the walk over a relation, which @yaks/sql cannot compile on
// its own because it follows links, supplied here as an
// {@link https://jsr.io/@yaks/sql | @yaks/sql} Extension.
//
//   `.cites[<=3]->p1`   the posts that reach p1 through at most 3 cites
//   `.cites<-p1`        what p1 reaches: everything it cites, transitively
//
// The walk is a filter, and @yaks/sql compiles it — one recursive CTE, seeded
// at the target and stepped along the arrow (`walk`). What that package
// cannot know is the step for a relation: which rows of the edge table carry
// the component a relation name refers to. Only the vocabulary knows that, so
// this extension supplies the step when the walk's path names a relation and
// returns null when it does not, leaving the binder to try the path as a
// reference property instead.
//
// A link is an entity, so a query reads links as rows (`.cites&.edge.from=p1`)
// with nothing from this module.
//
// This module assumes the storage layout @yaks/sql's SQLite dialect reads and
// @yaks/sqlite creates: an `entity` table of integer ids, one table per
// component keyed by an `entity` owner column, and a reference column holding
// the referenced entity's integer id.

import {
  as,
  at,
  eq,
  type Extension,
  join,
  type Query,
  select,
  table,
  walk,
} from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import { EDGE, linkable } from './relations.ts'

// The links of one relation, as the pairs of integer ids they join. Joining
// against the relation's own table is the filter, so there is no union and
// nothing for the planner to prefer over the endpoint seek.
let l = at('l')
let linked = (tag: string): Query =>
  select({
    cols: [as(l('from'), 'from'), as(l('to'), 'to')],
    from: table(EDGE, 'l'),
    joins: [join(table(tag, 't'), eq(at('t')('entity'), l('entity')))],
  })

/**
 * The @yaks/sql extension that compiles the walk over a relation: `compile(ast,
 * vocab, { extend: [traverse(vocab)] })`. It returns null when the vocabulary
 * has no `edge` component, or when the walk names a relation it does not
 * declare, and the walk then falls through to @yaks/sql's own
 * reference-property walk.
 */
export let traverse = (vocab: Vocab): Extension => {
  let rels = linkable(vocab)
  return {
    name: '@yaks/edge',
    compile: {
      walk: (clause, site) => {
        if (clause.kind != 'walk' || clause.path.length != 1) return null
        let t = rels[clause.path[0]]
        return t ? walk(site.owner, clause, linked(t)) : null
      },
    },
  }
}
