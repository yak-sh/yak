// The vault a browser has: one IndexedDB object store, keyed by eid, holding
// one record per entity that wears a local-tier component.
//
// IndexedDB is an events API, so everything here is one small promise wrapper
// around a request, plus one rule: a WRITE resolves on the transaction, not on
// the request. A request succeeds as soon as the store accepted the value; the
// transaction is what says it is durable, and a caller writing through after a
// commit wants the second one.
//
// The database is opened lazily and once, on the first call. A page that never
// writes a local-tier component therefore never opens a database at all — and
// a browser that refuses storage (private mode, a blocked origin) fails at that
// first call rather than at import time.

import type { Eid } from '@yaks/graph'
import type { Saved, Vault } from './vault.ts'

/** How an IndexedDB vault is addressed. */
export type IdbOpts = {
  /** the database name (default: `yaks`) */
  name?: string
  /** the object store inside it (default: `local`) */
  store?: string
  /** the IndexedDB implementation (default: the global `indexedDB`) — a test
   * hands in a stand-in, a worker hands in its own */
  indexedDB?: IDBFactory
}

let ask = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((ok, no) => {
    req.onsuccess = () => ok(req.result)
    req.onerror = () => no(req.error)
  })

let done = (tx: IDBTransaction): Promise<void> =>
  new Promise((ok, no) => {
    tx.oncomplete = () => ok()
    tx.onerror = () => no(tx.error)
    tx.onabort = () => no(tx.error)
  })

/**
 * A {@link Vault} over IndexedDB: what {@link client} keeps the local tier in
 * when it is running in a browser.
 *
 * ```ts
 * let kept = keep(graph, idb({ name: 'recipes' }))
 * ```
 *
 * Give each application its own database name. The store is created on first
 * open and nothing in it is versioned: a record is an entity's id, its number,
 * and the components it wore, which is the same shape the graph reads back.
 */
export let idb = (opts: IdbOpts = {}): Vault => {
  let name = opts.name ?? 'yaks'
  let store = opts.store ?? 'local'
  let factory = () => {
    let f = opts.indexedDB ?? globalThis.indexedDB
    if (!f) throw new Error('@yaks/client — no indexedDB in this environment')
    return f
  }

  let held: Promise<IDBDatabase> | undefined
  let db = () =>
    held ??= new Promise<IDBDatabase>((ok, no) => {
      let req = factory().open(name, 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(store)) {
          req.result.createObjectStore(store, { keyPath: 'eid' })
        }
      }
      req.onsuccess = () => ok(req.result)
      req.onerror = () => no(req.error)
    })

  // One read-write transaction, its body run against the store, awaited to
  // completion — which is the point at which the browser has it.
  let write = async (body: (s: IDBObjectStore) => void) => {
    let tx = (await db()).transaction(store, 'readwrite')
    body(tx.objectStore(store))
    await done(tx)
  }

  return {
    load: async () => {
      let tx = (await db()).transaction(store, 'readonly')
      return await ask<Saved[]>(
        tx.objectStore(store).getAll() as IDBRequest<Saved[]>,
      )
    },
    save: (recs: Saved[]) =>
      write((s) => {
        for (let r of recs) s.put(r)
      }),
    drop: (eids: Eid[]) =>
      write((s) => {
        for (let eid of eids) s.delete(eid)
      }),
    clear: () => write((s) => s.clear()),
  }
}

/** Epoch-scoped wire-tier IndexedDB. Uses a separate database (default:
 * `yaks-wire`), so epoch invalidation cannot erase the local Vault. Reads use
 * an ordered cursor, never getAll; both disk and the returned array are bounded.
 * The supplied name must be distinct from the local vault's database name. */
export let wireIdb = (
  opts: IdbOpts = {},
): import('./wire-vault.ts').WireVault => {
  let held: Promise<IDBDatabase> | undefined
  let db = () =>
    held ??= new Promise<IDBDatabase>((ok, no) => {
      let factory = opts.indexedDB ?? globalThis.indexedDB
      if (!factory) {
        throw new Error('@yaks/client — no indexedDB in this environment')
      }
      let req = factory.open(opts.name ?? 'yaks-wire', 1)
      req.onupgradeneeded = () => {
        let rows = req.result.createObjectStore('rows', { keyPath: 'eid' })
        rows.createIndex('order', 'order')
        req.result.createObjectStore('meta')
      }
      req.onsuccess = () => ok(req.result)
      req.onerror = () => no(req.error)
    })
  let transaction = async <T>(
    body: (rows: IDBObjectStore, meta: IDBObjectStore) => Promise<T>,
  ): Promise<T> => {
    let tx = (await db()).transaction(['rows', 'meta'], 'readwrite')
    let finish = done(tx)
    try {
      let out = await body(tx.objectStore('rows'), tx.objectStore('meta'))
      await finish
      return out
    } catch (error) {
      try {
        tx.abort()
      } catch { /* already aborted */ }
      await finish.catch(() => {})
      throw error
    }
  }
  // Prune by key: a legacy oversized store never materializes unbounded rows.
  let prune = async (rows: IDBObjectStore, limit: number) => {
    let extra = await ask(rows.count()) - limit
    if (extra <= 0) return
    await new Promise<void>((ok, no) => {
      let req = rows.index('order').openKeyCursor()
      req.onerror = () => no(req.error)
      req.onsuccess = () => {
        let cursor = req.result
        if (!cursor || extra-- <= 0) {
          ok()
          return
        }
        rows.delete(cursor.primaryKey)
        cursor.continue()
      }
    })
  }
  let bounded = (rows: IDBObjectStore, limit: number): Promise<Saved[]> =>
    new Promise((ok, no) => {
      if (!limit) {
        ok([])
        return
      }
      let req = rows.index('order').openCursor(null, 'prev')
      let saved: Saved[] = []
      req.onerror = () => no(req.error)
      req.onsuccess = () => {
        let cursor = req.result
        if (!cursor) {
          ok(saved.reverse())
          return
        }
        let r = cursor.value
        saved.push({ eid: r.eid, num: r.num, comps: r.comps })
        if (saved.length === limit) {
          ok(saved.reverse())
          return
        }
        cursor.continue()
      }
    })
  let check = (limit: number) => {
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new Error('invalid retention limit')
    }
  }
  return {
    load: (epoch, limit) => {
      check(limit)
      return transaction(async (rows, meta) => {
        if (await ask(meta.get('epoch')) !== epoch) {
          rows.clear()
          meta.put(epoch, 'epoch')
          meta.put(0, 'order')
          return []
        }
        await prune(rows, limit)
        return await bounded(rows, limit)
      })
    },
    save: (epoch, saved, limit) => {
      check(limit)
      return transaction(async (rows, meta) => {
        if (await ask(meta.get('epoch')) !== epoch) return
        let order = Number(await ask(meta.get('order')) ?? 0)
        for (let r of saved) rows.put({ ...r, order: ++order })
        meta.put(order, 'order')
        await prune(rows, limit)
      })
    },
    drop: (epoch, eids) =>
      transaction(async (rows, meta) => {
        if (await ask(meta.get('epoch')) !== epoch) return
        for (let eid of eids) rows.delete(eid)
      }),
  }
}
