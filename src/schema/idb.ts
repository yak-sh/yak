// The IndexedDB backend: the browser's durable graph, its stores and indexes
// GENERATED from the vocabulary, plus a store-backed Resolver that answers the
// SAME query.ts `Pred[]` the in-memory resolver does (resolver.ts) — one query
// set, two backings, identical answers. Storage is truth: rows live in IDB, one
// object store per component (keyPath 'eid'), and a query resolves by opening
// the generated indexes rather than scanning a whole-graph mirror.
//
// The schema is DERIVED, never hand-kept: `indexesFor` (index.ts) merges the
// auto single-column index every `{eid}` reference earns from `refCols` with the
// composite/`unique` declarations in `indexes` (types.ts) — the same one set the
// cache and the SQL DDL read. A composite index becomes an array keyPath;
// `unique` is honored; a `where` clause has no IDB analog, so a partial index
// degrades to a full one and the resolver applies the predicate in memory. The
// store version is a hash of the generated shape, so any vocabulary change bumps
// it and triggers an upgrade.
//
// IDB is async and browser-only, but the seam (resolver.ts) is synchronous. The
// gap is bridged the way a live UI already reads: `subscribe` returns a signal
// filled the moment the indexed reads settle, `resolve` returns the latest
// settled snapshot, and `ready` is the async one-shot the parity test awaits.
import { comps, type Idx, stamped } from '../types.ts'
import { implies, indexesFor } from '../index.ts'
import { leafOf, listed, matchQuery, ORDER, type Pred, TEXT } from '../query.ts'
import { isRef } from '../props.ts'
import type { Resolver } from '../resolver.ts'
import { type Signal, signal } from '@preact/signals'

// A merged-components bag, the shape both the live cache and a client Row speak
// — the same structural row index.ts, query.ts and resolver.ts pass around.
type Row = Record<string, Record<string, unknown> | undefined>

// ---- the generator ----

export type IdbIndex = {
  name: string
  keyPath: string | string[]
  unique: boolean
}
export type IdbStore = { name: string; keyPath: 'eid'; indexes: IdbIndex[] }

// The infrastructure store beside the generated component stores: fixed-key
// rows carrying the delta cursor the mirror has advanced to (see graphMeta). It
// is NOT a component — storeNames/putBags/seedIdb never touch it — so it is
// named here and threaded only through openIdb/applySchema and the meta reads.
export let META = '_meta'

// An index's name within its store: the component and its columns, the same
// `comp_col` shape db.ts spells its SQL indexes with.
let idxName = (comp: string, cols: string[]) => `${comp}_${cols.join('_')}`

// Every component a merged bag can carry — the `comps` ∪ `stamped` union
// refCols/propOwners already walk (entity, every wire component, and the
// stamped-only facets: archived, quarantined, recall). One store each.
export let storeNames = (): string[] => [
  ...new Set([...Object.keys(comps), ...Object.keys(stamped)]),
]

// One component's store: keyed by eid, indexed by every entry `indexesFor`
// merges. A composite is an array keyPath; `where` is dropped (a full index,
// the resolver screens the rest).
export let idbStore = (comp: string): IdbStore => ({
  name: comp,
  keyPath: 'eid',
  indexes: indexesFor(comp).map((i: Idx): IdbIndex => ({
    name: idxName(comp, i.cols),
    keyPath: i.cols.length == 1 ? i.cols[0] : i.cols,
    unique: !!i.unique,
  })),
})

export let idbStores = (): IdbStore[] => storeNames().map(idbStore)

// The generated shape, canonicalized — store names and their index
// name/keyPath/unique, plus the fixed META store so its presence is part of the
// version (a client without it upgrades to create it). What the version hashes
// over.
export let schemaShape = (stores: IdbStore[] = idbStores()): string =>
  JSON.stringify([
    META,
    stores.map((
      s,
    ) => [s.name, s.indexes.map((i) => [i.name, i.keyPath, i.unique])]),
  ])

// FNV-1a over the shape → a positive integer version. Any store or index change
// moves it, which is exactly the signal onupgradeneeded waits for.
let fnv1a = (s: string): number => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// IDB versions must be a positive integer; keep it under 2^31 to stay safe.
export let schemaVersion = (stores: IdbStore[] = idbStores()): number =>
  (fnv1a(schemaShape(stores)) % 0x7fffffff) + 1

