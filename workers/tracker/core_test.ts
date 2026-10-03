// Queue delivery reaches independent tenant graphs through the same admission
// and effect handlers used by Durable Objects, without a platform kernel.

import { equal, ok, test } from '@yaks/testing'
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
  equal(bug.bug?.hits, 1)
  await consume([message, message], () => g, async () => {})
  await g.drain()
  equal((await g.bugs())[0].bug?.hits, 1)
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
    equal(row.during?.space, scope == platform ? undefined : scope)
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
  await consume([message], () => destination, async () => {
    error++
    throw Error('report unavailable')
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
  equal((await g.bugs())[0].bug?.hits, 1)
  equal(batch(rows).scope, platform)
})
