// Only immutable table sets are cached. Read the catalog's current ids on each
// plan: an uncommitted descriptor may disappear and its rowid may be reused.
import { type Archetype, Archetypes, tablesOf } from '@yaks/archetype'
import {
  type ArchetypeSet,
  archetypeSet,
  as,
  col,
  count,
  type Driver,
  fn,
  isNull,
  lit,
  select,
  table,
  val,
} from '@yaks/sql'

let caches = new WeakMap<Driver, {
  sets: Archetypes
  text: Map<string, Archetype>
  // The last snapshot and the catalog version it was read at (below).
  version?: string
  set?: ArchetypeSet
}>()
let cacheFor = (driver: Driver) => {
  let cache = caches.get(driver)
  if (!cache) {
    cache = { sets: new Archetypes(), text: new Map() }
    caches.set(driver, cache)
  }
  return cache
}

// The catalog's version: one aggregate over the (small) archetype table, so a
// plan pays one statement to prove the last snapshot still stands instead of
// re-reading and re-interning every descriptor. Rows are appended when a new
// table set appears and are otherwise immutable, so count, newest id and total
// descriptor length move on every change. Re-reading 464 rows per compile was
// ~8 ms of a 55-subscription boot burst (T-37445).
let version = (driver: Driver) =>
  JSON.stringify(
    driver.query(select({
      cols: [
        as(count(), 'n'),
        as(fn('max', col('entity')), 'm'),
        as(fn('total', fn('length', col('tables'))), 't'),
      ],
      from: table('archetype'),
    }))[0],
  )

/** Decode a descriptor once, independent of its transaction-local row id. */
export function descriptor(driver: Driver, text: string): Archetype {
  let cache = cacheFor(driver)
  let a = cache.text.get(text)
  if (!a) {
    a = cache.sets.intern(tablesOf(text))
    cache.text.set(text, a)
  }
  return a
}

function snapshot(driver: Driver): ArchetypeSet | undefined {
  // Low-level patch() is also public, and can be used before the graph plugin
  // or boot backfill classifies its rows. Such a file still needs the legacy
  // predicates; a partial catalog must never silently hide unclassified rows.
  if (
    driver.query(select({
      cols: [lit(1)],
      from: table('entity'),
      where: isNull(col('archetype')),
      limit: val(1),
    })).length
  ) {
    return undefined
  }
  let cache = cacheFor(driver)
  let v = version(driver)
  if (cache.set && cache.version == v) return cache.set
  let ids = new Map<string, number>()
  let all = select({
    cols: [col('entity'), col('tables')],
    from: table('archetype'),
  })
  for (let row of driver.query(all)) {
    let a = descriptor(driver, String(row.tables))
    ids.set(a.eid, Number(row.entity))
  }
  cache.version = v
  return cache.set = archetypeSet(cache.sets, ids)
}

/**
 * A lazy, single-plan catalog snapshot. Value-only queries do not need it;
 * the first component-presence or kind predicate loads it and all others share
 * that snapshot.
 * Create one per compile, not once per connection. Compile and execute inside
 * the same transaction, so another writer cannot change the catalog between.
 */
export function catalog(driver: Driver): ArchetypeSet {
  let loaded = false
  let current: ArchetypeSet | undefined
  return (predicate) => {
    if (!loaded) {
      current = snapshot(driver)
      loaded = true
    }
    return current?.(predicate)
  }
}
