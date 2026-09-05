// Writes: bundles patched into the store, and entities removed from it. This
// is the PATCH half of the adapter — the mirror image of the reads in
// ./read.ts — and it honors the rules a graph patch honors everywhere:
//
//   omitted columns are untouched       a patch names only what changes
//   a column set to null is cleared     null is a value, not an absence
//   a component set to null is dropped  the row goes, the entity stays
//   a tombstoned entity takes no patch  death is final; ids never recycle
//
// Every write here is a STATEMENT, built before it is sent, and every statement
// is SELF-SUFFICIENT: an owner id is a subquery (`select id from entity where
// eid = ?`) rather than a value looked up first, and an insert whose owner does
// not exist writes nothing instead of inventing a row. Nothing is read between
// two writes.
//
// That is what lets one write path serve every SQLite-shaped adapter. An
// embedded engine could afford to ask — look up an id, insert a row, ask again
// — but D1 answers over the network and gives no interactive transaction, so a
// write that asked questions mid-flight could not be atomic there: whatever it
// learned would be learned outside the batch that commits. Statements that ask
// nothing can be gathered into one list and sent as a single all-or-nothing
// unit, which is exactly what @yaks/d1 does with the ones built here.
//
// The two reads that remain are about IDENTITY, not about ids: which of the
// named eids already exist (one statement for the whole batch) and what numbers
// the new ones were given (one more). An adapter that cannot read mid-write —
// @yaks/d1 — mints its numbers from a high-water mark instead and passes them
// to `mintSql`; the statement is otherwise the same.
//
// What is NOT here is which entities a delete takes with it. A reference's
// death word (`cascade`, `detach`, `release`, `keep`) is a rule about MEANING,
// declared in the vocabulary, and @yaks/graph reads it — through the same
// transaction — to decide who dies. This file removes exactly the entities it
// is handed. One decision, in one place, shared by every storage adapter.
//
// IDENTITY IS STORAGE'S: `patch` mints a spine for every eid the batch touches
// or points at (so a reference may name a target created in the same batch, in
// any order), numbers each new one, and reports the entities it minted.

import type { Vocab } from '@yaks/vocab'
import type { Bundle, Comp, Entity } from '@yaks/graph'
import { comps } from '@yaks/graph'
import type { Driver, Param } from './driver.ts'

/** One statement of a write: the SQL, and the parameters it binds. This file
 * builds them; an adapter runs them — one at a time over an embedded engine,
 * gathered into a single batch over a remote one. */
export type Sql = { sql: string; params: Param[] }

// The owner's integer id, as a subquery. Every write keys to it, so an entity
// minted earlier in the same unit of work resolves without a second question.
let OWNER = '(select id from entity where eid = ?)'

// Run a built statement for effect, discarding any rows.
let run = (driver: Driver, s: Sql): void => {
  driver.query(s.sql, s.params)
}

// The value a column stores, coerced to what SQLite holds: a boolean becomes
// 0/1 (a bool column has integer affinity), everything else passes through. A
// reference is resolved to its target's integer id by the statement itself.
let scalar = (value: unknown): Param =>
  typeof value == 'boolean' ? Number(value) : value as Param

// Whether a column is a reference — asked of the vocabulary, which knows a
// column's category.
let isRef = (v: Vocab, comp: string, prop: string): boolean =>
  v.column(comp, prop)?.category == 'ref'

/** What the store already knows about an eid: whether that identity is in its
 * grave. An eid with no entry wears no entity yet. */
export type Spine = { dead: boolean }

/** What the store knows about these eids — one statement, whatever the batch's
 * size. An eid absent from the map has no entity; one present with `dead` is
 * tombstoned, and a dead identity is still an identity: it answers by eid
 * forever, it just takes no more writes. */
export let spines = (
  driver: Driver,
  eids: string[],
): Map<string, Spine> => {
  if (!eids.length) return new Map()
  let holes = eids.map(() => '?').join(', ')
  return new Map(
    driver.query(
      `select e.eid as eid, t.entity as dead from entity e
        left join tombstone t on t.entity = e.id
        where e.eid in (${holes})`,
      eids,
    ).map((r) => [String(r.eid), { dead: r.dead != null }]),
  )
}

/** The entities that are tombstoned, of those named. */
export let buried = (driver: Driver, eids: string[]): Set<string> =>
  new Set(
    [...spines(driver, eids)]
      .filter(([, spine]) => spine.dead)
      .map(([eid]) => eid),
  )

/**
 * The statement that mints an identity. `num` orders entities by first
 * appearance: an adapter that can read back what it wrote omits it and lets
 * SQLite take the next one at insert time (exact under any concurrent writer);
 * one that cannot — @yaks/d1, whose batch has not been sent — hands one in from
 * a high-water mark it read once. `do nothing` on a returning eid, so minting
 * twice is not an error.
 */
export let mintSql = (eid: string, num?: number): Sql => ({
  sql: `insert into entity (eid, num) values (?, ${
    num == null ? '(select coalesce(max(num), 0) + 1 from entity)' : '?'
  }) on conflict(eid) do nothing`,
  params: num == null ? [eid] : [eid, num],
})

