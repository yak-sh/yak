import { type Bundle, sha256 } from '@yaks/graph'
import { Archetypes, tablesOf } from '@yaks/archetype'
import type { Driver } from './driver.ts'
import { componentTables } from './physical.ts'
import { mintSql } from './write.ts'
import { unit } from './unit.ts'

export { componentTables } from './physical.ts'

let quote = (name: string) => `"${name.replaceAll('"', '""')}"`

type Run = (
  sql: string,
  params?: (string | number)[],
) => Record<string, unknown>[]

/** Counts from a boot: existing assignments stay untouched on a repeated run. */
export type Backfill = { entities: number; archetypes: number; retired: number }

// The component tables of a file change only with its schema, so one
// `pragma schema_version` validates the cached list instead of a table_info per
// table per call.
let facetsHeld = new WeakMap<Driver, { version: number; tables: string[] }>()
let facets = (driver: Driver): string[] => {
  let version = Number(
    driver.query('pragma schema_version', [])[0].schema_version,
  )
  let held = facetsHeld.get(driver)
  if (held?.version == version) return held.tables
  let tables = componentTables(driver)
  facetsHeld.set(driver, { version, tables })
  return tables
}

/** Which of `tables` each owner in `where` has a row in, in table order. */
let presence = (
  run: Run,
  tables: string[],
  owners: Map<number, string[]>,
  where: string,
  params: (string | number)[],
) => {
  for (let table of tables) {
    for (
      let row of run(`select c.entity from ${quote(table)} c ${where}`, params)
    ) {
      owners.get(Number(row.entity))?.push(table)
    }
  }
  return owners
}

// Descriptor minting shared by boot and live reclassification. A descriptor is
// found by eid first; a bare spine that already has component rows is rejected
// rather than reused. The descriptor set {archetype} is its own fixed point.
let minter = (
  run: Run,
  driver: Driver,
  cache: Archetypes,
  tables: string[],
  ids: Map<string, number>,
  number: boolean,
  counts: Backfill,
) => {
  let meta = cache.intern(['archetype'])
  let made = new Set<number>()
  let born: Bundle[] = []
  let mint = (eid: string): number => {
    let id = ids.get(eid)
    if (id != null) return id
    let existing = run(
      'select e.id, a.entity as descriptor from entity e left join archetype a on a.entity = e.id where e.eid = ?',
      [eid],
    )[0]
    if (existing?.descriptor != null) {
      ids.set(eid, id = Number(existing.id))
      return id
    }
    if (
      existing &&
      tables.some((t) =>
        run(`select entity from ${quote(t)} where entity = ?`, [
          Number(existing.id),
        ]).length
      )
    ) {
      throw new Error(`Archetype identity is occupied: ${eid}`)
    }
    let statement = mintSql(eid, number)
    driver.query(statement.sql, statement.params)
    id = Number(run('select id from entity where eid = ?', [eid])[0].id)
    let list = JSON.stringify(cache.get(eid)!.tables)
    run(
      'insert into archetype(entity, tables) values (?, ?) on conflict(entity) do nothing',
      [id, list],
    )
    ids.set(eid, id)
    made.add(id)
    counts.archetypes++
    // Register first, then recurse: meta points to itself.
    let target = eid == meta.eid ? id : mint(meta.eid)
    run('update entity set archetype = ? where id = ?', [target, id])
    born.push({
      entity: { eid, archetype: meta.eid },
      archetype: { tables: list },
    })
    return id
  }
  // Resolve all sets before assigning: a bare reference stub can become one
  // of the descriptors, regardless of its position in the snapshot. Hash once
  // per distinct set and bind owner groups in bounded chunks.
  let assign = (owners: Map<number, string[]>) => {
    let groups = new Map<string, { names: string[]; owners: number[] }>()
    for (let [owner, names] of owners) {
      let key = JSON.stringify(names)
      let group = groups.get(key)
      if (!group) groups.set(key, group = { names, owners: [] })
      group.owners.push(owner)
    }
    let targets = [...groups.values()].map((g) =>
      [g.owners, mint(cache.intern(g.names).eid)] as const
    )
    for (let [owners, id] of targets) {
      let pending = owners.filter((owner) => !made.has(owner))
      for (let i = 0; i < pending.length; i += 2048) {
        run(
          'update entity set archetype = ? where id in (select value from json_each(?))',
          [id, JSON.stringify(pending.slice(i, i + 2048))],
        )
      }
      counts.entities += owners.length
    }
    return targets
  }
  return { mint, assign, made, born }
}

