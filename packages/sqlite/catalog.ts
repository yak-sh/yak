// Only immutable table sets are cached. Read the catalog's current ids on each
// plan: an uncommitted descriptor may disappear and its rowid may be reused.
import { type Archetype, Archetypes, tablesOf } from '@yaks/archetype'
import { type ArchetypeSet, archetypeSet } from '@yaks/sql'
import type { Driver } from './driver.ts'

let caches = new WeakMap<Driver, {
  sets: Archetypes
  text: Map<string, Archetype>
}>()
let cacheFor = (driver: Driver) => {
  let cache = caches.get(driver)
  if (!cache) {
    cache = { sets: new Archetypes(), text: new Map() }
    caches.set(driver, cache)
  }
  return cache
}

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
    driver.query('select 1 from entity where archetype is null limit 1', [])
      .length
  ) {
    return undefined
  }
  let ids = new Map<string, number>()
  for (let row of driver.query('select entity, tables from archetype', [])) {
    let a = descriptor(driver, String(row.tables))
    ids.set(a.eid, Number(row.entity))
  }
  return archetypeSet(cacheFor(driver).sets, ids)
}

/**
 * A lazy, single-plan catalog snapshot. Value-only queries do not need it;
 * the first facet/kind predicate loads it and all others share that snapshot.
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
