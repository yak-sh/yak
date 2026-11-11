// `.order=hot`, the `graph` export (`@yaks/dreaming/graph`): the rank a recall
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
// the vocabulary lacks is read as absent. A page in this order is looked for
// among the newest touches and the recalled first (`opening`), so it reads
// about a page rather than ranking the whole graph.

import {
  and,
  as,
  col,
  desc,
  eq,
  exists,
  type Expr,
  type Extension,
  FALSE,
  fn,
  from,
  gt,
  iff,
  type Join,
  left,
  lit,
  neg,
  notNull,
  op,
  or,
  type Select,
  select,
  type Site,
  sub,
  union,
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

// How many times a page's size of the newest touches it is looked for in.
let DEPTH = 4

// Where a page of the warmest lies (@yaks/sql `Lead`). A row never recalled
// ranks by its last touch alone, at most `exp(-age)` whatever it is filed
// under, and its touch is its `updated.at`, else its `created.at`. So a row
// outside the newest `m` of each holds a touch no newer than the later of the
// two cuts, and ranks no warmer than that touch would. The recalled rows can
// rank warmer than their touch, and they are few, so each of them leads.
let opening = (site: Site, n: number) => {
  let v = site.vocab
  let stamps = ['updated', 'created'].filter((c) => v.prop(c, 'at'))
  if (!stamps.length) return null
  let m = n * DEPTH
  // The newest `m` of a stamp, or the one they end at.
  let newest = (comp: string, cols: Expr[], end = false) =>
    select({
      cols,
      from: site.from(comp, '__n'),
      order: [desc(col('at', '__n'))],
      limit: lit(end ? 1 : m),
      ...end ? { offset: lit(m - 1) } : {},
    })
  let ids = (q: Select) => select({ cols: [col('id')], from: from(q) })
  let rows = stamps.map((comp) =>
    ids(newest(comp, [as(col('entity', '__n'), 'id')]))
  )
  if (v.comp('recall')) {
    rows.push(select({
      cols: [as(col('entity', '__n'), 'id')],
      from: site.from('recall', '__n'),
    }))
  }
  // The warmest a row past a cut can be; nothing is past a cut that falls
  // beyond the component's last row.
  let past = (comp: string) =>
    fn(
      'coalesce',
      fn(
        'exp',
        neg(fn(
          'max',
          lit(0),
          op(
            '-',
            lit(julian(site.now)),
            fn('julianday', sub(newest(comp, [col('at', '__n')], true))),
          ),
        )),
      ),
      lit(0),
    )
  let warmest = stamps.length > 1
    ? fn('max', ...stamps.map(past))
    : past(stamps[0])
  return { rows: union(...rows), floor: neg(warmest) }
}

/** The `.order=hot` compiler. It claims no clause: a ranking only orders what
 * the rest of the query selected. */
export let extend = (): Extension[] => [{
  name: 'dreaming',
  compile: {},
  order: (value, site) => value == HOT ? warmth(site) : null,
  lead: (value, site, n) => value == HOT ? opening(site, n) : null,
}]