// The onupgradeneeded body: create every MISSING store and index. Additive —
// existing stores and indexes are left whole, so a bumped version never reshapes
// data already on disk, only extends it.
export let applySchema = (
  db: IDBDatabase,
  tx: IDBTransaction,
  stores: IdbStore[] = idbStores(),
) => {
  if (!db.objectStoreNames.contains(META)) db.createObjectStore(META)
  for (let s of stores) {
    let store = db.objectStoreNames.contains(s.name)
      ? tx.objectStore(s.name)
      : db.createObjectStore(s.name, { keyPath: s.keyPath })
    let have = new Set(Array.from(store.indexNames))
    for (let i of s.indexes) {
      if (!have.has(i.name)) {
        store.createIndex(i.name, i.keyPath, { unique: i.unique })
      }
    }
  }
}

// Open (creating/upgrading) the generated database.
export let openIdb = (
  name = 'tasks',
  factory: IDBFactory = indexedDB,
  stores: IdbStore[] = idbStores(),
): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    let r = factory.open(name, schemaVersion(stores))
    r.onupgradeneeded = () => applySchema(r.result, r.transaction!, stores)
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
    r.onblocked = () => reject(new Error(`idb ${name} blocked`))
  })

// ---- async plumbing over the request/event model ----

let req = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((res, rej) => {
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })

let done = (tx: IDBTransaction): Promise<void> =>
  new Promise((res, rej) => {
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
    tx.onabort = () => rej(tx.error)
  })

// A stored record is `{ eid, ...cols }`; the bag drops the key back off.
let strip = (row: Record<string, unknown>): Record<string, unknown> => {
  let { eid: _eid, ...cols } = row
  return cols
}

// ---- writes (cache → durable store) ----

// Mirror one entity's merged bag into the per-component stores: put where a
// component is present, delete where it is absent. The write path slice (e)
// drives from applyLocal's touched eids; the tests seed through putBags.
export let putBag = (
  db: IDBDatabase,
  eid: string,
  bag: Row,
  names: string[] = storeNames(),
): Promise<void> => putBags(db, [[eid, bag]], names)

// The batched write: many bags in ONE transaction, so a live frame touching a
// handful of eids pays one commit, not one per eid. Absent components are
// deleted from their store (a removed component must leave the durable store,
// not linger), which is why every store name rides the transaction even when a
// bag names none of them.
export let putBags = async (
  db: IDBDatabase,
  entries: (readonly [string, Row])[],
  names: string[] = storeNames(),
): Promise<void> => {
  if (!entries.length) return
  let tx = db.transaction(names, 'readwrite')
  let stores = new Map(names.map((n) => [n, tx.objectStore(n)]))
  for (let [eid, bag] of entries) {
    for (let name of names) {
      let comp = bag[name]
      let store = stores.get(name)!
      if (comp) store.put({ eid, ...comp })
      else store.delete(eid)
    }
  }
  await done(tx)
}

// Empty every store — the wholesale-reset first half, before a fresh seed
// replaces the graph (a snapshot reset, an epoch change).
export let clearIdb = async (
  db: IDBDatabase,
  names: string[] = storeNames(),
): Promise<void> => {
  let tx = db.transaction(names, 'readwrite')
  for (let name of names) tx.objectStore(name).clear()
  await done(tx)
}

// ---- the durable cursor (delta-sync high-water mark) ----

// Which cache cursor — and server epoch — the per-component stores currently
// reflect. A returning boot reads this to decide whether the store is already a
// faithful mirror of the just-hydrated cache (skip the whole-graph reseed) or
// must be re-seeded. Kept in lockstep with the hydration store's cursor
// (idb.ts) so a graceful reload finds them equal. Empty ⇒ never seeded ⇒ reseed.
export type GraphMeta = { cursor?: number; epoch?: string }

export let graphMeta = async (db: IDBDatabase): Promise<GraphMeta> => {
  let tx = db.transaction(META, 'readonly')
  let ms = tx.objectStore(META)
  let [cursor, epoch] = await Promise.all([
    req(ms.get('cursor')),
    req(ms.get('epoch')),
  ])
  return {
    cursor: cursor as number | undefined,
    epoch: epoch as string | undefined,
  }
}

