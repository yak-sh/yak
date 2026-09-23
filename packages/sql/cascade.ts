// The death cascade, compiled. A reference property declares in the vocabulary
// what happens to it when the entity it points at is deleted — `cascade`
// deletes the row's owner too, `detach` sets the column to NULL, `release`
// deletes the row — and @yaks/graph decides all of it. What it needs from a
// storage backend is the answer to one question: given the entities this
// transaction deleted, which others are deleted with them, and which surviving
// rows have to drop a reference?
//
// Walked, that question is one read per rung of the chain, and another per soft
// reference property. Against a database across a network each of those is a
// round trip, so here it is a statement instead: a `with recursive` over the
// cascade columns, seeded with the entities named as deleted, that follows
// every reference backwards at once — a chain of any length in one query.
//
// A statement, but not necessarily one statement. Every backward term is a term
// of the same compound SELECT, and workerd limits a compound SELECT to five
// terms (./compound.ts). So the terms are grouped by table (a table's death
// columns become one term, combined with OR) and cut into statements of
// {@link ARMS} terms each, all seeded the same way. A vocabulary {@link narrow}
// enough to fit in one statement is answered whole; a wider one is asked in
// rounds — each statement is transitive within its own tables, so the caller
// re-asks with whatever the last round turned up until nothing new comes back.
// Two rounds answer the ordinary cascade, however deep it runs.
//
// The depth count stops climbing where the walk would otherwise loop. A cycle
// among cascade properties (an entity that exists to describe an entity that
// exists to describe it) would increase the depth forever and never repeat a
// row, so the rung number saturates at {@link DEEP}: past that, a row already
// reached at that depth is a row the recursion has seen, and `union` drops it.
// The set of entities is complete at any depth — only the count stops.
//
// This lives in @yaks/sql because @yaks/sqlite and @yaks/d1 share one dialect
// and must not each write it; @yaks/graph never sees SQL at all, and a storage
// backend that cannot compile this (a map, a browser cache) is walked
// instead.

import type { Vocab } from '@yaks/vocab'
import { type Arm, ARMS, arms, cut } from './compound.ts'
import type { Frag } from './ir.ts'
import { type Dialect, sqlite } from './sqlite.ts'

/** How far a cascade's rungs are counted before the number stops climbing.
 * Depth only decides the order the deleted entities come back in; it never
 * limits which ones are deleted. */
export let DEEP = 32

// The CTE's name, and the alias the entity table is read through. Both are
// named so that no component can collide with them — a vocabulary owns every
// ordinary name.
let W = '"__doom"'
let E = '"__e"'

let marks = (n: number): string =>
  Array.from({ length: n }, () => '?').join(', ')

// The component row's owner has not been deleted. This is the same condition
// @yaks/sql ANDs into every query, written against an owner column rather than
// against the entity table.
let alive = (owner: string): string =>
  `not exists (select 1 from "tombstone" where "tombstone"."entity" = ${owner})`

/**
 * Does this vocabulary's whole cascade fit in one statement? When it does, one
 * query is the complete answer and {@link looseSql} can restate the closure
 * inside itself; when it does not, the caller asks in rounds (see the header).
 */
export let narrow = (v: Vocab): boolean =>
  arms(v.deaths('cascade')).length <= ARMS

// The recursive CTE one statement opens with: the seed at depth 0, then this
// group's terms — the rows whose death column points at something already
// marked for deletion. `union` both deduplicates and, together with the
// saturating depth, terminates.
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

// The same CTE name over a set that is already known: what a soft-reference
// statement builds on when the cascade was too wide to restate (see
// {@link narrow}).
let named = (eids: string[]): Frag => ({
  sql: `with ${W}("id") as (` +
    `select "id" from "entity" where "eid" in (${marks(eids.length)}))\n`,
  params: [...eids],
})

/**
 * Everything deleted along with these entities, the named ones included: one row
 * per deleted entity, with the eid, the entity number, and the rung it was
 * reached on. Ordered by rung, and within a rung by the order the entities were
 * created in, which is the order the walk this replaces returned them in.
 *
 * One statement when the vocabulary is {@link narrow}, and otherwise one per
 * group of terms — each a complete closure over its own tables, to be re-asked
 * with what the others turned up until nothing new comes back.
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
 * Every soft reference into the closure of these entities: a surviving row's
 * `detach` or `release` property pointing at one of the deleted entities,
 * returned as (component, property, owner). Empty when the vocabulary declares
 * no soft reference at all.
 *
 * The closure is restated inside the statement when the vocabulary is
 * {@link narrow} — which is what lets this be sent in the same batch as
 * {@link doomSql}, before anyone has read either answer. When it is not, one
 * statement cannot express the closure, so what it is given is the set it
 * answers about: the caller passes a set that is already closed (the last
 * round's, which added nothing).
 *
 * Deleted entities are excluded on purpose — a deleted entity's own tombstone
 * already covers it, so only a surviving row is told to drop its reference.
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
