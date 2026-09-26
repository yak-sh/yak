import { type Bundle, sha256 } from '@yaks/graph'
import { Archetypes, tablesOf } from '@yaks/archetype'
import {
  among,
  and,
  as,
  col,
  type Driver,
  each,
  eq,
  type Expr,
  fn,
  gt,
  isNull,
  type Join,
  join,
  le,
  left,
  lit,
  type Row,
  select,
  type Stmt,
  table,
  val,
} from '@yaks/sql'
import { componentTables, tables as listed } from './physical.ts'
import { mintSql } from './write.ts'
import { unit } from './unit.ts'

export { componentTables } from './physical.ts'

type Run = (s: Stmt) => Row[]

// A value read the first time it is asked for, and kept.
let once = <T>(read: () => T): () => T => {
  let held: { value: T } | undefined
  return () => (held ??= { value: read() }).value
}

// The entity an eid names, and the one an id does.
let byEid = (eid: string) => eq(col('eid'), val(eid))
let byId = (id: number) => eq(col('id'), val(id))

// Whether `t` holds a row for this owner.
let holds = (run: Run, t: string, owner: number) =>
  run(select({
    cols: [col('entity')],
    from: table(t),
    where: eq(col('entity'), val(owner)),
  })).length > 0

// Point entities at an archetype.
let point = (target: number | null, which: Expr): Stmt => ({
  t: 'update',
  table: 'entity',
  set: { archetype: val(target) },
  where: which,
})

/** Counts from a boot: existing assignments stay untouched on a repeated run. */
export type Backfill = { entities: number; archetypes: number; retired: number }

// The component tables of a file change only with its schema, so one
// `pragma schema_version` validates the cached list instead of a table_info per
// table per call.
let facetsHeld = new WeakMap<Driver, { version: number; tables: string[] }>()
let facets = (driver: Driver): string[] => {
  let version = Number(
    driver.query({ t: 'pragma', name: 'schema_version' })[0].schema_version,
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
  which: (c: Expr) => { joins?: Join[]; where: Expr },
) => {
  for (let name of tables) {
    let w = which(col('entity', 'c'))
    for (
      let row of run(select({
        cols: [col('entity', 'c')],
        from: table(name, 'c'),
        joins: w.joins,
        where: w.where,
      }))
    ) {
      owners.get(Number(row.entity))?.push(name)
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
  tables: () => string[],
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
    let existing = run(select({
      cols: [col('id', 'e'), as(col('entity', 'a'), 'descriptor')],
      from: table('entity', 'e'),
      joins: [
        left(table('archetype', 'a'), eq(col('entity', 'a'), col('id', 'e'))),
      ],
      where: eq(col('eid', 'e'), val(eid)),
    }))[0]
    if (existing?.descriptor != null) {
      ids.set(eid, id = Number(existing.id))
      return id
    }
    if (existing && tables().some((t) => holds(run, t, Number(existing.id)))) {
      throw new Error(`Archetype identity is occupied: ${eid}`)
    }
    driver.query(mintSql(eid, number))
    id = Number(
      run(
        select({ cols: [col('id')], from: table('entity'), where: byEid(eid) }),
      )[0]
        .id,
    )
    let list = JSON.stringify(cache.get(eid)!.tables)
    run({
      t: 'insert',
      into: 'archetype',
      cols: ['entity', 'tables'],
      rows: [[val(id), val(list)]],
      upsert: [{ on: [col('entity')] }],
    })
    ids.set(eid, id)
    made.add(id)
    counts.archetypes++
    // Register first, then recurse: meta points to itself.
    let target = eid == meta.eid ? id : mint(meta.eid)
    run(point(target, byId(id)))
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
        run(point(id, among(col('id'), each(pending.slice(i, i + 2048)))))
      }
      counts.entities += owners.length
    }
    return targets
  }
  return { mint, assign, made, born }
}

/**
 * Every entity classified again from the tables it holds rows in, not only the
 * unclassified ones: what a pass that wrote component tables directly, outside
 * the graph, leaves to do. Atomic, like {@link backfill}.
 */
export let reclassifyAll = (driver: Driver, number = false): Backfill =>
  unit(driver, () => {
    driver.query({
      t: 'update',
      table: 'entity',
      set: { archetype: lit(null) },
    })
    return backfill(driver, number)
  })

/**
 * Idempotent, atomic boot maintenance, after additive DDL has installed the
 * column and archetype vocabulary. Reads presence from the physical file, not
 * vocab. Retires missing-table descriptors forever; reclassifies their owners,
 * plus null assignments, in table-sized scans. No per-owner component census.
 */
