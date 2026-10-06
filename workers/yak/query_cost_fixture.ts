// Real Store query costs: every SQL cursor's billed reads and writes, including boot.
import { Store } from './graph.ts'
import type { DurableStorage } from '@yaks/durable-object'
import type { Cost } from './play_cost_fixture.ts'

type Storage = DurableStorage & {
  sql: DurableStorage['sql'] & { databaseSize: number }
  deleteAll(): Promise<void>
  getAlarm(): Promise<number | null>
  deleteAlarm(): Promise<void>
  setAlarm(at: number): Promise<void>
}
let empty = (): Cost => ({ read: 0, written: 0, calls: 0 })
let plus = (a: Cost, b: Cost) => {
  a.read += b.read
  a.written += b.written
  a.calls += b.calls
}
export let queryCost = async (db: Storage) => {
  let headers = {
    'x-store': 'probe/query-cost',
    'x-yak-access': 'public',
    'x-yak-role': 'owner',
    'x-yak-person': 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    'x-yak-app': 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
  }
  let context = {
    storage: db,
    getWebSockets: () => [],
    acceptWebSocket: () => {},
  }
  let store = new Store(context)
  let tags = Array.from({ length: 9 }, (_, i) => `tag${i}`)
  let words = {
    $defs: {
      recipe: { properties: { title: { type: 'string' } } },
      ...Object.fromEntries(tags.map((tag) => [tag, { properties: {} }])),
    },
  }
  let res = await store.fetch(
    new Request('http://store/vocab', {
      method: 'POST',
      headers,
      body: JSON.stringify(words),
    }),
  )
  if (!res.ok) throw new Error(await res.text())
  await res.body?.cancel()
  await store.door.graph.storage.tx((tx) =>
    tx.patch(Array.from({ length: 1000 }, (_, i) => ({
      entity: { eid: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` },
      recipe: { title: `Recipe ${i}` },
    })))
  )
  await store.door.graph.storage.tx((tx) =>
    tx.patch(Array.from({ length: 512 }, (_, i) => ({
      entity: { eid: `10000000-0000-4000-8000-${String(i).padStart(12, '0')}` },
      ...Object.fromEntries(
        tags.filter((_, n) => i & (1 << n)).map((tag) => [tag, {}]),
      ),
    })))
  )
  await db.deleteAlarm()
  let sql = db.sql.exec.bind(db.sql), current = empty()
  let shapes = new Map<string, Cost>()
  db.sql.exec = (query, ...bindings) => {
    let cursor = sql(query, ...bindings), rows = cursor.toArray()
    if (cursor.rowsRead == null || cursor.rowsWritten == null) {
      throw new Error('requires cursor counters')
    }
    let cost = { read: cursor.rowsRead, written: cursor.rowsWritten, calls: 1 }
    plus(current, cost)
    plus(
      shapes.get(query) ?? (shapes.set(query, empty()), shapes.get(query)!),
      cost,
    )
    return {
      rowsRead: cursor.rowsRead,
      rowsWritten: cursor.rowsWritten,
      toArray: () => rows,
      [Symbol.iterator]: () => rows.values(),
    }
  }
  try {
    let requests: Record<
      string,
      { cost: Cost; shapes: { sql: string; cost: Cost }[] }
    > = {}
    for (let name of ['cold', 'warm']) {
      current = empty()
      shapes.clear()
      if (name == 'cold') store = new Store(context)
      let res = await store.fetch(
        new Request('http://store/query?q=.recipe%26.limit=1', { headers }),
      )
      if (!res.ok) throw new Error(await res.text())
      let body = await res.json() as { recipe?: { title?: string } }[]
      if (body.length != 1 || body[0].recipe?.title != 'Recipe 999') {
        throw new Error(`expected one row: ${JSON.stringify(body)}`)
      }
      for (let i = 0; i < 100; i++) await Promise.resolve()
      requests[name] = {
        cost: current,
        shapes: [...shapes].map(([sql, cost]) => ({ sql, cost })),
      }
    }
    return requests
  } finally {
    db.sql.exec = sql
  }
}
