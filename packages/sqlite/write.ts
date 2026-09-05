// Writes: a batch of bundles patched into the store. This is the PATCH half of
// the adapter — the mirror image of the reads in ./read.ts — and it honors the
// same rules a graph patch does elsewhere in the yaks stack:
//
//   omitted columns are untouched    a patch names only what changes
//   a column set to null is cleared  null is a value, not an absence
//   a component set to null is dropped   the row goes, the entity stays
//   $delete: true deletes the entity   it is tombstoned, and death cascades
//
// A bundle is `{ entity: { eid }, [component]: patch | null, $delete?, $was? }`
// — the identity under `entity`, each component it touches under that
// component's name, and `$`-prefixed sugar the storage layer reads (`$delete`)
// or carries through untouched (`$was`, enforced upstream in @yaks/graph, not
// here). `{ entity: { eid }, $delete: true }` deletes the whole entity.
//
// Deletion is never destructive of identity: a deleted entity keeps its spine
// row so its integer id can never be reused, and gains a tombstone row that
// every read excludes on. Death spreads first — a `cascade` reference pulls its
// owner into the grave, a `release` reference's row is dropped (its owner
// lives), a `detach` reference is nulled — and the vocabulary is what declares
// which word each reference wears, so this file hard-codes no relationships.

import type { Vocab } from '@yaks/vocab'
import type { Driver, Param } from './driver.ts'
import type { Bundle, Comp } from './bundle.ts'

// Run a parameterized statement for effect, discarding any rows.
let run = (driver: Driver, sql: string, params: Param[] = []): void => {
  driver.query(sql, params)
}

// The value a column stores, coerced to what SQLite holds: a boolean becomes
// 0/1 (a bool column has integer affinity), everything else passes through. A
// reference is resolved to its target's integer id before it reaches here.
let scalar = (value: unknown): Param =>
  typeof value == 'boolean' ? Number(value) : value as Param

// The target's integer id, or null when no entity wears the eid. The write path
// mints a spine for every eid it is about to touch first, so a null here means
// a genuinely absent (or tombstoned) referent.
let idOf = (driver: Driver, eid: string): number | null => {
  let row = driver.query('select id from entity where eid = ?', [eid])[0]
  return row ? Number(row.id) : null
}

// Mint an identity row if the eid has none, giving it the next `num`. `num`
// orders entities by first appearance; a returning eid keeps the one it has.
let mint = (driver: Driver, eid: string): void =>
  run(
    driver,
    `insert into entity (eid, num)
       select ?, (select coalesce(max(num), 0) + 1 from entity)
       where not exists (select 1 from entity where eid = ?)`,
    [eid, eid],
  )

// The component patches a bundle carries, in touch order. The identity
// (`entity`) and every `$`-prefixed sugar key (`$delete`, `$was`) are not
// components, so they never reach the upsert/drop loop.
let comps = (b: Bundle): [string, Comp | null][] =>
  Object.entries(b)
    .filter(([k]) => k != 'entity' && !k.startsWith('$')) as [
      string,
      Comp | null,
    ][]

// Whether a column is a reference — asked of the vocabulary, which knows a
// column's category.
let isRef = (v: Vocab, comp: string, prop: string): boolean =>
  v.column(comp, prop)?.category == 'ref'

// Delete an entity: spread death per the vocabulary's reference words, drop
// every component row, then tombstone the spine. Returns the eids that died
// (the target plus everything that cascaded with it).
let kill = (driver: Driver, v: Vocab, eid: string): string[] => {
  let doomed = [eid]
  // Grow the worklist over `cascade` references: an entity that exists ABOUT a
  // doomed one dies with it. Walk breadth-first so a chain of them all falls.
  for (let i = 0; i < doomed.length; i++) {
    let id = idOf(driver, doomed[i])
    if (id == null) continue
    for (let [comp, prop] of v.deaths('cascade')) {
      let owners = driver.query(
        `select o.eid as eid from "${comp}" r join entity o on o.id = r.entity
           where r."${prop}" = ?`,
        [id],
      )
      for (let o of owners) {
        if (!doomed.includes(o.eid as string)) doomed.push(o.eid as string)
      }
    }
  }
  for (let d of doomed) {
    let id = idOf(driver, d)
    if (id == null) continue
    // `release`: the referencing ROW dies, its owner survives.
    for (let [comp, prop] of v.deaths('release')) {
      run(driver, `delete from "${comp}" where "${prop}" = ?`, [id])
    }
    // `detach`: the reference is nulled, its owner and row survive.
    for (let [comp, prop] of v.deaths('detach')) {
      run(driver, `update "${comp}" set "${prop}" = null where "${prop}" = ?`, [
        id,
      ])
    }
    // Every component row this entity wore. Reverse declaration order keeps a
    // dependent ahead of what it references, so no foreign key blocks a delete.
    for (let comp of [...v.all].reverse()) {
      if (comp != 'entity') {
        run(driver, `delete from "${comp}" where entity = ?`, [id])
      }
    }
  }
  // Tombstone last — the spine row is retained forever so its id never recycles.
  let now = new Date().toISOString()
  for (let d of doomed) {
    run(
      driver,
      `insert or ignore into tombstone (entity, deleted_at)
         values ((select id from entity where eid = ?), ?)`,
      [d, now],
    )
  }
  return doomed
}

// Upsert one component: insert the sent columns, or update just them on
// conflict. Only the named columns move, so an omitted column keeps its stored
// value — the heart of PATCH. A reference value is resolved to the target's id;
// a bare `{}` is a tag whose mere presence is the fact.
let upsert = (
  driver: Driver,
  v: Vocab,
  oid: number,
  comp: string,
  patch: Comp,
): void => {
  let cols = Object.keys(patch)
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

// Apply a batch of bundles, in order, and return every eid tombstoned along the
// way (a delete plus its cascade). The batch is applied statement by statement;
// wrap the call in the driver's own transaction to make it atomic.
export let write = (
  driver: Driver,
  vocab: Vocab,
  bundles: Bundle[],
): string[] => {
  // Mint a spine for every eid this batch touches or points at, so a reference
  // can name a target created in the same batch, in any order. A deleting
  // bundle mints nothing — it is about to tombstone the eid, not create it.
  for (let b of bundles) {
    if (!b.$delete) mint(driver, b.entity.eid)
    for (let [name, patch] of comps(b)) {
      if (!patch) continue
      for (let [prop, val] of Object.entries(patch)) {
        if (val != null && isRef(vocab, name, prop)) mint(driver, String(val))
      }
    }
  }

  let dead: string[] = []
  for (let b of bundles) {
    let eid = b.entity.eid
    // `$delete` tombstones the whole entity and spreads death; any components
    // the bundle also carries are moot once the entity is gone.
    if (b.$delete) {
      dead.push(...kill(driver, vocab, eid))
      continue
    }
    for (let [name, patch] of comps(b)) {
      if (patch == null) {
        run(
          driver,
          `delete from "${name}" where entity = (select id from entity where eid = ?)`,
          [eid],
        )
        continue
      }
      let oid = idOf(driver, eid)
      if (oid == null) continue // deleted earlier in the same batch
      upsert(driver, vocab, oid, name, patch)
    }
  }
  return dead
}