export function backfill(driver: Driver, number = false): Backfill {
  let run: Run = (s) => driver.query(s)
  let counts: Backfill = { entities: 0, archetypes: 0, retired: 0 }
  return unit(driver, () => {
    let cache = new Archetypes()
    // What the file holds is read once, and only when something is asked of
    // it: a fresh file reads neither, and one whose every entity is already
    // classified never reads its component tables.
    let tables = once(() => componentTables(driver))
    let present = once(() => new Set(listed(driver)))
    let ids = new Map<string, number>()
    let stale: number[] = []
    for (
      let row of run(select({
        cols: [
          col('entity', 'a'),
          col('eid', 'e'),
          col('tables', 'a'),
          as(col('entity', 'r'), 'retired'),
        ],
        from: table('archetype', 'a'),
        joins: [
          join(table('entity', 'e'), eq(col('id', 'e'), col('entity', 'a'))),
          left(
            table('retired', 'r'),
            eq(col('entity', 'r'), col('entity', 'a')),
          ),
        ],
      }))
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
          tables().some((t) =>
            t != 'archetype' && t != 'retired' &&
            holds(run, t, Number(row.entity))
          )
        ) {
          throw new Error(
            `Legacy archetype identity has extra facets: ${row.eid}`,
          )
        }
        let taken = select({
          cols: [col('id')],
          from: table('entity'),
          where: byEid(a.eid),
        })
        if (run(taken).length) {
          throw new Error(`Archetype identity is occupied: ${a.eid}`)
        }
        run({
          t: 'update',
          table: 'entity',
          set: { eid: val(a.eid) },
          where: byId(Number(row.entity)),
        })
      }
      let id = Number(row.entity)
      ids.set(a.eid, id)
      if (a.tables.some((t) => !present().has(t))) {
        stale.push(id)
        if (row.retired == null) {
          run({
            t: 'insert',
            into: 'retired',
            cols: ['entity'],
            rows: [[val(id)]],
          })
          run(point(null, byId(id)))
          counts.retired++
        }
      }
    }
    if (stale.length) run(point(null, among(col('archetype'), each(stale))))

    // Snapshot the incomplete owners before minting descriptors. New descriptors
    // are classified directly below; they never need another whole-file pass.
    let owners = new Map<number, string[]>(
      run(select({
        cols: [col('id')],
        from: table('entity'),
        where: isNull(col('archetype')),
      })).map((r) => [Number(r.id), []]),
    )
    if (owners.size) {
      presence(run, tables(), owners, (c) => ({
        joins: [join(table('entity', 'e'), eq(col('id', 'e'), c))],
        where: isNull(col('archetype', 'e')),
      }))
    }
    minter(run, driver, cache, tables, ids, number, counts).assign(owners)
    return counts
  })
}

// The entities `which` names that are not descriptors themselves, with the
// eid of the archetype each one points at.
let owned = (which: Expr) =>
  select({
    cols: [
      col('id', 'e'),
      col('eid', 'e'),
      col('archetype', 'e'),
      as(col('eid', 'd'), 'assigned'),
    ],
    from: table('entity', 'e'),
    joins: [
      left(table('entity', 'd'), eq(col('id', 'd'), col('archetype', 'e'))),
      left(table('archetype', 'a'), eq(col('entity', 'a'), col('id', 'e'))),
    ],
    where: and(isNull(col('entity', 'a')), which),
  })

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
  let run: Run = (s) => driver.query(s)
  let tables = facets(driver)
  let cache = new Archetypes()
  // Presence set (as the joined table names) → the descriptor it interns to.
  // The whole file holds a few hundred distinct sets, so hashing one per
  // window's worth of owners would be the audit's dominant cost.
  let known = new Map<string, string>()
  let out: Drift = { checked: 0, drifted: 0, sample: [] }
  let top = Number(
    run(
      select({
        cols: [as(fn('max', col('id')), 'top')],
        from: table('entity'),
      }),
    )[0]
      ?.top ?? 0,
  )
  for (let lo = 0; lo < top; lo += WINDOW) {
    let hi = lo + WINDOW
    let rows = run(
      owned(and(gt(col('id', 'e'), val(lo)), le(col('id', 'e'), val(hi)))),
    )
    if (!rows.length) continue
    let owners = presence(
      run,
      tables,
      new Map(rows.map((r) => [Number(r.id), [] as string[]])),
      (c) => ({ where: and(gt(c, val(lo)), le(c, val(hi))) }),
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
  let run: Run = (s) => driver.query(s)
  return unit(driver, () => {
    let cache = new Archetypes()
    let tables = facets(driver)
    let rows = run(owned(among(col('eid', 'e'), each([...new Set(eids)]))))
    if (!rows.length) return []
    let owners = new Map<number, string[]>(
      rows.map((r) => [Number(r.id), []]),
    )
    let ids = [...owners.keys()]
    presence(run, tables, owners, (c) => ({ where: among(c, each(ids)) }))
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
      () => tables,
      new Map(),
      number,
      counts,
    )
    let echoes: Bundle[] = []
    for (let [group, id] of assign(owners)) {
      let archetype = String(
        run(
          select({
            cols: [col('eid')],
            from: table('entity'),
            where: byId(id),
          }),
        )[0]
          .eid,
      )
      for (let owner of group) {
        echoes.push({ entity: { eid: moved.get(owner)!, archetype } })
      }
    }
    return [...born, ...echoes]
  })
}
