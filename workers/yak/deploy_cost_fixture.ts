// Release installation measured with the runtime's billed SQL cursor counters.
// History stays in the same Store while one unrelated word changes.
import { Store } from './graph.ts'
import type { State } from './graph.ts'
import { by, val } from '@yaks/sql'
import { driver } from '@yaks/durable-object'

export let deployCost = async (storage: State['storage'], history: number) => {
  let headers = {
    'x-store': 'probe/deploy-cost',
    'x-yak-app': 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
    'x-yak-person': 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    'x-yak-role': 'owner',
    'x-yak-access': 'private',
    'x-yak-kernel': '1',
  }
  let ctx = { storage, getWebSockets: () => [], acceptWebSocket: () => {} }
  let store = new Store(ctx, {}, [])
  let send = async (path: string, body?: unknown) => {
    let res = await store.fetch(
      new Request(`https://store${path}`, {
        headers,
        ...(body === undefined ? {} : {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      }),
    )
    if (!res.ok) throw new Error(`${path}: ${await res.text()}`)
    return await res.json()
  }
  let words = (label: string) => ({
    $defs: {
      note: { component: true, properties: { label: { type: 'string' } } },
      flag: { component: true, description: label, properties: {} },
    },
  })
  await send('/vocab', words('before'))
  for (let start = 0; start < history; start += 20) {
    await send(
      '/apply',
      Array.from({ length: Math.min(20, history - start) }, (_, i) => ({
        entity: { eid: `history-${start + i}` },
        note: { label: 'kept' },
        doc: { title: `Retained document ${start + i}`, body: 'lemon orchard' },
      })),
    )
  }
  // Establish the serving schema and descriptions. No owned migration or AI.
  await storage.deleteAlarm?.()
  let sql = storage.sql.exec.bind(storage.sql)
  let current = { read: 0, written: 0, calls: 0 }
  let shapes: { sql: string; read: number; written: number }[] = []
  storage.sql.exec = (query, ...args) => {
    let cursor = sql(query, ...args)
    let rows = cursor.toArray()
    if (cursor.rowsRead == null || cursor.rowsWritten == null) {
      throw new Error('release cost needs SQL cursor counters')
    }
    current.read += cursor.rowsRead
    current.written += cursor.rowsWritten
    current.calls++
    shapes.push({
      sql: query,
      read: cursor.rowsRead,
      written: cursor.rowsWritten,
    })
    return {
      rowsRead: cursor.rowsRead,
      rowsWritten: cursor.rowsWritten,
      toArray: () => rows,
      [Symbol.iterator]: () => rows.values(),
    }
  }
  let costs: Record<string, typeof current> = {}
  try {
    // Obsolete description-install bookkeeping cannot invalidate a physical
    // schema already established by its own completed install.
    driver({
      sql: { exec: sql },
      transactionSync: storage.transactionSync.bind(storage),
    }).query({ t: 'delete', from: 'yak_kv', where: by({ k: 'schema-ready' }) })
    current = { read: 0, written: 0, calls: 0 }
    // Runtime deploying new code cannot execute a request in an idle Store.
    store = new Store(ctx, {}, [])
    costs.constructed = { ...current }
    current = { read: 0, written: 0, calls: 0 }
    await send('/query?q=' + encodeURIComponent('.note .limit=1'))
    costs.unchanged = { ...current }
    current = { read: 0, written: 0, calls: 0 }
    await send('/vocab', words('after'))
    costs.description = { ...current }
    current = { read: 0, written: 0, calls: 0 }
    await send('/vocab', {
      $defs: {
        ...words('after').$defs,
        added: { component: true, properties: { value: { type: 'number' } } },
      },
    })
    costs.added = { ...current }
    // A persisted older release stamp, discovered on the next ordinary wake.
    // The Store must fit its definitions without deriving deployment rows or
    // rebuilding unchanged history. This write is fixture setup, not measured.
    let older = {
      t: 'update',
      table: 'yak_kv',
      set: { v: val('previous release') },
      where: by({ k: 'schema' }),
    } as const
    driver({
      sql: { exec: sql },
      transactionSync: storage.transactionSync.bind(storage),
    }).query(older)
    current = { read: 0, written: 0, calls: 0 }
    store = new Store(ctx, {}, [])
    await send('/query?q=' + encodeURIComponent('.note .limit=1'))
    costs.releaseWake = { ...current }
    current = { read: 0, written: 0, calls: 0 }
    let found = await send('/query?q=' + encodeURIComponent('lemon .limit=1'))
    if (found.length !== 1) {
      throw new Error('retained prose lost its search index')
    }
    costs.search = { ...current }
    return { history, costs, shapes }
  } finally {
    storage.sql.exec = sql
  }
}
