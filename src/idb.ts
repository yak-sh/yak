// The client cache's disk shadow: IndexedDB persistence so a returning tab
// hydrates the graph from local disk (tens of ms) + a small delta, instead
// of re-fetching the whole ~10.5 MB /snapshot (~1.4 s) on every reload
// (T-6823). Raw IndexedDB, no wrapper lib (vendored-only philosophy),
// feature-detected. A failed IDB op is telemetry, never a broken render —
// every path degrades to today's full-snapshot boot. The stores mirror the
// in-memory shape 1:1 (live.ts cache/deps signals): `ents` keyed by eid
// holds the whole Comps record, `deps` keyed per-edge, `meta` the cursor +
// the epoch/vocabHash a delta is validated against, plus the forward-compat
// `scope` seam (T-3683 partial caches).
//
// Writes are BOOT-ONLY and FORWARD-ONLY this slice (2.1). Because every tab
// is its own writer (no leader yet — 2.2/T-6883), persisting on every live
// frame would let a throttled background tab clobber a fresher record while
// another tab has already advanced the shared cursor past the fix — a
// drop-op race IndexedDB's transactions do NOT prevent (they stop
// corruption, not stale logical overwrites). So IDB is written only at boot,
// through a compare-and-swap: read the stored cursor first and commit only if
// this result supersedes it (`ahead` below). IDB therefore only ever holds a
// consistent values@C paired with cursor=C. The persist() seam stays for
// 2.2's leader (a sole writer can safely persist live frames) and a later
// incremental optimization.
import { type Comps } from './live.ts'
import { type Dep } from './types.ts'

// Bump when the store LAYOUT changes: onupgradeneeded drops and recreates
// the stores, so a returning client on an old layout cleanly reseeds rather
// than reading a stale shape.
let SCHEMA = 1

let DB = 'tasks'
let ENTS = 'ents'
let DEPS = 'deps'
let META = 'meta'

// The invalidation + cursor record, one row per fixed key in `meta`.
// `cursor` present ⇒ this tab has seeded ⇒ a returning visit; absent ⇒
// first visit. `epoch`/`vocabHash` are the server stamps /delta checks.
export type Meta = {
  cursor?: number
  epoch?: string
  vocabHash?: string
  schemaVersion?: number
  scope?: string
}

// The stamps a boot write commits with — the server-boot `epoch`, the
// `vocabHash`, and the journal `cursor` this result is current as of.
export type Stamp = { epoch: string; vocabHash: string; cursor: number }

// The forward-only compare-and-swap decision: may `next` overwrite what's
// stored? A `full` snapshot is self-consistent, so it replaces across a
// changed epoch (a db reset/restore — the stored cursor is then void) OR when
// it reaches a higher cursor. A delta `patch` is only valid against its OWN
// epoch, so it commits ONLY same-epoch-and-higher-cursor — never across
// epochs, and never a regress (another tab is already ahead: skip). Absent
// stored cursor reads as -1, so a first visit always writes.
export let ahead = (
  stored: { epoch?: string; cursor?: number },
  next: Stamp,
  full: boolean,
) =>
  full
    ? stored.epoch != next.epoch || (stored.cursor ?? -1) < next.cursor
    : stored.epoch == next.epoch && (stored.cursor ?? -1) < next.cursor

// The edge key: a dependency triple has no row id, so its three parts name
// the whole sentence (mirrors applyLocal and the snapshot deps shape).
let depKey = (d: Dep) => `${d.parent}|${d.type}|${d.child}`

// Feature-detect once and cache the handle. Private browsing and old
// engines have no indexedDB, and even where the global exists open() can
// throw (Firefox private mode). A null db means "no cache": every export
// below becomes a graceful no-op and boot falls back to a full snapshot.
let idb: IDBDatabase | null = null

// Open (or create) the db, building the three stores on first use or a
// schema bump. Resolves to the handle or null — a throw, an error, or a
// blocked upgrade just means no cache this session, not a crash. Idempotent:
// a second call returns the already-open handle.
export let open = (): Promise<IDBDatabase | null> => {
  if (idb) return Promise.resolve(idb)
  let g = (globalThis as { indexedDB?: IDBFactory }).indexedDB
  if (!g) return Promise.resolve(null)
  return new Promise((resolve) => {
    let r: IDBOpenDBRequest
    try {
      r = g.open(DB, SCHEMA)
    } catch {
      resolve(null) // Firefox private mode throws right here
      return
    }
    r.onupgradeneeded = () => {
      let db = r.result
      // A layout bump clears the old stores — delete then recreate, so an
      // old client reseeds instead of reading a mismatched shape.
      for (let name of [ENTS, DEPS, META]) {
        if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name)
      }
      db.createObjectStore(ENTS) // out-of-line key = eid
      db.createObjectStore(DEPS) // out-of-line key = parent|type|child
      db.createObjectStore(META) // fixed keys
    }
    r.onsuccess = () => resolve(idb = r.result)
    r.onerror = () => resolve(null)
    r.onblocked = () => resolve(null)
  })
}

// Promise around a request, resolving `fb` on error so a failed read
// degrades into the caller's empty case instead of rejecting up the boot.
let ask = <T>(r: IDBRequest<T>, fb: T): Promise<T> =>
  new Promise((resolve) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => resolve(fb)
  })

