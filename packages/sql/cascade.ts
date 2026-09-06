// The death cascade, compiled. A reference column declares in the vocabulary
// what happens to it when the entity it points AT dies — `cascade` kills the
// row's owner too, `detach` nulls the column, `release` drops the row — and
// @yaks/graph decides all of it. What it needs from a storage is the ANSWER to
// one question: given the entities this batch deleted, who else dies, and who
// has to let go?
//
// Walked, that question is a read per rung of the chain and another per soft
// column. Over a database on the far side of a network each of those is a
// round trip, so here it is a statement: a `with recursive` over the cascade
// columns, seeded with the named dead, that follows every reference backwards
// at once — a chain of any length for one ask.
//
// A STATEMENT, not necessarily one. Every backwards arm is a term of the same
// compound SELECT, and workerd caps a compound at five terms (./compound.ts).
// So the arms are grouped by table (a table's death columns are one arm, OR'd)
// and cut into statements of {@link ARMS}, each seeded the same way. A
// vocabulary {@link narrow} enough for one statement is answered whole; a wider
// one is asked in ROUNDS — each statement is transitive within its own tables,
// so the caller re-asks with what the last round turned up until nothing new
// comes back. Two rounds answer the ordinary cascade, however deep it runs.
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
import { type Arm, ARMS, arms, cut } from './compound.ts'
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
 * Is this vocabulary's whole cascade sayable in one statement? When it is, one
 * ask is the complete answer and {@link looseSql} can re-state the closure
 * inside itself; when it is not, the caller asks in rounds (see the header).
 */
export let narrow = (v: Vocab): boolean =>
  arms(v.deaths('cascade')).length <= ARMS

// The recursive CTE one statement opens with: the seed at depth 0, then this
// group's arms — the rows whose death column points at something already
// doomed. `union` both deduplicates and, with the saturating depth, terminates.
let closure = (eids: string[], group: Arm[], d: Dialect): Frag => ({
  sql: `with recursive ${W}("id", "depth") as (\n` +
    `  select "entity"."id", 0 from "entity"` +
    ` where "entity"."eid" in (${marks(eids.length)})\n` +
    group.map(([comp, props]) => {
      let own = d.ownerKey(comp)
      let hits = props.map((p) => `"${comp}"."${p}" = ${W}."id"`).join(' or ')
      return `  union select ${own}, min(${W}."depth" + 1, ${DEEP})` +
        ` from ${d.table(comp)}, ${W} where (${hits}) and ${alive(own)}\n`
    }).join('') + `)\n`,
  params: [...eids],
})

// The same name over a set already known: what a soft-reference statement
// stands on when the cascade was too wide to re-state (see {@link narrow}).
let named = (eids: string[]): Frag => ({
  sql: `with ${W}("id") as (` +
    `select "id" from "entity" where "eid" in (${marks(eids.length)}))\n`,
  params: [...eids],
})

/**
 * Everything that dies with these entities, the named ones included: one row
 * per casualty, with the eid, the spine number, and the rung it fell on. In
 * rung order, and within a rung in the order the entities were created, which
 * is the order the walk this replaces answered in.
 *
 * One statement when the vocabulary is {@link narrow}, and otherwise one per
 * group of arms — each a complete closure over ITS tables, to be re-asked with
 * what the others turned up until nothing new comes back.
 */
export let doomSql = (
  v: Vocab,
  eids: string[],
  d: Dialect = sqlite,
): Frag[] =>
  cut(arms(v.deaths('cascade')), ARMS).map((group) => {
    let head = closure(eids, group, d)
    return {
      sql: head.sql +
        `select ${E}."eid" as eid, ${E}."num" as num,` +
        ` min(${W}."depth") as depth` +
        ` from ${W} join "entity" ${E} on ${E}."id" = ${W}."id"` +
        ` group by ${W}."id" order by depth, ${W}."id"`,
      params: head.params,
    }
  })

/**
 * Every soft reference into the closure of these entities: a SURVIVOR's
 * `detach` or `release` column pointing at one of the dead, as (component,
 * column, owner). Empty when the vocabulary declares no soft reference at all.
 *
 * The closure is re-stated inside the statement when the vocabulary is
 * {@link narrow} — which is what lets it ride the same batch as
 * {@link doomSql}, before anyone has read the answer. When it is not, one
 * statement cannot say the closure, so what it is handed IS the set it answers
 * about: the caller passes a set already closed (the last round's, which added
 * nothing).
 *
 * The dead are excluded on purpose — a casualty's own tombstone already says
 * everything about it, so only a survivor is told to let go.
 */
export let looseSql = (
  v: Vocab,
  eids: string[],
  d: Dialect = sqlite,
): Frag[] => {
  let soft = [...v.deaths('release'), ...v.deaths('detach')]
  if (!soft.length) return []
  let head = () =>
    narrow(v) ? closure(eids, arms(v.deaths('cascade')), d) : named(eids)
  return cut(soft, ARMS).map((group) => {
    let open = head()
    return {
      sql: open.sql + group.map(([comp, prop]) => {
        let own = d.ownerKey(comp)
        return `select ? as comp, ? as prop, ${E}."eid" as eid,` +
          ` ${E}."id" as ord` +
          ` from ${d.table(comp)} join "entity" ${E} on ${E}."id" = ${own}` +
          ` where "${comp}"."${prop}" in (select "id" from ${W})` +
          ` and ${own} not in (select "id" from ${W}) and ${alive(own)}`
      }).join('\n union all ') + ` order by "ord"`,
      params: [...open.params, ...group.flat()],
    }
  })
}
