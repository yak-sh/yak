import { sha256 } from '@yaks/graph'
import { Archetypes, tablesOf } from '@yaks/archetype'
import type { Driver } from './driver.ts'
import { componentTables } from './physical.ts'
import { mintSql } from './write.ts'

export { componentTables } from './physical.ts'

let quote = (name: string) => `"${name.replaceAll('"', '""')}"`

/** Counts from a boot: existing assignments stay untouched on a repeated run. */
export type Backfill = { entities: number; archetypes: number; retired: number }
let sequence = 0

/**
 * Idempotent, atomic boot maintenance, after additive DDL has installed the
 * column and archetype vocabulary. Reads presence from the physical file, not
 * vocab. Retires missing-table descriptors forever; reclassifies their owners,
 * plus null assignments, in table-sized scans. No per-owner component census.
 */
export function backfill(driver: Driver, number = true): Backfill {
  let savepoint = `archetype_boot_${sequence++}`
  driver.exec(`savepoint ${savepoint}`)
  let run = (sql: string, params: (string | number)[] = []) =>
    driver.query(sql, params)
  let counts: Backfill = { entities: 0, archetypes: 0, retired: 0 }
  try {
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
        // A legacy blob could have been added AFTER this descriptor was born.
        // Renaming that shared spine would steal the blob's content address.
        // References to a mixed entity are ambiguous: refuse rather than guess
        // which ones belong to the descriptor. Ordinary descriptors only wear
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

    // Snapshot the incomplete owners BEFORE minting descriptors. New descriptors
    // are classified directly below; they never need another whole-file pass.
    let owners = new Map<number, string[]>(
      run('select id from entity where archetype is null').map((
        r,
      ) => [Number(r.id), []]),
    )
    if (owners.size) {
      for (let table of tables) {
        for (
          let row of run(
            `select c.entity from ${
              quote(table)
            } c join entity e on e.id = c.entity where e.archetype is null`,
          )
        ) {
          owners.get(Number(row.entity))?.push(table)
        }
      }
    }
    let meta = cache.intern(['archetype'])
    let made = new Set<number>()
    let mint = (eid: string): number => {
      let id = ids.get(eid)
      if (id != null) return id
      let existing = run('select id from entity where eid = ?', [eid])[0]
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
      run(
        'insert into archetype(entity, tables) values (?, ?) on conflict(entity) do nothing',
        [id, JSON.stringify(cache.get(eid)!.tables)],
      )
      ids.set(eid, id)
      made.add(id)
      counts.archetypes++
      // Register first, then recurse: meta points to itself.
      let target = eid == meta.eid ? id : mint(meta.eid)
      run('update entity set archetype = ? where id = ?', [target, id])
      return id
    }
    // Resolve all sets before assigning: a bare reference stub can become one
    // of the descriptors below, regardless of its position in the snapshot.
    let targets = [...owners].map(([owner, names]) =>
      [owner, mint(cache.intern(names).eid)] as const
    )
    for (let [owner, id] of targets) {
      if (!made.has(owner)) {
        run('update entity set archetype = ? where id = ?', [id, owner])
      }
      counts.entities++
    }
    driver.exec(`release ${savepoint}`)
    return counts
  } catch (error) {
    driver.exec(`rollback to ${savepoint}`)
    driver.exec(`release ${savepoint}`)
    throw error
  }
}
