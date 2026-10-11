// Queue delivery reaches independent tenant graphs through the same admission
// and effect handlers used by Durable Objects, without a platform kernel.

import { equal, ok, test } from '@yaks/testing'
import { type Comp, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { capture } from '@yaks/tracker/report'
import { options, platform, store, vocab } from './core.ts'
import { batch, consume } from './queue.ts'

let space = '00000000-0000-4000-8000-000000000001'
let other = '00000000-0000-4000-8000-000000000002'
let occurrence = '00000000-0000-4000-8000-000000000003'
let records = (scope?: string, id = occurrence) =>
  capture(Error('broken'), {
    eid: id,
    sink: () => {},
    during: scope ? { space: scope } : {},
  })
let fixture = () => store(ram(vocab, options), { sink: () => {} })

let failedStorage = ram(vocab, options)
await graph({ vocab, storage: failedStorage }).apply([
  { entity: { eid: 'failed-bug' }, bug: { fault: 'failed-notification' } },
  {
    entity: { eid: 'failed-notify' },
    effect: {
      handler: 'bug_notify',
      target: 'failed-bug',
      comp: 'bug',
      kind: 'created',
      state: 'pending',
      attempts: 1,
    },
  },
], { trusted: true })
let reported: unknown[] = [], fallback: unknown[] = []
let notificationFailure = Error('notification unavailable')
await store(failedStorage, {
  sink: (rows) => void fallback.push(rows),
  report: (error) => void reported.push(error),
  notify: () => {
    throw notificationFailure
  },
}).drain()

test('tracker effects report through their host without a second capture', () => {
  equal(reported, [notificationFailure])
  equal(fallback, [])
})

test('queue commits full bundles then acks, duplicates preserve grouping and hits', async () => {
  let g = fixture()
  let rows = records(space)
  rows.push({
    entity: { eid: '00000000-0000-4000-8000-000000000004' },
    request: { method: 'POST', url: '/apply', status: 500 },
  })
  let acked = 0
  let retry = 0
  let message = {
    body: rows,
    ack: () => {
      acked++
    },
    retry: () => {
      retry++
    },
  }
  await consume([message], (scope) => {
    equal(scope, space)
    return g
  }, async () => {})
  equal(acked, 1)
  equal((await g.graph.get(rows.map((r) => r.entity.eid))).length, 2)
  await g.drain()
  let [bug] = await g.bugs()
  ok(bug)
  equal((bug.bug as Comp)?.hits, 1)
  let retained = await g.bug(bug.entity.eid)
  equal(await g.bug(String((bug.doc as Comp).title)), retained)
  equal(retained.map((row) => row.entity.eid), [bug.entity.eid, occurrence])
  await consume([message, message], () => g, async () => {})
  await g.drain()
  equal(((await g.bugs())[0].bug as Comp)?.hits, 1)
  equal(acked, 3)
  equal(retry, 0)
})

test('queue isolates platform and each space; mixed or slug scopes never commit', async () => {
  let stores = new Map([[space, fixture()], [other, fixture()], [
    platform,
    fixture(),
  ]])
  let acked = 0
  let retry = 0
  let message = (body: unknown) => ({
    body,
    ack: () => {
      acked++
    },
    retry: () => {
      retry++
    },
  })
  await consume(
    [
      message(records(space)),
      message(records(other)),
      message(records()),
      message([...records(space), ...records(other)]),
      message(records('yourname')),
    ],
    (scope) => stores.get(scope)!,
    async () => {},
  )
  equal(acked, 3)
  equal(retry, 2)
  for (let [scope, g] of stores) {
    let [row] = await g.graph.get([occurrence])
    equal((row.during as Comp)?.space, scope == platform ? undefined : scope)
  }
})

test('failed admission retries without ack and recovers on redelivery', async () => {
  let g = fixture()
  let acked = 0
  let retry = 0
  let error = 0
  let failed = true
  let message = {
    body: records(space),
    ack: () => {
      acked++
    },
    retry: () => {
      retry++
    },
  }
  let destination = {
    ingest: async (rows: Parameters<typeof g.ingest>[0]) => {
      if (failed) throw Error('store unavailable')
      await g.ingest(rows)
    },
  }
  await consume([message], () => destination, () => {
    error++
    return Promise.reject(Error('report unavailable'))
  })
  equal([acked, retry, error], [0, 1, 1])
  failed = false
  await consume([message], () => destination, async () => {})
  equal(acked, 1)
  equal((await g.graph.get([occurrence])).length, 1)
})

test('same batch duplicate eids do not multiply occurrence counts', async () => {
  let g = fixture()
  let rows = records()
  await g.ingest([...rows, ...rows])
  await g.drain()
  equal(((await g.bugs())[0].bug as Comp)?.hits, 1)
  equal(batch(rows).scope, platform)
})

test('deployed resolves prior versions but keeps the serving version open', async () => {
  let g = fixture()
  let app = '00000000-0000-4000-8000-000000000005'
  let old = capture(Error('old break'), {
    sink: () => {},
    version: 1,
    during: { app, space },
    fault: 'old',
  })
  let current = capture(Error('current break'), {
    sink: () => {},
    version: 2,
    during: { app, space },
    fault: 'current',
  })
  await g.ingest([...old, ...current])
  await g.drain()
  await g.deployed(app, 2)
  let open = await g.unseen(app)
  equal(open.length, 1)
  equal((open[0].bug as Comp)?.fault, 'current')
})
