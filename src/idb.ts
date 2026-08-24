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
// The Web-Lock leader is the sole live writer (T-6883). Without that layer,
// writes stay boot-only: persisting per-tab live frames would let a throttled
// tab clobber newer values after a peer advanced the shared cursor. Every
// commit remains forward-only, so disabling leadership cleanly restores the
// multi-writer 2.1 behavior.
import { type Comps } from './live.ts'
import { type Change, type Dep } from './types.ts'

// Bump when the store LAYOUT changes: onupgradeneeded drops and recreates
// the stores, so a returning client on an old layout cleanly reseeds rather
// than reading a stale shape. v2 adds the durable outbox store (T-21440).
let SCHEMA = 2

let DB = 'tasks'
let ENTS = 'ents'
let DEPS = 'deps'
let META = 'meta'
let OUTBOX = 'outbox'

// The invalidation + cursor record, one row per fixed key in `meta`.
// `cursor` present ⇒ this tab has seeded ⇒ a returning visit; absent ⇒
// first visit. `epoch`/`vocabHash` are the server stamps /delta checks.
export type Meta = {
  cursor?: number
  epoch?: string
  vocabHash?: string
  capabilities?: string[]
  schemaVersion?: number
  scope?: string
}

// The stamps a boot write commits with — the server-boot `epoch`, the
// `vocabHash`, and the journal `cursor` this result is current as of.
export type Stamp = {
  epoch: string
  vocabHash: string
  cursor: number
  capabilities?: string[]
}

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
      for (let name of [ENTS, DEPS, META, OUTBOX]) {
        if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name)
      }
      db.createObjectStore(ENTS) // out-of-line key = eid
      db.createObjectStore(DEPS) // out-of-line key = parent|type|child
      db.createObjectStore(META) // fixed keys
      db.createObjectStore(OUTBOX) // out-of-line key = delivery id (T-21440)
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

// Read cache + cursor in ONE transaction. A follower opens BroadcastChannel
// before this read; a leader write is therefore either wholly visible here,
// or waits behind this transaction and arrives as a buffered channel frame.
// Splitting meta from rows would admit values@D with cursor=C.
export let hydrate = async (): Promise<{
  ents: Record<string, Comps>
  deps: Dep[]
  meta: Meta
}> => {
  let empty = { ents: {}, deps: [] as Dep[], meta: {} }
  let db = await open()
  if (!db) return empty
  try {
    let tx = db.transaction([ENTS, DEPS, META], 'readonly')
    let es = tx.objectStore(ENTS)
    let ms = tx.objectStore(META)
    // Issue every request before yielding; an IDB transaction auto-closes
    // when its request queue empties.
    let keys = ask(es.getAllKeys(), [] as IDBValidKey[])
    let vals = ask(es.getAll(), [] as Comps[])
    let ds = ask(tx.objectStore(DEPS).getAll(), [] as Dep[])
    let names = [
      'cursor',
      'epoch',
      'vocabHash',
      'capabilities',
      'schemaVersion',
      'scope',
    ]
    let meta = names.map((name) => ask(ms.get(name), undefined))
    let [ks, vs, deps, mv] = await Promise.all([
      keys,
      vals,
      ds,
      Promise.all(meta),
    ])
    let ents: Record<string, Comps> = {}
    ks.forEach((k, i) => ents[String(k)] = vs[i])
    let out: Meta = {}
    let record = out as Record<string, unknown>
    names.forEach((name, i) => {
      if (mv[i] !== undefined) record[name] = mv[i]
    })
    return { ents, deps, meta: out }
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
    let keys = [
      'cursor',
      'epoch',
      'vocabHash',
      'capabilities',
      'schemaVersion',
      'scope',
    ]
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
          ms.put(next.capabilities ?? [], 'capabilities')
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
  capabilities: string[] = [],
): Promise<boolean> =>
  commit(
    { epoch, vocabHash, cursor, capabilities },
    true,
    ({ ents, deps: ds }) => {
      ents.clear()
      for (let [eid, r] of Object.entries(cache)) ents.put(r, eid)
      ds.clear()
      for (let d of deps) ds.put(d, depKey(d))
    },
  )

// The delta write: patch exactly the touched eids and edges, advancing the
// cursor in the same atomic commit. A same-epoch `patch`, forward-only. A
// touched eid gone from the cache was deleted (tombstone/cascade) → delete
// its row; an edge gone from `deps` likewise.
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

// The durable outbox (T-21440): the stores above shadow the graph; this one
// shadows a tab's UNDELIVERED intent. live.ts parks every local write here
// under its stable delivery id the instant it is sent, and unparks it the
// instant the server acks it — so a tab crash or a manual reload while the
// server is unreachable no longer discards writes the optimistic cache already
// showed as landed (the T-21413 outbox was in-memory only). Unlike the cache
// this is per-tab, append-and-forget intent: no epoch, no cursor, no
// forward-only guard, nothing to regress. A failed op is a no-op (no
// IndexedDB, a private-mode throw) — the write still lives in memory and
// redelivery still runs; only the crash-survival guarantee degrades.
export type Parked = { changes: Change[]; at: number }

// One short write on the outbox store, resolving when the txn commits (or
// silently on any failure) — the same graceful-degrade the cache path uses.
let writeOutbox = (run: (s: IDBObjectStore) => void): Promise<void> =>
  open().then((db) =>
    !db ? undefined : new Promise<void>((resolve) => {
      try {
        let tx = db.transaction(OUTBOX, 'readwrite')
        run(tx.objectStore(OUTBOX))
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
        tx.onabort = () => resolve()
      } catch {
        resolve()
      }
    })
  )

export let parkWrite = (id: string, o: Parked): Promise<void> =>
  writeOutbox((s) => void s.put(o, id))

export let unparkWrite = (id: string): Promise<void> =>
  writeOutbox((s) => void s.delete(id))

// Everything a prior life parked but never saw acked — read at boot and
// replayed. A failure reads as an empty outbox, so boot proceeds either way.
export let parkedWrites = async (): Promise<[string, Parked][]> => {
  let db = await open()
  if (!db) return []
  try {
    let tx = db.transaction(OUTBOX, 'readonly')
    let s = tx.objectStore(OUTBOX)
    let keys = ask(s.getAllKeys(), [] as IDBValidKey[])
    let vals = ask(s.getAll(), [] as Parked[])
    let [ks, vs] = await Promise.all([keys, vals])
    return ks.map((k, i) => [String(k), vs[i]] as [string, Parked])
  } catch {
    return []
  }
}
