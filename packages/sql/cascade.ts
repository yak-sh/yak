// The death cascade, compiled. A reference column declares in the vocabulary
// what happens to it when the entity it points AT dies — `cascade` kills the
// row's owner too, `detach` nulls the column, `release` drops the row — and
// @yaks/graph decides all of it. What it needs from a storage is the ANSWER to
// one question: given the entities this batch deleted, who else dies, and who
// has to let go?
//
// Walked, that question is a read per rung of the chain and another per soft
// column. Over a database on the far side of a network each of those is a
// round trip, so here it is one statement: a `with recursive` over the cascade
// columns, seeded with the named dead, that follows every reference backwards
// at once. The second statement finds the soft references the same closure
// touches, and rides in the same batch — it re-states the CTE rather than
// waiting to be told what the first one found.
//
// The COUNT saturates where the walk would loop. A cycle among cascade columns
// (an entity that exists about an entity that exists about it) would grow the
// depth forever and never repeat a row, so the rung number stops climbing at
// {@link DEEP}: past that, a row already reached at that depth is a row the
// recursion has seen and `union` drops it. The SET is complete at any depth —
// only the count stops.
//
// This lives in @yaks/sql because @yaks/sqlite and @yaks/d1 are the same
// dialect and must not each write it; @yaks/graph never sees SQL at all, and a
// storage that cannot compile this (a map, a browser cache) is walked instead.

import type { Vocab } from '@yaks/vocab'
import type { Frag } from './ir.ts'
import { type Dialect, sqlite } from './sqlite.ts'

/** How far a cascade's rungs are COUNTED before the number saturates. Depth is
 * the order the casualties come back in, never a bound on who dies. */
export let DEEP = 32

// The CTE's name, and the alias the spine is read through. Both are spelled so
// no component can collide with them — a vocabulary owns every ordinary name.
let W = '"__doom"'
let E = '"__e"'

let marks = (n: number): string =>
  Array.from({ length: n }, () => '?').join(', ')

// A component row's owner is not in its grave. The membership guard @yaks/sql
// ANDs into every query, said against an owner column rather than the spine.
let alive = (owner: string): string =>
  `not exists (select 1 from "tombstone" where "tombstone"."entity" = ${owner})`

/**
 * The recursive CTE both statements open with: every entity that dies with the
 * named ones. The seed is the batch's own dead (depth 0); each arm follows one
 * `cascade` column backwards — the rows whose column points at something
 * already doomed — and `union` both deduplicates and, with the saturating
 * depth, terminates.
 */
let cte = (v: Vocab, eids: string[], d: Dialect): Frag => {
  let arms = v.deaths('cascade').map(([comp, prop]) => {
    let own = d.ownerKey(comp)
    return `  union select ${own}, min(${W}."depth" + 1, ${DEEP})` +
      ` from ${d.table(comp)}, ${W}` +
      ` where "${comp}"."${prop}" = ${W}."id" and ${alive(own)}\n`
  })
  return {
    sql: `with recursive ${W}("id", "depth") as (\n` +
      `  select "entity"."id", 0 from "entity"` +
      ` where "entity"."eid" in (${marks(eids.length)})\n` +
      arms.join('') + `)\n`,
    params: [...eids],
  }
}

/**
 * Everything that dies with these entities, the named ones included: one row
 * per casualty, with the eid, the spine number, and the rung it fell on. In
 * rung order, and within a rung in the order the entities were created, which
 * is the order the walk this replaces answered in.
 */
export let doomSql = (
  v: Vocab,
  eids: string[],
  d: Dialect = sqlite,
): Frag => {
  let head = cte(v, eids, d)
  return {
    sql: head.sql +
      `select ${E}."eid" as eid, ${E}."num" as num, min(${W}."depth") as depth` +
      ` from ${W} join "entity" ${E} on ${E}."id" = ${W}."id"` +
      ` group by ${W}."id" order by depth, ${W}."id"`,
    params: head.params,
  }
}

/**
 * Every soft reference into that same closure: a SURVIVOR's `detach` or
 * `release` column pointing at one of the dead, as (component, column, owner).
 * `null` when the vocabulary declares no soft reference at all, which is the
 * whole statement asked for nothing.
 *
 * The dead are excluded on purpose — a casualty's own tombstone already says
 * everything about it, so only a survivor is told to let go.
 */
export let looseSql = (
  v: Vocab,
  eids: string[],
  d: Dialect = sqlite,
): Frag | null => {
  let soft = [...v.deaths('release'), ...v.deaths('detach')]
  if (!soft.length) return null
  let head = cte(v, eids, d)
  let arms = soft.map(([comp, prop]) => {
    let own = d.ownerKey(comp)
    return `select ? as comp, ? as prop, ${E}."eid" as eid, ${E}."id" as ord` +
      ` from ${d.table(comp)} join "entity" ${E} on ${E}."id" = ${own}` +
      ` where "${comp}"."${prop}" in (select "id" from ${W})` +
      ` and ${own} not in (select "id" from ${W}) and ${alive(own)}`
  })
  return {
    sql: head.sql + arms.join('\n union all ') + ` order by "ord"`,
    params: [...head.params, ...soft.flat()],
  }
}