// Stamp the high-water mark. The caller advances it ONLY after the matching
// delta write has settled (same storeWork callback, after the mirror), so the
// cursor is never ahead of the data it claims — the boot skip decision can trust
// it, and a failed mirror simply leaves the cursor behind (a safe reseed next
// boot).
export let putGraphMeta = async (
  db: IDBDatabase,
  meta: GraphMeta,
): Promise<void> => {
  let tx = db.transaction(META, 'readwrite')
  let ms = tx.objectStore(META)
  if (meta.cursor !== undefined) ms.put(meta.cursor, 'cursor')
  if (meta.epoch !== undefined) ms.put(meta.epoch, 'epoch')
  await done(tx)
}

// Seed the whole graph, chunked so one transaction never carries the entire
// cache. PUT-ONLY, and only over the stores a chunk actually writes: seed always
// runs on a cleared or fresh store, so the delete-absent putBags does for a live
// patch is pure cost here — the killer at graph scale, one delete per absent
// component per entity (~40× the real work). A re-seed is paired with clearIdb
// (resetQueries) so nothing stale survives it.
export let seedIdb = async (
  db: IDBDatabase,
  graph: Record<string, Row>,
  names: string[] = storeNames(),
): Promise<void> => {
  let allow = new Set(names)
  let entries = Object.entries(graph)
  for (let i = 0; i < entries.length; i += 1000) {
    let chunk = entries.slice(i, i + 1000)
    let touched = new Set<string>()
    for (let [, bag] of chunk) {
      for (let name of Object.keys(bag)) if (allow.has(name)) touched.add(name)
    }
    if (!touched.size) continue
    let only = [...touched]
    let tx = db.transaction(only, 'readwrite')
    let stores = new Map(only.map((n) => [n, tx.objectStore(n)]))
    for (let [eid, bag] of chunk) {
      for (let name of only) {
        let comp = bag[name]
        if (comp) stores.get(name)!.put({ eid, ...comp })
      }
    }
    await done(tx)
  }
}

// ---- the store-backed resolver ----

let queryKey = (preds: Pred[]) => JSON.stringify(preds)

// One column read across a bag: a named component reads that column, a shared
// route ('') reads it off every component carrying it — the same fan query.ts
// `reads` does, used here only to FOLLOW a path's ref hops (the matcher still
// decides the leaf, so this can over-collect harmlessly).
let refsAt = (bag: Row | undefined, comp: string, prop: string): unknown[] =>
  comp
    ? [bag?.[comp]?.[prop]]
    : Object.values(bag ?? {}).map((c) => c?.[prop]).filter((v) => v != null)

// The stores a query could touch — the components its preds and paths name,
// plus `created` only where `updated.at`'s fallback reads it. Quarantine is NOT
// here: it is a whole-store key set read once (a rare facet), not a per-row get.
// A shared route ('') reads across every component, so it forces the full set
// (null), and quarantine already rides along.
let touched = (preds: Pred[]): string[] | null => {
  let s = new Set<string>()
  for (let p of preds) {
    if (p.op == ORDER) continue
    if (p.op == TEXT) {
      s.add('doc')
      continue
    }
    if (!p.comp) return null
    s.add(p.comp)
    for (let h of p.at ?? []) {
      if (!h.comp) return null
      s.add(h.comp)
    }
    let leaf = leafOf(p)
    if (!leaf.comp) return null
    s.add(leaf.comp)
    if (p.comp == 'updated' || leaf.comp == 'updated') s.add('created')
  }
  // Empty (an ORDER-only query) → the full set, so the readonly transaction
  // never opens with an empty scope.
  return s.size ? [...s] : null
}

// A ref-equality pred is anchored by its component's auto index — the same
// condition index.ts `anchor` uses (a single {eid} column, `=`, one literal
// value). A shared route ('') can't name one store, so it stays unanchored.
let refEq = (p: Pred): boolean =>
  !p.at && !!p.comp && !!p.prop && p.op == '' && !!p.value &&
  !p.value.includes(',') && !/\.\./.test(p.value) && isRef(p.comp, p.prop)

export type IdbResolver = Resolver & {
  // The async one-shot: open the indexes, resolve, settle. The parity test and
  // any awaitable caller use this; `resolve` returns its latest result.
  ready: (preds: Pred[]) => Promise<string[]>
  // Re-test the touched eids against every held query, row-locally (the durable
  // store already holds the new data — this refreshes the live signals).
  refresh: (eids: Set<string>) => Promise<void>
  // Re-run every held query wholesale (a bulk load / reset).
  reset: () => Promise<void>
  hold: (preds: Pred[]) => Signal<string[]>
  drop: (preds: Pred[]) => void
}

