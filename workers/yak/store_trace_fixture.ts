// Workerd-only trace regression: cursor counters, not returned-row counts.
import { type Bindings, Store } from './graph.ts'
import { type DurableStorage, storage } from '@yaks/durable-object'
import { options, store as tracker, vocab } from '../tracker/core.ts'
import type { Bundle } from '@yaks/graph'

export type TraceStorage = DurableStorage & {
  sql: DurableStorage['sql'] & { databaseSize: number }
  deleteAll(): Promise<void>
  getAlarm(): Promise<number | null>
  deleteAlarm(): Promise<void>
  setAlarm(at: number): Promise<void>
}
export type Cost = { read: number; written: number; statements: number }
let empty = (): Cost => ({ read: 0, written: 0, statements: 0 })
let person = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
let app = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'
let space = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
let recipe = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
let headers = {
  'x-store': 'probe/store-trace',
  'x-yak-person': person,
  'x-yak-role': 'owner',
  'x-yak-app': app,
  'x-yak-space': space,
  'x-yak-access': 'public',
}

export let traceCost = async (db: TraceStorage) => {
  let sql = db.sql.exec.bind(db.sql), cost = empty(), measuring = false
  db.sql.exec = (query, ...bindings) => {
    let cursor = sql(query, ...bindings), rows = cursor.toArray()
    if (cursor.rowsRead == null || cursor.rowsWritten == null) {
      throw Error('trace measurement requires workerd SQL cursor counters')
    }
    if (measuring) {
      cost.read += cursor.rowsRead
      cost.written += cursor.rowsWritten
      cost.statements++
    }
    return {
      rowsRead: cursor.rowsRead,
      rowsWritten: cursor.rowsWritten,
      toArray: () => rows,
      [Symbol.iterator]: () => rows.values(),
    }
  }
  let reported: Record<string, { cost: Cost; deliveries: number }> = {}
  let traces: Record<string, Bundle[]> = {}
  try {
    for (let mode of ['off', 'on']) {
      measuring = false
      await db.deleteAll()
      let deliveries: Bundle[][] = []
      let store = new Store({
        storage: db,
        getWebSockets: () => [],
        acceptWebSocket: () => {},
      }, {
        ...mode == 'off' ? { STORE_TRACING: 'off' } : {},
        ERRORS: {
          send: (rows: Bundle[]) => {
            deliveries.push(rows)
            return Promise.resolve()
          },
        },
      } as Bindings)
      let ask = async (path: string, body?: unknown, kernel = false) => {
        let res = await store.fetch(
          new Request(`http://store${path}`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: {
              ...headers,
              ...kernel ? { 'x-yak-kernel': '1' } : {},
              ...path == '/apply'
                ? { 'idempotency-key': crypto.randomUUID() }
                : {},
            },
            ...body === undefined ? {} : { body: JSON.stringify(body) },
          }),
        )
        if (!res.ok) throw Error(`${path}: ${await res.text()}`)
        await res.body?.cancel()
      }
      await ask('/vocab', {
        $defs: { recipe: { properties: { title: { type: 'string' } } } },
      })
      await ask('/apply', [{
        entity: { eid: recipe },
        recipe: { title: 'Ready' },
      }])
      await db.deleteAlarm()
      deliveries.length = 0
      for (let kind of ['read', 'write']) {
        cost = empty()
        measuring = true
        if (kind == 'read') await ask('/query?q=.recipe&.limit=1')
        else {await ask('/apply', [{
            entity: { eid: recipe },
            recipe: { title: 'Edited' },
          }])}
        measuring = false
        reported[`${mode}/${kind}`] = { cost, deliveries: deliveries.length }
        deliveries.length = 0
      }
      if (mode == 'off') continue
      for (let kind of ['read', 'write']) {
        await ask('/trace', { next: 1, rate: 0 }, true)
        deliveries.length = 0
        cost = empty()
        measuring = true
        if (kind == 'read') await ask('/query?q=.recipe&.limit=1')
        else {await ask('/apply', [{
            entity: { eid: recipe },
            recipe: { title: 'Traced' },
          }])}
        measuring = false
        reported[`traced/${kind}`] = { cost, deliveries: deliveries.length }
        traces[kind] = deliveries.flat()
      }
      await ask('/trace', { next: 0, rate: 1 }, true)
      deliveries.length = 0
      await ask('/query?q=.recipe&.limit=1')
      reported.sample = { cost: empty(), deliveries: deliveries.length }
      await ask('/trace', { next: 2, rate: 0 }, true)
      deliveries.length = 0
      await store.alarm()
      reported.alarm = { cost: empty(), deliveries: deliveries.length }
      deliveries.length = 0
      let attachment: unknown = { writer: { actor: { by: person } } }
      let frames: unknown[] = []
      let wire = {
        readyState: 1,
        send: (data: string) => {
          frames.push(JSON.parse(data))
        },
        close: () => {},
        serializeAttachment: (value: unknown) => {
          attachment = value
        },
        deserializeAttachment: () => attachment,
      }
      await store.webSocketMessage(
        wire,
        JSON.stringify({ subscribe: '.recipe', id: 'recipes' }),
      )
      reported.socket = { cost: empty(), deliveries: deliveries.length }
      deliveries.length = 0
      await ask('/query?q=.recipe&.limit=1')
      reported.exhausted = { cost: empty(), deliveries: deliveries.length }
      // A broad query really reads more than the retention threshold; this is
      // not a fake counter or a replay of an earlier span tree.
      await ask('/trace', { next: 0, rate: 0 }, true)
      await store.door.graph.storage.tx((tx) =>
        tx.patch(Array.from({ length: 2600 }, (_, i) => ({
          entity: {
            eid: `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          },
          recipe: { title: `Recipe ${i}` },
        })))
      )
      deliveries.length = 0
      cost = empty()
      measuring = true
      await ask('/query?q=.recipe%20*%20.limit=2601')
      measuring = false
      reported.threshold = { cost, deliveries: deliveries.length }
    }
    // Separate the tracker storage from the app; its schema and installation
    // are setup, not part of the measured trace admission.
    measuring = false
    await db.deleteAll()
    let saved = storage(db, vocab, options)
    saved.install()
    let target = tracker(saved, { sink: () => {}, store: space })
    let intake: Record<string, Cost> = {}
    for (let kind of ['read', 'write']) {
      cost = empty()
      measuring = true
      await target.ingest(traces[kind])
      measuring = false
      intake[kind] = cost
      cost = empty()
      measuring = true
      await target.ingest(traces[kind])
      measuring = false
      intake[`${kind}/duplicate`] = cost
    }
    // Independently delivered queue chunks can arrive backwards. Missing
    // trace/parent references must not make later real records look delivered.
    let reordered = structuredClone(traces.write)
    let ids = new Map(
      reordered.map((row) => [row.entity.eid, crypto.randomUUID()]),
    )
    for (let row of reordered) {
      row.entity.eid = ids.get(row.entity.eid)!
      if (row.span) {
        let span = row.span as { trace: string; parent?: string }
        span.trace = ids.get(span.trace)!
        if (span.parent) span.parent = ids.get(span.parent)!
      }
    }
    cost = empty()
    measuring = true
    for (let row of reordered.toReversed()) await target.ingest([row])
    measuring = false
    intake.reordered = cost
    let restored = await target.graph.get(
      reordered.map((row) => row.entity.eid),
    )
    let complete = restored.filter((row) => row.trace || row.span).length
    cost = empty()
    measuring = true
    await target.ingest(reordered)
    measuring = false
    intake['reordered/duplicate'] = cost
    let sizes = Object.fromEntries(
      Object.entries(traces).map(([name, rows]) => [name, {
        entities: rows.length,
        spans: rows.filter((row) => row.span).length,
        bytes: new TextEncoder().encode(JSON.stringify(rows)).byteLength,
      }]),
    )
    return {
      requests: reported,
      traces,
      sizes,
      intake,
      reordered: { complete, expected: reordered.length },
    }
  } finally {
    db.sql.exec = sql
  }
}