/**
 * Idempotent, atomic boot maintenance, after additive DDL has installed the
 * column and archetype vocabulary. Reads presence from the physical file, not
 * vocab. Retires missing-table descriptors forever; reclassifies their owners,
 * plus null assignments, in table-sized scans. No per-owner component census.
 */
export function backfill(driver: Driver, number = false): Backfill {
  let run: Run = (sql, params = []) => driver.query(sql, params)
  let counts: Backfill = { entities: 0, archetypes: 0, retired: 0 }
  return unit(driver, () => {
    let cache = new Archetypes()
    let tables = componentTables(driver)
    let present = new Set(
      run("select name from sqlite_schema where type = 'table'").map((r) =>
        String(r.name)
      ),
    )
    let ids = new Map<string, number>()
    let stale: number[] = []
    for (
      let row of run(
        'select a.entity, e.eid, a.tables, r.entity as retired from archetype a join entity e on e.id = a.entity left join retired r on r.entity = a.entity',
      )
    ) {
      let a = cache.intern(tablesOf(row.tables))
      if (a.eid != row.eid) {
        // The original contract used a bare SHA, sharing blobs' address space.
        // Rename only verified legacy descriptors, never arbitrary occupants.
        // Keeping the spine id preserves every integer ref (including owners
        // and retirement); the enclosing savepoint makes this all-or-nothing.
        if (row.eid != sha256(a.tables.join('|'))) {
          throw new Error(`Invalid archetype identity: ${row.eid}`)
        }
        // A legacy blob could have been added after this descriptor was born.
        // Renaming that shared spine would steal the blob's content address.
        // References to a mixed entity are ambiguous: refuse rather than guess
        // which ones belong to the descriptor. Ordinary descriptors only
        // carry
        // archetype and (optionally) retired.
        if (
          tables.some((t) =>
            t != 'archetype' && t != 'retired' &&
            run(`select entity from ${quote(t)} where entity = ?`, [
              Number(row.entity),
            ]).length
          )
        ) {
          throw new Error(
            `Legacy archetype identity has extra facets: ${row.eid}`,
          )
        }
        if (run('select id from entity where eid = ?', [a.eid]).length) {
          throw new Error(`Archetype identity is occupied: ${a.eid}`)
        }
        run('update entity set eid = ? where id = ?', [
          a.eid,
          Number(row.entity),
        ])
      }
      let id = Number(row.entity)
      ids.set(a.eid, id)
      if (a.tables.some((t) => !present.has(t))) {
        stale.push(id)
        if (row.retired == null) {
          run('insert into retired(entity) values (?)', [id])
          run('update entity set archetype = null where id = ?', [id])
          counts.retired++
        }
      }
    }
    if (stale.length) {
      run(
        'update entity set archetype = null where archetype in (select value from json_each(?))',
        [JSON.stringify(stale)],
      )
    }

    // Snapshot the incomplete owners before minting descriptors. New descriptors
    // are classified directly below; they never need another whole-file pass.
    let owners = new Map<number, string[]>(
      run('select id from entity where archetype is null').map((
        r,
      ) => [Number(r.id), []]),
    )
    if (owners.size) {
      presence(
        run,
        tables,
        owners,
        'join entity e on e.id = c.entity where e.archetype is null',
        [],
      )
    }
    minter(run, driver, cache, tables, ids, number, counts).assign(owners)
    return counts
  })
}

/** An audit's tally: owners read, pointers that disagree, and a few names. */
export type Drift = { checked: number; drifted: number; sample: string[] }

// Owners are audited a window of ids at a time, so a half-million-entity file
// costs one window of JS rather than the whole file: each window is a slice of
// the same scan, through the integer primary key every component table has.
let WINDOW = 20_000