// Read the whole cache back — getAll on each store, no cross-store join
// (the whole Comps rides in one `ents` value). Keys pair with values for
// ents (both come back in key order) so the Record the signal wants rebuilds
// directly. Empty on any failure or a missing db → boot treats it as a first
// visit.
export let hydrate = async (): Promise<{
  ents: Record<string, Comps>
  deps: Dep[]
}> => {
  let empty = { ents: {}, deps: [] as Dep[] }
  let db = await open()
  if (!db) return empty
  try {
    let tx = db.transaction([ENTS, DEPS], 'readonly')
    let es = tx.objectStore(ENTS)
    let keys = await ask(es.getAllKeys(), [] as IDBValidKey[])
    let vals = await ask(es.getAll(), [] as Comps[])
    let deps = await ask(tx.objectStore(DEPS).getAll(), [] as Dep[])
    let ents: Record<string, Comps> = {}
    keys.forEach((k, i) => ents[String(k)] = vals[i])
    return { ents, deps }
  } catch {
    return empty
  }
}

// The invalidation + cursor record — boot reads this FIRST: no cursor means
// first visit. Returns {} on any failure (→ first visit, the safe default).
export let meta = async (): Promise<Meta> => {
  let db = await open()
  if (!db) return {}
  try {
    let s = db.transaction(META, 'readonly').objectStore(META)
    let out: Meta = {}
    let keys = ['cursor', 'epoch', 'vocabHash', 'schemaVersion', 'scope']
    await Promise.all(keys.map(async (k) => {
      let v = await ask(s.get(k), undefined)
      if (v !== undefined) (out as Record<string, unknown>)[k] = v
    }))
    return out
  } catch {
    return {}
  }
}

// The one write path: a forward-only guarded commit, ALL in one transaction.
// IndexedDB auto-commits a txn the instant control yields with no pending
// request, so the guard reads the stored cursor and issues the writes inside
// the SAME callback chain — no `await` between them, or the txn would close
// first. It reads {epoch, cursor}, and only if `ahead()` says this result
// supersedes what's stored does it run `write` and stamp the new meta. Across
// tabs IDB serializes the txn, so the read-decide-write is atomic: no two
// writers regress each other. Resolves whether it wrote.
let commit = async (
  next: Stamp,
  full: boolean,
  write: (s: { ents: IDBObjectStore; deps: IDBObjectStore }) => void,
): Promise<boolean> => {
  let db = await open()
  if (!db) return false
  return new Promise((resolve) => {
    try {
      let tx = db.transaction([ENTS, DEPS, META], 'readwrite')
      let ms = tx.objectStore(META)
      let wrote = false
      let ce = ms.get('epoch')
      ce.onsuccess = () => {
        let cc = ms.get('cursor')
        cc.onsuccess = () => {
          let stored = {
            epoch: ce.result as string | undefined,
            cursor: cc.result as number | undefined,
          }
          if (!ahead(stored, next, full)) return // a peer is ahead — skip
          wrote = true
          write({ ents: tx.objectStore(ENTS), deps: tx.objectStore(DEPS) })
          ms.put(next.epoch, 'epoch')
          ms.put(next.vocabHash, 'vocabHash')
          ms.put(SCHEMA, 'schemaVersion')
          ms.put('full-eager', 'scope') // T-3683 seam: partial caches widen it
          ms.put(next.cursor, 'cursor')
        }
      }
      tx.oncomplete = () => resolve(wrote)
      tx.onerror = () => resolve(false)
      tx.onabort = () => resolve(false)
    } catch {
      resolve(false)
    }
  })
}

// First-visit + 409-reseed seed: replace the whole cache (clear then put
// every ent and edge). A `full` commit, so it wins across a changed epoch.
export let seed = (
  cache: Record<string, Comps>,
  deps: Dep[],
  cursor: number,
  epoch: string,
  vocabHash: string,
): Promise<boolean> =>
  commit({ epoch, vocabHash, cursor }, true, ({ ents, deps: ds }) => {
    ents.clear()
    for (let [eid, r] of Object.entries(cache)) ents.put(r, eid)
    ds.clear()
    for (let d of deps) ds.put(d, depKey(d))
  })

// The delta write: patch exactly the touched eids and edges, advancing the
// cursor in the same atomic commit. A same-epoch `patch`, forward-only. A
// touched eid gone from the cache was deleted (tombstone/cascade) → delete
// its row; an edge gone from `deps` likewise. The seam a leader (2.2) will
// call on live frames; this slice calls it once, from the returning boot.
export let persist = (
  eids: string[],
  edges: Dep[],
  cache: Record<string, Comps>,
  deps: Dep[],
  next: Stamp,
): Promise<boolean> =>
  commit(next, false, ({ ents, deps: ds }) => {
    for (let eid of eids) {
      let r = cache[eid]
      if (r) ents.put(r, eid)
      else ents.delete(eid) // tombstoned or cascaded out of the cache
    }
    if (edges.length) {
      let live = new Set(deps.map(depKey))
      for (let d of edges) {
        let k = depKey(d)
        if (live.has(k)) ds.put(d, k)
        else ds.delete(k) // unlinked, or swept by an endpoint's death
      }
    }
  })
