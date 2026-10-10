// Immutable table sets and a connection-revision snapshot: planning reads no
// persistent rows until a catalog mutation or rollback invalidates that snapshot.
import { type Archetype, Archetypes, tablesOf } from '@yaks/archetype/sets'
import {
  type ArchetypeSet,
  archetypeSet,
  col,
  type Driver,
  isNull,
  lit,
  select,
  table,
  val,
} from '@yaks/sql/core'
import { revision } from '@yaks/sql/core'

let caches = new WeakMap<Driver, {
  sets: Archetypes
  text: Map<string, Archetype>
  // The last snapshot and the catalog version it was read at (below).
  descriptorVersion?: number
  descriptors?: ArchetypeSet
  ids?: Map<string, number>
  version?: number
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
  let cache = cacheFor(driver)
  let v = revision(driver, 'catalog')
  if (cache.version == v) return cache.set
  // Raw patch() can mint rows before classification. Keep that incomplete
  // snapshot as a declined catalog, and inspect it again only after a mutation.
  if (
    driver.query(select({
      cols: [lit(1)],
      from: table('entity'),
      where: isNull(col('archetype')),
      limit: val(1),
    })).length
  ) {
    cache.version = v
    cache.set = undefined
    return undefined
  }
  let version = revision(driver, 'descriptors')
  if (cache.descriptorVersion != version || !cache.descriptors) {
    let ids = new Map<string, number>()
    let all = select({
      cols: [col('entity'), col('tables')],
      from: table('archetype'),
    })
    for (let row of driver.query(all)) {
      let a = descriptor(driver, String(row.tables))
      ids.set(a.eid, Number(row.entity))
    }
    cache.descriptors = archetypeSet(cache.sets, ids)
    cache.ids = ids
    cache.descriptorVersion = version
  }

  cache.version = v
  return cache.set = cache.descriptors
}

/**
 * Descriptors this connection wrote, by entity id and table set, where they
 * are all that moved one since revision `from` (@yaks/sql `revision`): a
 * catalog current then takes them in and stays current, so the next plan
 * reads none of the descriptors it held. Any other catalog is read again.
 */
export function described(
  driver: Driver,
  from: number,
  rows: readonly { id: number; tables: string }[],
): void {
  let cache = cacheFor(driver)
  if (!cache.ids || cache.descriptorVersion != from) return
  let was = cache.descriptors
  for (let { id, tables } of rows) {
    cache.ids.set(descriptor(driver, tables).eid, id)
  }
  cache.descriptors = archetypeSet(cache.sets, cache.ids)
  cache.descriptorVersion = revision(driver, 'descriptors')
  if (cache.set == was) cache.set = cache.descriptors
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
  let cache = cacheFor(driver)
  return Object.assign((predicate: Parameters<ArchetypeSet>[0]) => {
    if (!loaded) {
      current = snapshot(driver)
      loaded = true
    }
    return current?.(predicate)
  }, {
    held: !!cache.descriptors &&
      cache.descriptorVersion == revision(driver, 'descriptors'),
  })
}
