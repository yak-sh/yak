// Writes, as STATEMENTS rather than as calls. @yaks/sqlite writes by talking to
// the database — look up an id, insert a row, read the number back — because an
// embedded engine answers between statements for free. D1 answers over the
// network and gives no interactive transaction, so a write that asked questions
// mid-flight could not be atomic: whatever it learned would be learned outside
// the batch that commits.
//
// So every statement here is SELF-SUFFICIENT. An owner id is a subquery
// (`select id from entity where eid = ?`) rather than a value looked up first,
// and an insert whose owner does not exist writes nothing instead of writing a
// null. That is what lets a whole patch — mints, upserts, drops, deletes,
// tombstones — be gathered into one list and handed to `batch()` as a single
// all-or-nothing unit.
//
// The rules are the ones every adapter honors:
//   omitted columns are untouched       a patch names only what changes
//   a column set to null is cleared     null is a value, not an absence
//   a component set to null is dropped  the row goes, the entity stays
//   a tombstoned entity takes no patch  death is final; ids never recycle
//
// Which entities a delete takes with it is NOT here: that is a rule about
// meaning, read off the vocabulary by @yaks/graph, which tells this file exactly
// who dies.

import type { Bundle, Comp, Entity } from '@yaks/graph'
import { comps } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { bind, type Sql } from './d1.ts'

// The owner's integer id, as a subquery. Every write keys to it, so an entity
// minted earlier in the same batch resolves without a round trip.
let OWNER = '(select id from entity where eid = ?)'

/** The statement that mints an identity: the eid and the number it was given.
 * `do nothing` on a returning eid, so minting twice is not an error. */
export let mint = (eid: string, num: number): Sql => ({
  sql: `insert into entity (eid, num) values (?, ?)
          on conflict(eid) do nothing`,
  params: [eid, num],
})

// Whether a column is a reference — asked of the vocabulary, which knows a
// column's category.
let isRef = (v: Vocab, comp: string, prop: string): boolean =>
  v.column(comp, prop)?.category == 'ref'

/**
 * The statement that patches one component onto one entity: insert the sent
 * columns, or update just them on conflict, so an omitted column keeps what it
 * held. A reference column binds its target's eid and resolves to that
 * target's id in the statement. A component whose patch names no stored column
 * is a tag — its row's existence is the whole fact.
 */
export let upsert = (
  v: Vocab,
  eid: string,
  comp: string,
  patch: Comp,
): Sql => {
  let cols = Object.keys(patch).filter((c) => v.column(comp, c)?.persist)
  if (!cols.length) {
    return {
      sql: `insert or ignore into "${comp}" (entity) values (${OWNER})`,
      params: [eid],
    }
  }
  // The value each column takes, as a select item beside the owner id: a
  // reference is another subquery, a scalar is a bound parameter.
  let params = [] as ReturnType<typeof bind>[]
  let items = cols.map((c) => {
    let raw = patch[c]
    if (raw != null && isRef(v, comp, c)) {
      params.push(bind(String(raw)))
      return `(select id from entity where eid = ?)`
    }
    params.push(bind(raw))
    return '?'
  })
  let names = cols.map((c) => `"${c}"`).join(', ')
  let sets = cols.map((c) => `"${c}" = excluded."${c}"`).join(', ')
  // An INSERT…SELECT is what makes the owner a subquery: no owner row, no
  // inserted row. Its WHERE is also what lets SQLite parse the upsert clause.
  return {
    sql: `insert into "${comp}" (entity, ${names})
            select e.id, ${items.join(', ')} from entity e where e.eid = ?
            on conflict(entity) do update set ${sets}`,
    params: [...params, eid],
  }
}

/** The statement that drops one component from one entity — the row goes, the
 * entity stays. */
export let drop = (eid: string, comp: string): Sql => ({
  sql: `delete from "${comp}" where entity = ${OWNER}`,
  params: [eid],
})

/**
 * The statements that patch one bundle in: one per component it names, a drop
 * for each `null` one. Identity is minted separately (see {@link mint}) because
 * a batch mints every eid it touches or points at before it writes anything.
 */
export let patch = (v: Vocab, b: Bundle): Sql[] =>
  comps(b).map(([name, comp]) =>
    comp == null
      ? drop(b.entity.eid, name)
      : upsert(v, b.entity.eid, name, comp)
  )

/**
 * The statements that remove one entity: every component row it wears, then the
 * tombstone that keeps its id from ever being reused. Components go in reverse
 * declaration order, so a dependent is gone before what it references and no
 * foreign key blocks the delete. The tombstone is an INSERT…SELECT, so an eid
 * no entity wears tombstones nothing.
 */
export let remove = (v: Vocab, entity: Entity, at: string): Sql[] => [
  ...[...v.all].reverse()
    .filter((comp) => comp != 'entity')
    .map((comp) => drop(entity.eid, comp)),
  {
    sql: `insert or ignore into tombstone (entity, deleted_at)
            select id, ? from entity where eid = ?`,
    params: [at, entity.eid],
  },
]
