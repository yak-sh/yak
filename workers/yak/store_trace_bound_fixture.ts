// A real Store repeatedly reads an over-the-line query while its trace clock
// advances explicitly. SQL cursor costs show source quotas stay memory-only.
import { Store } from './graph.ts'
import type { Bundle } from '@yaks/graph'
import type { TraceStorage } from './store_trace_fixture.ts'

export let traceSourceBound = async (db: TraceStorage) => {
  let execute = db.sql.exec.bind(db.sql)
  let measuring = false
  let cost = { read: 0, written: 0 }
  db.sql.exec = (query, ...bindings) => {
    let cursor = execute(query, ...bindings)
    let rows = cursor.toArray()
    if (measuring) {
      if (cursor.rowsRead == null || cursor.rowsWritten == null) {
        throw Error('trace source bound requires actual workerd row counts')
      }
      cost.read += cursor.rowsRead
      cost.written += cursor.rowsWritten
    }
    return {
      rowsRead: cursor.rowsRead,
      rowsWritten: cursor.rowsWritten,
      toArray: () => rows,
      [Symbol.iterator]: () => rows.values(),
    }
  }
  try {
    await db.deleteAll()
    let now = 1000
    let batches: Bundle[][] = []
    let store = new Store(
      {
        storage: db,
        getWebSockets: () => [],
        acceptWebSocket: () => {},
      },
      {
        ERRORS: {
          send: (rows) => {
            batches.push(rows)
            return Promise.resolve()
          },
        },
      },
      undefined,
      () => now,
    )
    let headers = {
      'x-store': 'probe/store-trace-bound',
      'x-yak-app': 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
      'x-yak-space': 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'x-yak-person': 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
      'x-yak-role': 'owner',
      'x-yak-access': 'public',
    }
    let ask = async (path: string, body?: unknown) => {
      let response = await store.fetch(
        new Request(`http://store${path}`, {
          method: body ? 'POST' : 'GET',
          headers: { ...headers, ...body ? { 'x-yak-kernel': '1' } : {} },
          ...body ? { body: JSON.stringify(body) } : {},
        }),
      )
      if (!response.ok) throw Error(`${path}: ${await response.text()}`)
      await response.body?.cancel()
    }
    await ask('/vocab', {
      $defs: { recipe: { properties: { title: { type: 'string' } } } },
    })
    await store.door.graph.storage.tx((tx) =>
      tx.patch(Array.from({ length: 2601 }, (_, i) => ({
        entity: {
          eid: `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        },
        recipe: { title: `Recipe ${i}` },
      })))
    )
    await db.deleteAlarm()
    batches.length = 0
    let query = '/query?q=.recipe%20*%20.limit=2601'
    // Warm lazy identity/read preparation before measuring the repeated loop.
    await ask(query)
    batches.length = 0
    now += 3_600_000
    let costs: { read: number; written: number }[] = []
    for (let i = 0; i < 10; i++) {
      cost = { read: 0, written: 0 }
      measuring = true
      await ask(query)
      measuring = false
      costs.push(cost)
    }
    let firstHour = batches.length
    let firstRows = batches.flat()
    now += 3_600_000 - 1
    await ask(query)
    let justBeforeHour = batches.length
    now++
    await ask(query)
    let afterHour = batches.length
    let secondRows = batches.slice(firstHour).flat()
    let root = secondRows.find((row) =>
      row.span && !(row.span as { parent?: string }).parent
    )
    await ask('/trace', { next: 1, rate: 0 })
    batches.length = 0
    await ask(query)
    let onDemand = batches.length
    batches.length = 0
    await ask(query)
    let afterOnDemand = batches.length
    await ask('/trace', { next: 0, rate: 1 })
    await ask(query)
    await ask(query)
    let samples = batches.length
    return {
      costs,
      firstHour,
      justBeforeHour,
      afterHour,
      firstRepeats: firstRows.find((row) =>
        row.span && !(row.span as { parent?: string }).parent
      )?.repeats,
      secondRepeats: root?.repeats,
      onDemand,
      afterOnDemand,
      samples,
    }
  } finally {
    db.sql.exec = execute
  }
}