// Same-set, order-insensitive: whether two eid lists hold the same members, so
// the async scan skips re-publishing a signal a synchronous prime already
// filled with the identical answer (a redundant reference change would wake
// every subscriber for nothing).
let sameSet = (a: string[], b: string[]): boolean => {
  if (a.length != b.length) return false
  let s = new Set(a)
  return b.every((x) => s.has(x))
}

export let idbResolver = (
  db: IDBDatabase,
  stores: IdbStore[] = idbStores(),
  // A synchronous first value for a freshly-created query signal, so a live UI
  // paints its rows on the mounting frame rather than empty-then-filled. live.ts
  // supplies the in-memory resolver's anchored scan (O(result), never a
  // full-cache scan); the async IDB scan then confirms the identical set on
  // settle. Absent (the tests), a new signal starts empty.
  prime?: (preds: Pred[]) => string[],
  // A gate the store's OWN reads wait on — the background seed. Until it
  // settles the store is only partly filled, so a scan would overwrite a correct
  // primed answer with a short one; awaiting it here means every read reflects
  // the whole graph. Absent (the tests, a pre-seeded db), reads run immediately.
  gate?: Promise<unknown>,
): IdbResolver => {
  let names = stores.map((s) => s.name)
  let sets = new Map<
    string,
    { preds: Pred[]; ids: Signal<string[]>; n: number }
  >()

  // Bulk-read the full bag for each eid in ONE readonly transaction: a get per
  // (store, eid), all concurrent. `only` narrows to the stores a query needs.
  let readBags = async (
    eids: string[],
    only: string[],
  ): Promise<Map<string, Row>> => {
    let out = new Map<string, Row>(eids.map((e) => [e, {}]))
    if (!eids.length) return out
    let tx = db.transaction(only, 'readonly')
    await Promise.all(
      only.flatMap((name) =>
        eids.map((e) =>
          req(tx.objectStore(name).get(e)).then((row) => {
            if (row) out.get(e)![name] = strip(row as Record<string, unknown>)
          })
        )
      ),
    )
    return out
  }

  let merge = (into: Map<string, Row>, from: Map<string, Row>) => {
    for (let [e, bag] of from) into.set(e, bag)
  }

  // Load the seed rows, then walk every path pred's hops loading each target
  // bag, so the (synchronous) matcher's `ent` deref always lands on a hydrated
  // row. Over-loading a hop is harmless — matchQuery still decides.
  let hydrate = async (
    preds: Pred[],
    seeds: string[],
    only: string[],
    bags: Map<string, Row>,
  ) => {
    let miss = seeds.filter((e) => !bags.has(e))
    if (miss.length) merge(bags, await readBags(miss, only))
    for (let p of preds) {
      if (!p.at) continue
      let hops = [{ comp: p.comp, prop: p.prop }, ...p.at.slice(0, -1)]
      let frontier = seeds
      for (let h of hops) {
        let next: string[] = []
        for (let e of frontier) {
          for (let ref of refsAt(bags.get(e), h.comp, h.prop)) {
            if (ref != null) next.push(String(ref))
          }
        }
        let load = [...new Set(next.filter((e) => !bags.has(e)))]
        if (load.length) merge(bags, await readBags(load, only))
        frontier = next
      }
    }
  }

  // The candidate eid set: the smallest of each anchoring pred's set — a
  // ref-equality reads the auto index, a presence pred reads the store's keys
  // (byComp). Undefined means no anchor: the whole-graph fallback.
  let candidates = async (preds: Pred[]): Promise<Set<string> | undefined> => {
    let best: Set<string> | undefined
    let consider = (keys?: IDBValidKey[]) => {
      if (keys && (!best || keys.length < best.size)) {
        best = new Set(keys.map(String))
      }
    }
    for (let p of preds) {
      if (p.op == TEXT || p.op == ORDER) continue
      if (refEq(p)) {
        let tx = db.transaction(p.comp, 'readonly')
        let ix = tx.objectStore(p.comp).index(idxName(p.comp, [p.prop]))
        consider(await req(ix.getAllKeys(p.value)))
        continue
      }
      if (p.comp && implies(p) && names.includes(p.comp)) {
        let tx = db.transaction(p.comp, 'readonly')
        consider(await req(tx.objectStore(p.comp).getAllKeys()))
      }
    }
    return best
  }

  let allEntityKeys = async (): Promise<string[]> =>
    (await req(db.transaction('entity').objectStore('entity').getAllKeys()))
      .map(String)

  // Quarantine gates `listed`, but it is a rare facet — read its whole key set
  // once and stamp the bag, rather than a get-per-candidate on a store that
  // almost always answers empty.
  let quarantinedKeys = async (): Promise<Set<string>> =>
    new Set(
      (await req(
        db.transaction('quarantined').objectStore('quarantined')
          .getAllKeys(),
      )).map(String),
    )

  let markQuarantined = (bags: Map<string, Row>, qs: Set<string>) => {
    for (let [eid, bag] of bags) {
      if (qs.has(eid) && !bag.quarantined) bag.quarantined = {}
    }
  }

  // One resolution: anchor to a candidate pool (or the whole graph), hydrate the
  // pool and every path target, then screen with the SAME listed + matchQuery
  // the in-memory resolver uses — which is what makes the two answers identical.
  let scan = async (preds: Pred[]): Promise<string[]> => {
    if (gate) await gate
    let only = touched(preds) ?? names
    let [cand, qs] = await Promise.all([candidates(preds), quarantinedKeys()])
    let pool = cand ? [...cand] : await allEntityKeys()
    let bags = new Map<string, Row>()
    await hydrate(preds, pool, only, bags)
    markQuarantined(bags, qs)
    let ent = (eid: string) => bags.get(eid)
    return pool.filter((eid) => {
      let r = bags.get(eid)
      return !!r && listed(r, preds) && matchQuery(r, preds, ent)
    })
  }

  let ensure = (preds: Pred[]) => {
    let key = queryKey(preds)
    let found = sets.get(key)
    if (!found) {
      sets.set(
        key,
        found = { preds, ids: signal<string[]>(prime?.(preds) ?? []), n: 0 },
      )
      scan(preds).then((r) => {
        if (!sameSet(found!.ids.peek(), r)) found!.ids.value = r
      })
    }
    return found
  }

  // The async truth. `resolve` (the sync seam) returns the latest settled value;
  // `ready` awaits the indexed reads and lands it.
  let ready = async (preds: Pred[]): Promise<string[]> => {
    let out = await scan(preds)
    let s = sets.get(queryKey(preds))
    if (s) s.ids.value = out
    return out
  }

  let resolve = (preds: Pred[]): string[] => ensure(preds).ids.peek()
  let subscribe = (preds: Pred[]): Signal<string[]> => ensure(preds).ids

  let hold = (preds: Pred[]): Signal<string[]> => {
    let s = ensure(preds)
    s.n++
    return s.ids
  }
  let drop = (preds: Pred[]) => {
    let key = queryKey(preds)
    let s = sets.get(key)
    if (!s || --s.n > 0) return
    sets.delete(key)
  }

  // A membership test for a fixed eid set, hydrated once against the durable
  // store — the async analogue of the memory resolver's row-local `matches`.
  let membership = async (
    preds: Pred[],
    eids: string[],
  ): Promise<(eid: string) => boolean> => {
    if (gate) await gate
    let only = touched(preds) ?? names
    let bags = new Map<string, Row>()
    let qs = await quarantinedKeys()
    await hydrate(preds, eids, only, bags)
    markQuarantined(bags, qs)
    let ent = (eid: string) => bags.get(eid)
    return (eid) => {
      let r = bags.get(eid)
      return !!r && listed(r, preds) && matchQuery(r, preds, ent)
    }
  }

  let refresh = async (eids: Set<string>) => {
    let ids = [...eids]
    for (let s of sets.values()) {
      let test = await membership(s.preds, ids)
      let cur = s.ids.peek()
      let next = cur
      for (let e of ids) {
        let had = next.includes(e)
        let wants = test(e)
        if (had != wants) {
          next = wants ? [...next, e] : next.filter((x) => x != e)
        }
      }
      if (next != cur) s.ids.value = next
    }
  }

  let reset = async () => {
    for (let s of sets.values()) s.ids.value = await scan(s.preds)
  }

  return { resolve, subscribe, ready, refresh, reset, hold, drop }
}
