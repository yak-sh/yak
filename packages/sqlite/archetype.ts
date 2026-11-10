import type { Bundle } from '@yaks/graph'
import { sha256 } from '@yaks/graph/sha256'
import { TOMBSTONE } from '@yaks/graph/bundle'
import { Archetypes, tablesOf } from '@yaks/archetype/sets'
import {
  and,
  as,
  col,
  cross,
  type Driver,
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
  oneOf,
  type Row,
  select,
  type Stmt,
  table,
  val,
} from '@yaks/sql'
import { componentTables } from './physical.ts'
import { descriptor } from './catalog.ts'
import { pointerIndex } from './ddl.ts'
import { catalogue } from '@yaks/sql'
import { mintSql } from './write.ts'
import { unit } from './unit.ts'
import { revision } from '@yaks/sql'
import { Unpointed } from './error.ts'
import { type Ledger, ledger } from './ledger.ts'
export { type Ledger, ledger } from './ledger.ts'

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
export type Backfill = {
  entities: number
  archetypes: number
  retired: number
}

// Physical discovery belongs to schema changes, not each gameplay write.
// revision observes the statements already passing through this connection;
// it also invalidates on rollback and on another file connection's DDL.
let facetsHeld = new WeakMap<Driver, { version: number; tables: string[] }>()
let facets = (driver: Driver): string[] => {
  let version = revision(driver, 'schema')
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

// The descriptors a connection's units found or minted, by eid, as each one's
// id, while no statement but theirs moved one (@yaks/sql `revision`): a unit
// pointing entities at an archetype it has met asks the file nothing for it.
let met = new WeakMap<object, { at: number; ids: Map<string, number> }>()
let descriptors = (driver: Driver) => {
  let at = revision(driver, 'descriptors')
  let held = met.get(driver.connection ?? driver)
  if (held?.at != at) {
    met.set(driver.connection ?? driver, held = { at, ids: new Map() })
  }
  return held
}

// Descriptor minting shared by boot and live reclassification. A descriptor is
// found by eid first; a bare spine that already has component rows is rejected
// rather than reused. The descriptor set {archetype} is its own fixed point.
let minter = (
  run: Run,
  driver: Driver,
  cache: Archetypes,
  ids: Map<string, number>,
  number: boolean,
  counts: Backfill,
) => {
  let meta = cache.intern(['archetype'])
  let made = new Set<number>()
  let born: Bundle[] = []
  let considered = new Map<number, string[]>()
  let mint = (eid: string): number => {
    let id = ids.get(eid)
    if (id != null) return id
    let existing = run(select({
      cols: [
        col('id', 'e'),
        as(col('entity', 'a'), 'descriptor'),
        col('tables', 'p'),
      ],
      from: table('entity', 'e'),
      joins: [
        left(table('archetype', 'a'), eq(col('entity', 'a'), col('id', 'e'))),
        left(
          table('archetype', 'p'),
          eq(col('entity', 'p'), col('archetype', 'e')),
        ),
      ],
      where: eq(col('eid', 'e'), val(eid)),
    }))[0]
    if (existing?.descriptor != null) {
      ids.set(eid, id = Number(existing.id))
      return id
    }
    if (existing) {
      let pointed = existing.tables == null
        ? null
        : descriptor(driver, String(existing.tables)).tables
      let held = considered.get(Number(existing.id)) ??
        ledger(driver).held(eid, pointed)
      if (!held) throw new Unpointed([eid])
      if (held.length) throw new Error(`Archetype identity is occupied: ${eid}`)
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
    considered = owners
    let groups = new Map<string, { names: string[]; owners: number[] }>()
    for (let [owner, names] of owners) {
      let key = JSON.stringify(names)
      let group = groups.get(key)
      if (!group) groups.set(key, group = { names, owners: [] })
      group.owners.push(owner)
    }
    let targets = [...groups.values()].map((g) =>
      [g.owners, mint(cache.intern(g.names).eid), g.names] as const
    )
    for (let [owners, id] of targets) {
      let pending = owners.filter((owner) => !made.has(owner))
      for (let i = 0; i < pending.length; i += 2048) {
        run(point(id, oneOf(col('id'), pending.slice(i, i + 2048))))
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
 * vocab. Retires forever a descriptor naming a table that is missing or no
 * longer a component table (a key renamed away from `entity`); reclassifies
 * their owners, plus null assignments, in table-sized scans. No per-owner
 * component census.
 */
export function backfill(driver: Driver, number = false): Backfill {
  let run: Run = (s) => driver.query(s)
  let counts: Backfill = { entities: 0, archetypes: 0, retired: 0 }
  return unit(driver, () => {
    // The catalog's missing-pointer lookup must seek even while a new store
    // is being classified. This index is part of classification's repair.
    if (
      !catalogue(driver).some((o) =>
        o.name == pointerIndex.name || o.name == `${pointerIndex.name}_num`
      )
    ) {
      driver.query(pointerIndex)
    }
    let cache = new Archetypes()
    // What the file holds is read once, and only when something is asked of
    // it: a fresh file reads nothing, and a file with descriptors reads which
    // of its tables are component tables, once, to know none names another.
    let tables = once(() => componentTables(driver))
    let present = once(() => new Set(tables()))
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
          // The catalogue is small; drive its primary-key lookups, never
          // let a no-statistics Store scan every retained entity instead.
          cross(table('entity', 'e')),
          left(
            table('retired', 'r'),
            eq(col('entity', 'r'), col('entity', 'a')),
          ),
        ],
        where: eq(col('id', 'e'), col('entity', 'a')),
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
    if (stale.length) run(point(null, oneOf(col('archetype'), stale)))

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
    minter(run, driver, cache, ids, number, counts).assign(owners)
    return counts
  })
}

// The entities `which` names that are not descriptors themselves, with the
// eid of the archetype each one points at and the tables it names.
let owned = (which: Expr) =>
  select({
    cols: [
      col('id', 'e'),
      col('eid', 'e'),
      col('archetype', 'e'),
      as(col('eid', 'd'), 'assigned'),
      as(col('tables', 'p'), 'pointed'),
    ],
    from: table('entity', 'e'),
    joins: [
      left(table('entity', 'd'), eq(col('id', 'd'), col('archetype', 'e'))),
      left(table('archetype', 'p'), eq(col('entity', 'p'), col('id', 'd'))),
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
    // A window's pointers and rows are read in one snapshot, so a writer
    // committing between the two is never counted as drift.
    let [rows, owners] = unit(driver, () => {
      let rows = run(
        owned(and(gt(col('id', 'e'), val(lo)), le(col('id', 'e'), val(hi)))),
      )
      return [
        rows,
        rows.length
          ? presence(
            run,
            tables,
            new Map(rows.map((r) => [Number(r.id), [] as string[]])),
            (c) => ({ where: and(gt(c, val(lo)), le(c, val(hi))) }),
          )
          : new Map<number, string[]>(),
      ] as const
    }, 'read')
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
 * Every owner the audit finds out of step ({@link drift}) classified again
 * from the rows it holds, a few thousand to a unit, so a large file never
 * holds the write lock for the whole pass: the repair for pointers a writer
 * past every door left behind. Returns how many moved.
 */
export let mend = (driver: Driver, number = false): number => {
  let { sample } = drift(driver, Infinity)
  let moved = 0
  for (let i = 0; i < sample.length; i += 5000) {
    moved += reclassify(driver, sample.slice(i, i + 5000), number)
      .filter((b) => b.archetype == null).length
  }
  return moved
}

// Each of these entities' eid with the tables its stored pointer names, or
// null where it names no descriptor. One statement reads the pointers.
let pointers = (driver: Driver, eids: string[]) =>
  driver.query(select({
    cols: [col('eid', 'e'), col('tables', 'a')],
    from: table('entity', 'e'),
    joins: [
      left(
        table('archetype', 'a'),
        eq(col('entity', 'a'), col('archetype', 'e')),
      ),
    ],
    where: oneOf(col('eid', 'e'), [...new Set(eids)]),
  })).map((row): [string, readonly string[] | null] => [
    String(row.eid),
    row.tables == null ? null : descriptor(driver, String(row.tables)).tables,
  ])

/**
 * The tables these entities hold rows in, as their removal clears them: each
 * one's stored archetype, as the connection's ledger amends it for what the
 * open transaction wrote since ({@link Ledger} `held`), among the component
 * tables the file holds. One statement reads the pointers, so a removal costs
 * the tables its entities wear rather than every table in the file.
 *
 * The pointer is exact wherever no unit is open: every door classifies what it
 * wrote before its unit closes, and a raw writer calls {@link reclassify}
 * (what {@link drift} audits). An entity with no pointer that the transaction
 * did not mint is a failure: `lost` repairs those, as {@link reclassify} does
 * before their tables are read again; without one, the failure is thrown.
 */
export function heldBy(
  driver: Driver,
  eids: string[],
  book?: Ledger,
  lost?: (eids: string[]) => void,
): string[] {
  let held = new Set<string>()
  let missing: string[] = []
  let take = (rows: [string, readonly string[] | null][]) => {
    for (let [eid, pointed] of rows) {
      let tables = book ? book.held(eid, pointed) : pointed
      if (tables) { for (let t of tables) held.add(t) }
      else missing.push(eid)
    }
  }
  take(pointers(driver, eids))
  if (missing.length) {
    let unknown = missing
    missing = []
    if (!lost) throw new Unpointed(unknown)
    lost(unknown)
    take(pointers(driver, unknown))
  }
  return componentTables(driver, [], [...held])
}

/**
 * Point these entities, just removed, at the tombstone set, minting its
 * descriptor the first time a store needs one. A removal clears every table
 * its entities hold rows in ({@link heldBy}), so what each one holds afterwards
 * is its tombstone and nothing else, known without reading a table. A unit
 * calls this for the dead its ledger still owes a pointer ({@link Ledger}
 * `buried`) as it closes, so the dead leave their archetype whichever door
 * removed them, and a presence lookup passes them by. Answers whether it
 * minted a descriptor.
 */
export function entomb(
  driver: Driver,
  eids: string[],
  number = false,
): boolean {
  if (!eids.length) return false
  let run: Run = (s) => driver.query(s)
  return unit(driver, () => {
    let cache = new Archetypes()
    let counts: Backfill = { entities: 0, archetypes: 0, retired: 0 }
    let found = descriptors(driver)
    let { mint } = minter(
      run,
      driver,
      cache,
      found.ids,
      number,
      counts,
    )
    let dead = mint(cache.intern([TOMBSTONE]).eid)
    found.at = revision(driver, 'descriptors')
    run(point(dead, oneOf(col('eid'), [...new Set(eids)])))
    return counts.archetypes > 0
  })
}

/**
 * Classify the named entities from their physical presence, now, inside the
 * caller's transaction. For rows an application wrote past the graph (raw SQL
 * into a component table), and the repair of an entity met with no archetype:
 * no queue, no triggers, the same presence rule as boot. Returns the pointers
 * that moved and any descriptor minted, as bundles an application can
 * broadcast. Descriptors and unknown eids are left alone.
 */
export function reclassify(
  driver: Driver,
  eids: string[],
  number = false,
): Bundle[] {
  return unit(driver, () => {
    let { born, put } = sorted(driver, eids, number)
    return [
      ...born,
      ...put.flatMap(([owners, id]) => {
        let [row] = driver.query(
          select({
            cols: [col('eid')],
            from: table('entity'),
            where: byId(id),
          }),
        )
        return owners.map((eid) => ({
          entity: { eid, archetype: String(row.eid) },
        }))
      }),
    ]
  })
}

/**
 * A unit settling what it owes: each entity pointed at the archetype of the
 * tables it holds, which `known` says from its pointer and the unit's ledger
 * (given the tables the pointer names), so no table is read. Only an entity
 * `known` cannot speak for is read from the rows it holds, as a repair is.
 * `learned` hears the archetype, by its id, each entity is found or put in.
 * It runs inside the unit that owes them, which makes it all or nothing, and
 * answers whether it minted a descriptor.
 */
export let classify = (
  driver: Driver,
  eids: string[],
  number: boolean,
  known?: Known,
  learned?: Learned,
): boolean => sorted(driver, eids, number, known, learned).born.length > 0

type Known = (
  eid: string,
  pointed: readonly string[] | null,
) => string[] | undefined
type Learned = (eid: string, tables: string[], id: number) => void

// The named entities put in the archetype of the tables each holds: the
// descriptors minted for it, and the eids pointed at each archetype's id.
let sorted = (
  driver: Driver,
  eids: string[],
  number: boolean,
  known?: Known,
  learned?: Learned,
): { born: Bundle[]; put: [string[], number][] } => {
  let none = { born: [], put: [] }
  if (!eids.length) return none
  let run: Run = (s) => driver.query(s)
  let cache = new Archetypes()
  let tables = once(() => facets(driver))
  let rows = run(owned(oneOf(col('eid', 'e'), [...new Set(eids)])))
  if (!rows.length) return none
  let owners = new Map<number, string[]>()
  let ids: number[] = []
  for (let r of rows) {
    let pointed = r.pointed == null
      ? null
      : descriptor(driver, String(r.pointed)).tables
    let held = known?.(String(r.eid), pointed)
    owners.set(Number(r.id), held ?? [])
    if (!held) ids.push(Number(r.id))
  }
  if (ids.length) {
    presence(run, tables(), owners, (c) => ({ where: oneOf(c, ids) }))
  }
  let moved = new Map<number, string>()
  for (let r of rows) {
    let names = owners.get(Number(r.id))!
    if (cache.intern(names).eid == r.assigned) {
      learned?.(String(r.eid), names, Number(r.archetype))
      owners.delete(Number(r.id))
    } else moved.set(Number(r.id), String(r.eid))
  }
  if (!owners.size) return none
  let counts: Backfill = { entities: 0, archetypes: 0, retired: 0 }
  let found = descriptors(driver)
  let { assign, born } = minter(
    run,
    driver,
    cache,
    found.ids,
    number,
    counts,
  )
  let put = assign(owners).map(([group, id, names]): [string[], number] => {
    let eids = group.map((owner) => moved.get(owner)!)
    for (let eid of eids) learned?.(eid, names, id)
    return [eids, id]
  })
  found.at = revision(driver, 'descriptors')
  return { born, put }
}

/** The table sets the open write knows instead of its stored pointers. */
export let pendingShapes = (
  driver: Driver,
  book: Ledger,
): Map<number, readonly string[]> => {
  let eids = book.owed()
  if (!eids.length) return new Map()
  return new Map(
    driver.query(owned(oneOf(col('eid', 'e'), eids))).map((r) => {
      let eid = String(r.eid)
      let pointed = r.pointed == null
        ? null
        : descriptor(driver, String(r.pointed)).tables
      let held = book.held(eid, pointed)
      if (!held) throw new Unpointed([eid])
      return [Number(r.id), held]
    }),
  )
}
