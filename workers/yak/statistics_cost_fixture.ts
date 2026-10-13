// Installation over persisted planner statistics, measured at the same SQL
// cursor boundary as the kernel's other row-cost probes. Each incarnation
// binds a new Store to the same durable data; no live account participates.
import { type State, Store } from './graph.ts'
import { driver } from '@yaks/durable-object'
import { by, scan } from '@yaks/sql'

export let statisticsCost = async (db: State['storage']) => {
  let ctx = { storage: db, getWebSockets: () => [], acceptWebSocket: () => {} }
  let headers = {
    'x-store': 'probe/statistics-cost',
    'x-yak-app': 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
    'x-yak-person': 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    'x-yak-role': 'owner',
    'x-yak-access': 'private',
  }
  let store = new Store(ctx, {}, [])
  let res = await store.fetch(
    new Request('http://store/vocab', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        $defs: {
          note: {
            component: true,
            index: [['label']],
            properties: { label: { type: 'string' } },
          },
          empty: {
            component: true,
            index: [['label']],
            properties: { label: { type: 'string' } },
          },
        },
      }),
    }),
  )
  if (!res.ok) throw new Error(await res.text())
  await res.body?.cancel()
  let g = (await store.door).graph
  // Outgrow the empty schema before taking statistics, using runtime bytes
  // rather than a test's invented estimate of the store's size.
  await g.storage.tx((tx) =>
    tx.patch(Array.from({ length: 128 }, (_, n) => ({
      entity: { eid: `note-${n}` },
      note: { label: `${n}:` + 'x'.repeat(64 * 1024) },
    })))
  )
  g.storage.install()
  // What an install owes, the alarm analyzes.
  await store.alarm()
  let sql = db.sql.exec.bind(db.sql)
  let size = () =>
    scan(driver(db), 'sqlite_stat1', by({ tbl: 'note' }), ['stat'])
  let statistics = size()
  let current = { read: 0, written: 0, analysisRead: 0, analysisWritten: 0 }
  db.sql.exec = (query, ...args) => {
    let cursor = sql(query, ...args), rows = cursor.toArray()
    if (cursor.rowsRead == null || cursor.rowsWritten == null) {
      throw new Error('statistics cost requires kernel cursor counters')
    }
    current.read += cursor.rowsRead
    current.written += cursor.rowsWritten
    if (
      /\b(?:optimize|analyze)\b|\bsqlite_stat[14]\b|\bcount\(\)/i.test(query)
    ) {
      current.analysisRead += cursor.rowsRead
      current.analysisWritten += cursor.rowsWritten
    }
    return {
      rowsRead: cursor.rowsRead,
      rowsWritten: cursor.rowsWritten,
      toArray: () => rows,
      [Symbol.iterator]: () => rows.values(),
    }
  }
  let installs: typeof current[] = []
  let reopens: typeof current[] = []
  try {
    for (let n = 0; n < 3; n++) {
      current = { read: 0, written: 0, analysisRead: 0, analysisWritten: 0 }
      store = new Store(ctx, {}, [])
      // Boot and routing have their own costs. Measure the public installation
      // interface itself after binding the next incarnation.
      let r = await store.fetch(
        new Request('http://store/query?q=.note%26.limit=1', {
          headers,
        }),
      )
      await r.body?.cancel()
      if (!r.ok) throw new Error(`reopen: ${r.status}`)
      reopens.push({ ...current })
      current = { read: 0, written: 0, analysisRead: 0, analysisWritten: 0 }
      ;(await store.door).graph.storage.install()
      installs.push({ ...current })
    }
  } finally {
    db.sql.exec = sql
  }
  return { statistics, after: size(), reopens, installs }
}
