import type { Change } from './types.ts'

// Read the old shape only to move it. Never send from it, create it, or treat
// a failed read/delete as success. The destination commits before removal.
export type LegacyOutbox = {
  load: () => Promise<[string, { changes: Change[]; at: number }][]>
  remove: (key: string) => Promise<void>
  close?: () => void
}
export let legacyOutbox = (name: string): LegacyOutbox => {
  let opening: Promise<IDBDatabase | undefined> | undefined
  let db = () =>
    opening ??= new Promise((resolve, reject) => {
      let request = indexedDB.open(name)
      let absent = false
      request.onupgradeneeded = () => {
        absent = true
        request.transaction!.abort()
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () =>
        absent ? resolve(undefined) : reject(request.error)
      request.onblocked = () => reject(new Error('Legacy outbox is blocked'))
    })
  let transaction = async <T>(
    mode: IDBTransactionMode,
    run: (s: IDBObjectStore) => IDBRequest<T>,
  ) => {
    let database = await db()
    if (!database || !database.objectStoreNames.contains('outbox')) {
      return undefined
    }
    return await new Promise<T>((resolve, reject) => {
      let tx = database.transaction('outbox', mode)
      let request = run(tx.objectStore('outbox'))
      tx.oncomplete = () => resolve(request.result)
      tx.onabort = tx.onerror = () => reject(tx.error ?? request.error)
    })
  }
  return {
    load: async () => {
      // One readonly transaction keeps keys and values paired under other tabs.
      let rows: Awaited<ReturnType<LegacyOutbox['load']>> = []
      await transaction('readonly', (s) => {
        let request = s.openCursor()
        request.onsuccess = () => {
          let cursor = request.result
          if (!cursor) return
          rows.push([String(cursor.key), cursor.value])
          cursor.continue()
        }
        return request
      })
      return rows
    },
    remove: async (key) => {
      await transaction('readwrite', (s) => s.delete(key))
    },
    close: () => {
      void opening?.then((db) => db?.close(), () => {})
    },
  }
}
