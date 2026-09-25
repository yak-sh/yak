// `.order=hot`, the `rules` export (`@yaks/dreaming/rules`): the rank a recall
// decays along, as an @yaks/sql ORDER BY expression every read path consults.
//
// Every recall earns a day of stability and spacing multiplies it — the mean
// interval, in weeks — so the same count spread over months holds longer than
// an afternoon of cramming. The score falls off exponentially past the last
// recall against that stability, on (0,1]. An entity never recalled counts its
// own last touch (`updated.at`, else `created.at`) as one recall, so new
// things start hot and fade unless used. A retired project, and every entity
// filed under one, keeps its curve but sinks beneath live work: a tenth.
//
// The expression reads one owner through one correlated subquery, so the row
// being ordered and a `.after` cursor's anchor rank the same way. A component
// the vocabulary lacks is read as absent.

import {
  and,
  col,
  eq,
  exists,
  type Expr,
  type Extension,
  FALSE,
  fn,
  gt,
  iff,
  type Join,
  left,
  lit,
  neg,
  notNull,
  op,
  or,
  select,
  type Site,
  sub,
} from '@yaks/sql'

/** The ranking `.order=` names. */
export let HOT = 'hot'

/** What a retired project, and what is filed under one, is worth. */
export let SUNK = 0.1

let DAY = 86_400_000

// The Julian day an instant falls on, the unit SQLite's `julianday` reads.
let julian = (ms: number) => ms / DAY + 2440587.5

let warmth = (site: Site): Expr => {
  let v = site.vocab
  let joins: Join[] = []
  // One component joined by alias, or every column of it read as null.
  let read = (comp: string, alias: string) => {
    if (!v.comp(comp)) return () => lit(null)
    joins.push(
      left(site.from(comp, alias), eq(col('entity', alias), col('id', '__e'))),
    )
    return (prop: string) =>
      prop == 'entity' || v.prop(comp, prop) ? col(prop, alias) : lit(null)
  }
  let r = read('recall', '__r')
  let u = read('updated', '__u')
  let c = read('created', '__c')
  let p = read('project', '__p')
  let a = read('archived', '__a')
  let f = read('filed', '__f')
  let day = (e: Expr) => fn('julianday', e)
  let count = r('count')
  let lastAt = r('last_at')
  let recalled = and(gt(fn('coalesce', count, lit(0)), lit(0)), notNull(lastAt))
  let last = iff(recalled, lastAt, fn('coalesce', u('at'), c('at')))
  let n = iff(recalled, count, lit(1))
  let first = iff(recalled, fn('coalesce', r('first_at'), lastAt), last)
  let span = fn('max', lit(0), op('-', day(last), day(first)))
  let mean = iff(gt(n, lit(1)), op('/', span, op('-', n, lit(1))), lit(0))
  let age = fn('max', lit(0), op('-', lit(julian(site.now)), day(last)))
  let score = fn(
    'coalesce',
    fn(
      'exp',
      op('/', neg(age), op('*', n, op('+', lit(1), op('/', mean, lit(7))))),
    ),
    lit(0),
  )
  let under = v.comp('archived')
    ? exists(select({
      cols: [lit(1)],
      from: site.from('archived', '__x'),
      where: eq(col('entity', '__x'), f('project')),
    }))
    : FALSE
  let retired = and(notNull(p('entity')), notNull(a('entity')))
  let sunk = iff(or(retired, under), lit(SUNK), lit(1))
  // Warmest first: the ranking is negated, so a plain order ascends through
  // it and `.order=-hot` reads coldest first.
  return neg(sub(select({
    cols: [op('*', score, sunk)],
    from: site.from('entity', '__e'),
    joins,
    where: eq(col('id', '__e'), site.owner),
  })))
}

/** The `.order=hot` compiler. It claims no clause: a ranking only orders what
 * the rest of the query selected. */
export let extend = (): Extension[] => [{
  name: 'dreaming',
  compile: {},
  order: (value, site) => value == HOT ? warmth(site) : null,
}]
