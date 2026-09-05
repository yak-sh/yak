// Writes: bundles patched into the store, and entities removed from it. This
// is the PATCH half of the adapter — the mirror image of the reads in
// ./read.ts — and it honors the rules a graph patch honors everywhere:
//
//   omitted columns are untouched       a patch names only what changes
//   a column set to null is cleared     null is a value, not an absence
//   a component set to null is dropped  the row goes, the entity stays
//   a tombstoned entity takes no patch  death is final; ids never recycle
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

// Run a parameterized statement for effect, discarding any rows.
let run = (driver: Driver, sql: string, params: Param[] = []): void => {
  driver.query(sql, params)
}

// The value a column stores, coerced to what SQLite holds: a boolean becomes
// 0/1 (a bool column has integer affinity), everything else passes through. A
// reference is resolved to its target's integer id before it reaches here.
let scalar = (value: unknown): Param =>
  typeof value == 'boolean' ? Number(value) : value as Param

// The target's integer id, or null when no entity wears the eid.
let idOf = (driver: Driver, eid: string): number | null => {
  let row = driver.query('select id from entity where eid = ?', [eid])[0]
  return row ? Number(row.id) : null
}

/** The entities that are tombstoned, of those named. A dead identity is still
 * an identity: it answers by eid forever, it just takes no more writes. */
export let buried = (driver: Driver, eids: string[]): Set<string> => {
  if (!eids.length) return new Set()
  let holes = eids.map(() => '?').join(', ')
  return new Set(
    driver.query(
      `select e.eid as eid from entity e join tombstone t on t.entity = e.id
        where e.eid in (${holes})`,
      eids,
    ).map((r) => String(r.eid)),
  )
}

// Mint an identity row if the eid has none, giving it the next `num`. `num`
// orders entities by first appearance; a returning eid keeps the one it has.
let mint = (driver: Driver, eid: string): Entity | undefined => {
  if (idOf(driver, eid) != null) return undefined
  run(
    driver,
    `insert into entity (eid, num)
       select ?, (select coalesce(max(num), 0) + 1 from entity)`,
    [eid],
  )
  let row = driver.query('select num from entity where eid = ?', [eid])[0]
  return { eid, num: Number(row.num) }
}

// Whether a column is a reference — asked of the vocabulary, which knows a
// column's category.
let isRef = (v: Vocab, comp: string, prop: string): boolean =>
  v.column(comp, prop)?.category == 'ref'

// Upsert one component: insert the sent columns, or update just them on
// conflict. Only the named columns move, so an omitted column keeps its stored
// value — the heart of PATCH. A reference value is resolved to the target's
// id; a bare `{}` is a tag whose mere presence is the fact.
let upsert = (
  driver: Driver,
  v: Vocab,
  oid: number,
  comp: string,
  patch: Comp,
): void => {
  let cols = Object.keys(patch).filter((c) => v.column(comp, c)?.persist)
  if (!cols.length) {
    run(driver, `insert or ignore into "${comp}" (entity) values (?)`, [oid])
    return
  }
  let vals: Param[] = cols.map((c) => {
    let raw = patch[c]
    if (raw != null && isRef(v, comp, c)) {
      let id = idOf(driver, String(raw))
      if (id == null) {
        throw new Error(`${comp}.${c} references ${raw}, which has no entity`)
      }
      return id
    }
    return scalar(raw)
  })
  let names = cols.map((c) => `"${c}"`).join(', ')
  let holes = cols.map(() => '?').join(', ')
  let sets = cols.map((c) => `"${c}" = excluded."${c}"`).join(', ')
  run(
    driver,
    `insert into "${comp}" (entity, ${names}) values (?, ${holes})
       on conflict(entity) do update set ${sets}`,
    [oid, ...vals],
  )
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
  // Mint a spine for every eid this batch touches or points at, so a reference
  // can name a target created in the same batch, in any order.
  let dead = buried(driver, bundles.map((b) => b.entity.eid))
  let born: Entity[] = []
  let birth = (eid: string) => {
    let e = mint(driver, eid)
    if (e) born.push(e)
  }
  for (let b of bundles) {
    if (dead.has(b.entity.eid)) continue
    birth(b.entity.eid)
    for (let [name, comp] of comps(b)) {
      if (!comp) continue
      for (let [prop, val] of Object.entries(comp)) {
        if (val != null && isRef(vocab, name, prop)) birth(String(val))
      }
    }
  }

  for (let b of bundles) {
    let eid = b.entity.eid
    if (dead.has(eid)) continue
    let oid = idOf(driver, eid)
    if (oid == null) continue
    for (let [name, comp] of comps(b)) {
      if (comp == null) {
        run(driver, `delete from "${name}" where entity = ?`, [oid])
        continue
      }
      upsert(driver, vocab, oid, name, comp)
    }
  }
  return born
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
  let ids = entities.map((e) => [e.eid, idOf(driver, e.eid)] as const)
    .filter(([, id]) => id != null) as [string, number][]
  for (let [, id] of ids) {
    // Reverse declaration order keeps a dependent ahead of what it references,
    // so no foreign key blocks a delete.
    for (let comp of [...vocab.all].reverse()) {
      if (comp != 'entity') {
        run(driver, `delete from "${comp}" where entity = ?`, [id])
      }
    }
  }
  // Tombstone last — the spine row is retained forever so its id never
  // recycles.
  let now = new Date().toISOString()
  for (let [, id] of ids) {
    run(
      driver,
      `insert or ignore into tombstone (entity, deleted_at) values (?, ?)`,
      [id, now],
    )
  }
}
