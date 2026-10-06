// Keyed writes through the production door and real Store. Only workerd's
// cursor counters measure the table and index rows this path actually costs.
import { Store } from './graph.ts'
import { storeOf } from './door.ts'
import { KERNEL, metaOf } from './meta.ts'
import type { DurableStorage } from '@yaks/durable-object'

export type WriteCost = {
  requests: number
  keyed: number
  total: { read: number; written: number; calls: number }
  log: { read: number; written: number; calls: number }
  shapes: { sql: string; read: number; written: number; calls: number }[]
  receipts: number
}

export let writeCost = async (
  storage: DurableStorage & {
    sql: DurableStorage['sql'] & { databaseSize: number }
    deleteAll(): Promise<void>
  },
): Promise<WriteCost> => {
  let store = new Store({ storage, getWebSockets: () => [], acceptWebSocket: () => {} })
  let measured = false, keyed = 0
  let total = { read: 0, written: 0, calls: 0 }
  let log = { read: 0, written: 0, calls: 0 }
  let shapes = new Map<string, typeof total>()
  let exec = storage.sql.exec.bind(storage.sql)
  storage.sql.exec = (sql, ...bindings) => {
    let cursor = exec(sql, ...bindings)
    let rows = cursor.toArray()
    if (measured) {
      if (cursor.rowsRead == null || cursor.rowsWritten == null) {
        throw new Error('write cost requires workerd cursor counters')
      }
      let cost = {
        read: cursor.rowsRead,
        written: cursor.rowsWritten,
        calls: 1,
      }
      let shape = shapes.get(sql) ?? { read: 0, written: 0, calls: 0 }
      shapes.set(sql, shape)
      for (let name of ['read', 'written', 'calls'] as const) {
        total[name] += cost[name]
        shape[name] += cost[name]
        if (/yak_write/.test(sql)) log[name] += cost[name]
      }
    }
    return {
      rowsRead: cursor.rowsRead,
      rowsWritten: cursor.rowsWritten,
      toArray: () => rows,
      [Symbol.iterator]: () => rows.values(),
    }
  }
  let door = storeOf({
    idFromName: (name) => name,
    get: () => ({
      fetch: (req) => {
        if (
          measured && req.method == 'POST' &&
          new URL(req.url).pathname == '/apply'
        ) {
          if (!req.headers.get('idempotency-key')) {
            throw new Error('unkeyed write')
          }
          keyed++
        }
        return store.fetch(req)
      },
    }),
  }, 'probe/write-cost')
  let meta = metaOf(door)
  try {
    await meta.apply(
      [{ entity: { eid: 'player' }, doc: { title: 'ready' } }],
      KERNEL,
    )
    await store.alarm()
    measured = true
    for (let n = 0; n < 80; n++) {
      await meta.apply([{
        entity: { eid: 'player' },
        doc: { title: `turn ${n}` },
      }], KERNEL)
    }
    measured = false
    let receipts =
      (await (await door('/writes?recent=1', {}, KERNEL)).json()).length
    return {
      requests: 80,
      keyed,
      total,
      log,
      receipts,
      shapes: [...shapes].map(([sql, cost]) => ({ sql, ...cost })),
    }
  } finally {
    storage.sql.exec = exec
  }
}