/**
 * The audit half of `reclassify`, and it writes nothing. A row written past
 * the graph must name its owners; a writer that forgets leaves a pointer that
 * no longer describes its entity, and both the read path and the query planner
 * trust that pointer — nothing else notices. So this reads presence for every
 * owner, by the same rule and the same component list classification uses, and
 * reports where the two disagree. Descriptors are their own fixed point and
 * are left out, exactly as `reclassify` leaves them out.
 */
export function drift(driver: Driver, sample = 12): Drift {
  let run: Run = (sql, params = []) => driver.query(sql, params)
  let tables = facets(driver)
  let cache = new Archetypes()
  // Presence set (as the joined table names) → the descriptor it interns to.
  // The whole file holds a few hundred distinct sets, so hashing one per
  // window's worth of owners would be the audit's dominant cost.
  let known = new Map<string, string>()
  let out: Drift = { checked: 0, drifted: 0, sample: [] }
  let top = Number(run('select max(id) as top from entity')[0]?.top ?? 0)
  for (let lo = 0; lo < top; lo += WINDOW) {
    let hi = lo + WINDOW
    let rows = run(
      `select e.id, e.eid, d.eid as assigned from entity e
         left join entity d on d.id = e.archetype
         left join archetype a on a.entity = e.id
        where a.entity is null and e.id > ? and e.id <= ?`,
      [lo, hi],
    )
    if (!rows.length) continue
    let owners = presence(
      run,
      tables,
      new Map(rows.map((r) => [Number(r.id), [] as string[]])),
      'where c.entity > ? and c.entity <= ?',
      [lo, hi],
    )
    for (let r of rows) {
      let names = owners.get(Number(r.id))!
      let key = names.join('|')
      let eid = known.get(key) ?? cache.intern(names).eid
      known.set(key, eid)
      out.checked++
      if (eid == r.assigned) continue
      out.drifted++
      if (out.sample.length < sample) out.sample.push(String(r.eid))
    }
  }
  return out
}

/**
 * Classify the named entities from their physical presence, now, inside the
 * caller's transaction. For rows an application wrote past the graph (raw SQL
 * into a component table): no queue, no triggers, the same presence rule as
 * boot. Returns the pointers that moved and any descriptor minted, as bundles
 * an application can broadcast. Descriptors and unknown eids are left alone.
 */
export function reclassify(
  driver: Driver,
  eids: string[],
  number = false,
): Bundle[] {
  if (!eids.length) return []
  let run: Run = (sql, params = []) => driver.query(sql, params)
  return unit(driver, () => {
    let cache = new Archetypes()
    let tables = facets(driver)
    let rows = run(
      `select e.id, e.eid, e.archetype, d.eid as assigned from entity e
        left join entity d on d.id = e.archetype
        left join archetype a on a.entity = e.id
        where a.entity is null and e.eid in (select value from json_each(?))`,
      [JSON.stringify([...new Set(eids)])],
    )
    if (!rows.length) return []
    let owners = new Map<number, string[]>(
      rows.map((r) => [Number(r.id), []]),
    )
    presence(
      run,
      tables,
      owners,
      'where c.entity in (select value from json_each(?))',
      [
        JSON.stringify([...owners.keys()]),
      ],
    )
    let moved = new Map<number, string>()
    for (let r of rows) {
      let set = cache.intern(owners.get(Number(r.id))!)
      if (set.eid == r.assigned) owners.delete(Number(r.id))
      else moved.set(Number(r.id), String(r.eid))
    }
    if (!owners.size) return []
    let counts: Backfill = { entities: 0, archetypes: 0, retired: 0 }
    let { assign, born } = minter(
      run,
      driver,
      cache,
      tables,
      new Map(),
      number,
      counts,
    )
    let echoes: Bundle[] = []
    for (let [group, id] of assign(owners)) {
      let archetype = String(
        run('select eid from entity where id = ?', [id])[0].eid,
      )
      for (let owner of group) {
        echoes.push({ entity: { eid: moved.get(owner)!, archetype } })
      }
    }
    return [...born, ...echoes]
  })
}
