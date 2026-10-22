// Real Store doors over workerd's SQL counters, without any live account.
import { Store } from './graph.ts'
import { IDEMPOTENCY } from './door.ts'
import type { Namespace } from './door.ts'
import type { DurableStorage } from '@yaks/durable-object'
import { profile, type Summary } from '../../packages/durable-object/profile.ts'
import { useUntil } from './used.ts'

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
  let app = crypto.randomUUID(),
    space = crypto.randomUUID(),
    person = crypto.randomUUID()
  let ns: Namespace = {
    idFromName: (name) => name,
    get: () => ({
      fetch: async (req: Request) => {
        let url = new URL(req.url)
        if (url.pathname == '/used') {
          if (req.method != 'POST' || req.headers.get('x-yak-kernel') != '1') {
            throw new Error('unexpected use request')
          }
          let { eid } = await req.json() as { eid: string }
          if (eid != app) throw new Error('unknown app use')
          return Response.json({ at: useUntil() })
        }
        if (url.pathname == '/query') {
          let q = url.searchParams.get('q') ?? ''
          if (q.includes(`.entity.eid=${app}`)) {
            return Response.json([{
              entity: { eid: app },
              app: { space, access: 'public' },
            }])
          }
          if (q.includes('.member')) {
            return Response.json([{
              entity: { eid: crypto.randomUUID() },
              member: { space, person, role: 'owner' },
            }])
          }
          return Response.json([])
        }
        if (url.pathname != '/apply') {
          throw new Error('unexpected directory request')
        }
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
  let headers: Record<string, string> = kind == 'directory'
    ? { 'x-store': 'yak/platform', 'x-yak-kernel': '1' }
    : {
      'x-store': 'probe/store-cost',
      'x-yak-app': app,
      'x-yak-role': 'owner',
      'x-yak-person': person,
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
    await post('/apply', [
      {
        entity: { eid: space },
        space: { slug: 'cost', store: 'cost' },
        doc: { title: 'Cost' },
      },
      {
        entity: { eid: app },
        app: {
          slug: 'cost',
          space,
          version: 1,
          access: 'private',
          store: 'cost/cost',
        },
        doc: { title: 'Cost app' },
        meter: { bytes: 1 },
      },
    ], true)
    // Twenty paying-account shapes and their app/deploy/member rows: the
    // measured update must be independent of unrelated directory data.
    for (let i = 0; i < 20; i++) {
      let account = crypto.randomUUID(),
        owner = crypto.randomUUID(),
        other = crypto.randomUUID()
      await post('/apply', [
        { entity: { eid: owner }, person: {}, doc: { title: `Owner ${i}` } },
        {
          entity: { eid: account },
          space: { slug: `account${i}`, store: `account${i}` },
          plan: { tier: 'plus' },
        },
        {
          entity: { eid: crypto.randomUUID() },
          member: { person: owner, space: account, role: 'owner' },
        },
        {
          entity: { eid: other },
          app: {
            slug: 'app',
            space: account,
            version: 1,
            access: 'private',
            store: `account${i}/app`,
          },
          meter: { bytes: 1 },
        },
        {
          entity: { eid: crypto.randomUUID() },
          deploy: { app: other, version: 1 },
        },
      ], true)
    }
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
  if (kind == 'cardinality') {
    let cardinality = async () => {
      let res = await store.fetch(
        new Request('http://store/query?q=.doc%20.count&trusted=1', {
          headers: { ...headers, 'x-yak-kernel': '1' },
        }),
      )
      if (!res.ok) throw Error(await res.text())
      return res.json() as Promise<{ count: number }>
    }
    counting = true
    let seeded = await measured.run('count activation', cardinality)
    measured.flush(Date.now() + 120_000)
    let activation = samples.pop()!
    counting = false
    await post(
      '/apply',
      Array.from(
        { length: 20 },
        (_, i) => ({
          entity: { eid: `real-count-${i}` },
          doc: { title: 'same' },
        }),
      ),
    )
    counting = true
    let first = await measured.run('count steady', cardinality)
    measured.flush(Date.now() + 120_000)
    let firstCost = samples.pop()!
    counting = false
    await post(
      '/apply',
      Array.from(
        { length: 200 },
        (_, i) => ({
          entity: { eid: `more-count-${i}` },
          doc: { title: 'same' },
        }),
      ),
    )
    counting = true
    let second = await measured.run('count steady', cardinality)
    measured.flush(Date.now() + 120_000)
    let secondCost = samples.pop()!
    return {
      kind,
      reports: reports.length,
      samples: [],
      cardinality: { seeded, activation, first, firstCost, second, secondCost },
    }
  }

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
