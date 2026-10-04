// Real Store doors over workerd's SQL counters, without any live account.
import { Store } from './graph.ts'
import { IDEMPOTENCY } from './door.ts'
import type { Namespace } from './door.ts'
import type { DurableStorage } from '@yaks/durable-object'
import { profile, type Summary } from '../../packages/durable-object/profile.ts'

type Storage = DurableStorage & {
  sql: DurableStorage['sql'] & { databaseSize: number }
  deleteAll(): Promise<void>
  getAlarm(): Promise<number | null>
  deleteAlarm(): Promise<void>
  setAlarm(at: number): Promise<void>
}

export let storeCost = async (storage: Storage, kind: string) => {
  let samples: Summary[] = []
  let measured = profile((s) => samples.push(s))
  let counting = false
  let db: Storage = {
    ...storage,
    sql: {
      get databaseSize() {
        return storage.sql.databaseSize
      },
      exec(query, ...bindings) {
        let cursor = storage.sql.exec(query, ...bindings)
        let rows = cursor.toArray()
        if (cursor.rowsRead == null || cursor.rowsWritten == null) {
          throw new Error('This test requires workerd SQL row counters')
        }
        if (counting) {
          measured.observe({
            shape: query,
            rowsRead: cursor.rowsRead,
            rowsWritten: cursor.rowsWritten,
          })
        }
        return {
          ...cursor,
          toArray: () => rows,
          [Symbol.iterator]: () => rows.values(),
        }
      },
    },
    transactionSync: (f) => storage.transactionSync(f),
    deleteAll: () => storage.deleteAll(),
    getAlarm: () => storage.getAlarm(),
    setAlarm: (at) => storage.setAlarm(at),
    deleteAlarm: () => storage.deleteAlarm(),
  }
  let reports: number[] = []
  let ns: Namespace = {
    idFromName: (name) => name,
    get: () => ({
      fetch: async (req: Request) => {
        let body = await req.json() as { meter: { bytes: number } }[]
        reports.push(body[0].meter.bytes)
        return Response.json(body)
      },
    }),
  }
  let store = new Store({
    storage: db,
    getWebSockets: () => [],
    acceptWebSocket: () => {},
  }, { STORE: ns })
  let app = crypto.randomUUID()
  let headers: Record<string, string> = kind == 'directory'
    ? { 'x-store': 'yak/platform', 'x-yak-kernel': '1' }
    : {
      'x-store': 'probe/store-cost',
      'x-yak-app': app,
      'x-yak-role': 'owner',
      'x-yak-person': crypto.randomUUID(),
      'x-yak-access': 'public',
    }
  let post = async (path: string, body: unknown, keyed = false) => {
    let response = await store.fetch(
      new Request(`http://store${path}`, {
        method: 'POST',
        headers: {
          ...headers,
          ...(keyed ? { [IDEMPOTENCY]: crypto.randomUUID() } : {}),
        },
        body: JSON.stringify(body),
      }),
    )
    if (!response.ok) {
      throw new Error(`${path}: ${response.status} ${await response.text()}`)
    }
    return response.json()
  }
  if (kind == 'directory') {
    await post('/apply', [{ entity: { eid: app }, meter: { bytes: 1 } }], true)
    for (let i = 0; i < 1000; i++) {
      await post(
        '/apply',
        [{ entity: { eid: app }, meter: { bytes: i + 2 } }],
        true,
      )
    }
    counting = true
    await measured.run(
      'POST /apply',
      () =>
        post(
          '/apply',
          [{ entity: { eid: app }, meter: { bytes: 2000 } }],
          true,
        ),
    )
    measured.flush()
    return { kind, reports: reports.length, samples }
  }
  await post('/apply', [{ entity: { eid: app }, doc: { title: 'baseline' } }])
  // Let the initial report finish; no clock or alarm delivers a report.
  await Promise.resolve()
  if (!reports.length) throw new Error('Store did not report its initial size')
  let before = reports.length
  counting = true
  for (let i = 0; i < 24; i++) {
    await measured.run('POST /apply', () =>
      post('/apply', [{
        entity: { eid: crypto.randomUUID() },
        doc: { body: 'x'.repeat(4096) },
      }]))
  }
  await Promise.resolve()
  let burst = reports.length - before
  measured.flush()
  let idle = reports.length
  await store.fetch(new Request('http://store/vocab', { headers }))
  await Promise.resolve()
  let movedBefore = reports.length
  await post('/apply', [{
    entity: { eid: crypto.randomUUID() },
    doc: { body: 'large '.repeat(210_000) },
  }])
  await Promise.resolve()
  let movementReports = reports.length - movedBefore
  return {
    kind,
    reports: burst,
    idleReports: idle == movedBefore ? 0 : movedBefore - idle,
    movementReports,
    samples,
  }
}
