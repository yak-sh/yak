// The durable outbox (T-21440): a tab's UNDELIVERED intent on disk. live.ts
// parks every local write here under its stable delivery id the instant it is
// sent, and unparks it the instant the server acks it — so a tab crash or a
// manual reload while the server is unreachable no longer discards writes the
// optimistic cache already showed as landed. Append-and-forget, per tab: no
// epoch, no cursor, nothing to regress. Raw IndexedDB, feature-detected; a
// failed op is a no-op (no IndexedDB, a private-mode throw) — the write still
// lives in memory and redelivery still runs; only crash survival degrades.
//
// Its own small database, on purpose. The outbox used to share the `tasks`
// database with the whole-graph cache of 2026-08, which grew to gigabytes in a
// long-lived browser profile; opening that store cost a fresh tab up to a
// minute of blank screen before boot could proceed (T-37445). The graph's disk
// floor now lives in @yaks/client's wire vault; that legacy database is dead
// weight, and forgetLegacy() removes it.
import { type Change } from './types.ts'

let DB = 'tasks-outbox'
let OUTBOX = 'outbox'
let LEGACY = 'tasks'

export type Parked = { changes: Change[]; at: number }

// Open (or create) the database once. Resolves null on any failure — no
// IndexedDB, a throw, an error, a blocked upgrade — which every door below
// reads as "no disk this session", never a crash.
let idb: IDBDatabase | null = null
export let open = (): Promise<IDBDatabase | null> => {
  if (idb) return Promise.resolve(idb)
  let g = (globalThis as { indexedDB?: IDBFactory }).indexedDB
  if (!g) return Promise.resolve(null)
  return new Promise((resolve) => {
    let r: IDBOpenDBRequest
    try {
      r = g.open(DB, 1)
    } catch {
      resolve(null) // Firefox private mode throws right here
      return
    }
    r.onupgradeneeded = () => r.result.createObjectStore(OUTBOX)
    r.onsuccess = () => resolve(idb = r.result)
    r.onerror = () => resolve(null)
    r.onblocked = () => resolve(null)
  })
}

let ask = <T>(r: IDBRequest<T>, fb: T): Promise<T> =>
  new Promise((resolve) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => resolve(fb)
  })

// One short write, resolving when the txn commits (or silently on failure).
let write = (run: (s: IDBObjectStore) => void): Promise<void> =>
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
  write((s) => void s.put(o, id))

export let unparkWrite = (id: string): Promise<void> =>
  write((s) => void s.delete(id))

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

// Drop the dead `tasks` database. Fire-and-forget: a delete waits for every
// tab still holding it open, and nothing here depends on when it lands.
export let forgetLegacy = () => {
  try {
    ;(globalThis as { indexedDB?: IDBFactory }).indexedDB?.deleteDatabase(
      LEGACY,
    )
  } catch { /* no storage, nothing to forget */ }
}