/**
 * The statement that patches one component onto one entity: insert the sent
 * columns, or update just them on conflict, so an omitted column keeps what it
 * held. A reference column binds its target's eid and resolves to that target's
 * id in the statement. A component whose patch names no stored column is a tag
 * — its row's existence is the whole fact.
 *
 * An INSERT…SELECT is what makes the owner a subquery: no owner row, no
 * inserted row. Its WHERE is also what lets SQLite parse the upsert clause.
 */
export let upsertSql = (
  v: Vocab,
  eid: string,
  comp: string,
  patch: Comp,
): Sql => {
  let cols = Object.keys(patch).filter((c) => v.column(comp, c)?.persist)
  if (!cols.length) {
    return {
      sql: `insert or ignore into "${comp}" (entity)
              select id from entity where eid = ?`,
      params: [eid],
    }
  }
  // The value each column takes, as a select item beside the owner id: a
  // reference is another subquery, a scalar is a bound parameter.
  let params: Param[] = []
  let items = cols.map((c) => {
    let raw = patch[c]
    if (raw != null && isRef(v, comp, c)) {
      params.push(String(raw))
      return OWNER
    }
    params.push(scalar(raw))
    return '?'
  })
  let names = cols.map((c) => `"${c}"`).join(', ')
  let sets = cols.map((c) => `"${c}" = excluded."${c}"`).join(', ')
  return {
    sql: `insert into "${comp}" (entity, ${names})
            select e.id, ${items.join(', ')} from entity e where e.eid = ?
            on conflict(entity) do update set ${sets}`,
    params: [...params, eid],
  }
}

/** The statement that drops one component from one entity — the row goes, the
 * entity stays. */
export let dropSql = (eid: string, comp: string): Sql => ({
  sql: `delete from "${comp}" where entity = ${OWNER}`,
  params: [eid],
})

/**
 * The statements that patch one bundle in: one per component it names, a drop
 * for each `null` one. Identity is minted separately (see {@link mintSql}),
 * because a batch mints every eid it touches or points at before it writes
 * anything.
 */
export let patchSql = (v: Vocab, b: Bundle): Sql[] => {
  let eid = b.entity.eid
  return comps(b).map(([name, comp]) =>
    comp == null ? dropSql(eid, name) : upsertSql(v, eid, name, comp)
  )
}

/**
 * The statements that remove one entity: every component row it wears, then the
 * tombstone that keeps its id from ever being reused. Components go in reverse
 * declaration order, so a dependent is gone before what it references and no
 * foreign key blocks the delete. The tombstone is an INSERT…SELECT, so an eid
 * no entity wears tombstones nothing.
 */
export let removeSql = (v: Vocab, entity: Entity, at: string): Sql[] => [
  ...[...v.all].reverse()
    .filter((comp) => comp != 'entity')
    .map((comp) => dropSql(entity.eid, comp)),
  {
    sql: `insert or ignore into tombstone (entity, deleted_at)
            select id, ? from entity where eid = ?`,
    params: [at, entity.eid],
  },
]

/** Every eid these bundles touch or point at, in first-touch order — each
 * bundle's own entity, then the targets of its reference columns. This is the
 * order identity is minted in, so it is the order `num` follows. */
export let touched = (v: Vocab, bundles: Bundle[]): string[] =>
  bundles.flatMap((b) => [
    b.entity.eid,
    ...comps(b).flatMap(([name, comp]) =>
      Object.entries(comp ?? {})
        .filter(([prop, val]) => val != null && isRef(v, name, prop))
        .map(([, val]) => String(val))
    ),
  ])

// The numbers these eids were given, in the order asked — one statement for
// however many were minted.
let numbers = (driver: Driver, eids: string[]): Entity[] => {
  let holes = eids.map(() => '?').join(', ')
  let nums = new Map(
    driver.query(
      `select eid, num from entity where eid in (${holes})`,
      eids,
    ).map((r) => [String(r.eid), Number(r.num)]),
  )
  return eids.map((eid) => ({ eid, num: nums.get(eid)! }))
}

/**
 * Patch a batch of bundles in, in order, and return the entities this patch
 * MINTED — each with the `num` it was given. A bundle for a tombstoned entity
 * is skipped: death is final.
 */
export let patch = (
  driver: Driver,
  vocab: Vocab,
  bundles: Bundle[],
): Entity[] => {
  let known = spines(driver, [...new Set(touched(vocab, bundles))])
  let alive = bundles.filter((b) => !known.get(b.entity.eid)?.dead)

  // Mint a spine for every eid the live bundles touch or point at, so a
  // reference can name a target created in the same batch, in any order.
  let fresh: string[] = []
  let seen = new Set(known.keys())
  for (let eid of touched(vocab, alive)) {
    if (seen.has(eid)) continue
    seen.add(eid)
    fresh.push(eid)
  }
  for (let eid of fresh) run(driver, mintSql(eid))

  for (let b of alive) for (let s of patchSql(vocab, b)) run(driver, s)

  return fresh.length ? numbers(driver, fresh) : []
}

/**
 * Remove these entities: every component row they wear goes, and their
 * identity is tombstoned so the id can never be reused. Exactly the entities
 * named — @yaks/graph decided who they are.
 */
export let remove = (
  driver: Driver,
  vocab: Vocab,
  entities: Entity[],
): void => {
  let now = new Date().toISOString()
  for (let e of entities) {
    for (let s of removeSql(vocab, e, now)) run(driver, s)
  }
}
