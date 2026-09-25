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
// the vocabulary lacks is read as absent. `now` is written in as a number,
// since an ORDER BY binds no parameters.

import type { Extension, Site } from '@yaks/sql'

/** The ranking `.order=` names. */
export let HOT = 'hot'

/** What a retired project, and what is filed under one, is worth. */
export let SUNK = 0.1

let DAY = 86_400_000

// The Julian day an instant falls on, the unit SQLite's `julianday` reads.
let julian = (ms: number) => ms / DAY + 2440587.5

let warmth = (site: Site): string => {
  let { dialect: d, vocab: v } = site
  let src = (comp: string) => d.source?.(comp) ?? d.table(comp)
  let joins: string[] = []
  // One component joined by alias, or every column of it read as null.
  let col = (comp: string, alias: string) => {
    if (!v.comp(comp)) return () => 'null'
    joins.push(
      `left join ${src(comp)} "${alias}" on "${alias}"."entity" = "__e"."id"`,
    )
    return (prop: string) =>
      prop == 'entity' || v.prop(comp, prop) ? `"${alias}"."${prop}"` : 'null'
  }
  let r = col('recall', '__r')
  let u = col('updated', '__u')
  let c = col('created', '__c')
  let p = col('project', '__p')
  let a = col('archived', '__a')
  let f = col('filed', '__f')
  let when = (cond: string, then: string, or: string) =>
    `(case when ${cond} then ${then} else ${or} end)`
  let count = r('count')
  let lastAt = r('last_at')
  let recalled = `(coalesce(${count}, 0) > 0 and ${lastAt} is not null)`
  let last = when(recalled, lastAt, `coalesce(${u('at')}, ${c('at')})`)
  let n = when(recalled, count, '1')
  let first = when(recalled, `coalesce(${r('first_at')}, ${lastAt})`, last)
  let span = `max(0, julianday(${last}) - julianday(${first}))`
  let mean = when(`${n} > 1`, `${span} / (${n} - 1)`, '0')
  let age = `max(0, ${julian(site.now)} - julianday(${last}))`
  let score = `coalesce(exp(-${age} / (${n} * (1 + ${mean} / 7))), 0)`
  let under = v.comp('archived')
    ? `exists (select 1 from ${src('archived')} "__x" ` +
      `where "__x"."entity" = ${f('project')})`
    : 'false'
  let retired = `(${p('entity')} is not null and ${a('entity')} is not null)`
  let sunk = when(`${retired} or ${under}`, String(SUNK), '1')
  // Warmest first: the ranking is negated, so a plain order ascends through
  // it and `.order=-hot` reads coldest first.
  return `-(select ${score} * ${sunk} from ${d.spine} "__e" ${
    joins.join(' ')
  } where "__e"."id" = ${site.owner})`
}

/** The `.order=hot` compiler. It claims no clause: a ranking only orders what
 * the rest of the query selected. */
export let extend = (): Extension[] => [{
  name: 'dreaming',
  compile: {},
  order: (value, site) => value == HOT ? warmth(site) : null,
}]
