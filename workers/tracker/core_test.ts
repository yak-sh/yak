import { derivedEid } from '@yaks/graph/identity'
// Queue delivery reaches independent tenant graphs through the same admission
// and effect handlers used by Durable Objects, without a platform kernel.

import { equal, ok, test } from '@yaks/testing'
import { type Bundle, type Comp, graph } from '@yaks/graph'
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

let legacy = (id: string, source = 'yak/git') =>
  capture(Error('legacy failure'), {
    eid: id,
    sink: () => {},
    tags: { migration: 'exception/1', store: source },
    during: { entity: id },
    .../^[a-f0-9]{40}$/.test(id) ? { commit: id } : {},
  })
let deliver = async (g: ReturnType<typeof fixture>, bodies: Bundle[][]) => {
  let ack = 0, retry = 0
  await consume(
    bodies.map((body) => ({
      body,
      ack: () => {
        ack++
      },
      retry: () => {
        retry++
      },
    })),
    () => g,
    async () => {},
    async () => {},
  )
  await g.drain()
  return {
    ack,
    retry,
    rows: await g.graph.read('.error *'),
    bugs: await g.bugs(),
  }
}

for (let id of ['a'.repeat(40), 'b'.repeat(64)]) {
  let body = legacy(id)
  let outcome = await deliver(fixture(), [body, body])
  test(`queued content-addressed errors keep their identity and count retries once (${id.length == 40 ? 'commit' : 'blob'})`, () => {
    equal([outcome.ack, outcome.retry], [2, 0])
    equal(outcome.rows.length, 1)
    let [row] = outcome.rows
    equal(row.entity.eid, id)
    equal((row.during as Comp).entity, id)
    equal((row.error as Comp).commit, id.length == 40 ? id : undefined)
    equal((row.error as Comp).tags, {
      migration: 'exception/1',
      store: 'yak/git',
    })
    equal((outcome.bugs[0].bug as Comp).hits, 1)
    equal(body[0].entity.eid, id)
  })
}

let unchanged = legacy(occurrence)
let unchangedOutcome = await deliver(fixture(), [unchanged, unchanged])
test('UUID migration occurrence identities remain unchanged', () => {
  equal([unchangedOutcome.ack, unchangedOutcome.retry], [2, 0])
  equal(unchangedOutcome.rows[0].entity.eid, occurrence)
})

let invalidNamed = records(undefined, 'ordinary-named-id')
let missingStore = legacy('unscoped-named-id')
;(missingStore[0].error as Comp).tags = { migration: 'exception/1' }
let guarded = legacy('c'.repeat(40))
guarded[0].$was = { error: { bug: null } }
let invalidOutcome = await deliver(fixture(), [
  invalidNamed,
  missingStore,
  guarded,
])
test('ordinary and migration word identities and mutable captures are set aside', () => {
  equal([invalidOutcome.ack, invalidOutcome.retry], [3, 0])
  equal(invalidOutcome.rows, [])
})

let child = derivedEid('child:3b21904a-b0fa-479b-8934-4286ae9c0cb1')
let boxed = records()
boxed[0].during = { session: child }
let boxedOutcome = await deliver(fixture(), [boxed, boxed])
test('box captures retain generated child session references across independent stores', () => {
  equal([boxedOutcome.ack, boxedOutcome.retry], [2, 0])
  equal(boxedOutcome.rows.length, 1)
  equal((boxedOutcome.rows[0].during as Comp).session, child)
  equal((boxedOutcome.bugs[0].bug as Comp).hits, 1)
})

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
  await consume(
    [message],
    (scope) => {
      equal(scope, space)
      return g
    },
    async () => {},
    async () => {},
  )
  equal(acked, 1)
  equal((await g.graph.get(rows.map((r) => r.entity.eid))).length, 2)
  await g.drain()
  let [bug] = await g.bugs()
  ok(bug)
  equal((bug.bug as Comp)?.hits, 1)
  let retained = await g.bug(bug.entity.eid)
  equal(await g.bug(String((bug.doc as Comp).title)), retained)
  equal(retained.map((row) => row.entity.eid), [bug.entity.eid, occurrence])
  await consume([message, message], () => g, async () => {}, async () => {})
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
    async () => {},
  )
  equal(acked, 5)
  equal(retry, 0)
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
  }, async () => {})
  equal([acked, retry, error], [0, 1, 1])
  failed = false
  await consume([message], () => destination, async () => {}, async () => {})
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
