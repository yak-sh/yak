// The platform authority persists reservations before forwarding any trace.
import { equal, ok, test } from '@yaks/testing'
import { durable } from '../../packages/durable-object/testing.ts'
import type { Bundle } from '@yaks/graph'
import { reserveTrace, TRACE_CEILING, traceBatch } from '@yaks/tracker/intake'
import { type State, Tracker } from './object.ts'
import { platform } from './core.ts'
import { consume } from './queue.ts'
import { sign } from './auth.ts'

let space = '00000000-0000-4000-8000-000000000001'
let uuid = () => crypto.randomUUID()
let rows = (scope = space, spans = 1): Bundle[] => {
  let root = uuid()
  let body: Bundle[] = [{
    entity: { eid: root },
    during: { space: scope },
    trace: {
      op: 'request',
      name: 'query',
      at: '2026-10-06T01:00:00Z',
    },
  }, {
    entity: { eid: uuid() },
    during: { space: scope },
    span: {
      trace: root,
      op: 'request',
      name: 'query',
    },
    elapsed: { start: 0, ms: 0 },
    rows_read: { n: 11_000 },
    rows_written: { n: 0 },
    statements: { n: 1 },
    repeats: { n: 2 },
  }]
  let parent = body[1].entity.eid
  for (let i = 1; i < spans; i++) {
    body.push({
      ...body[1],
      entity: { eid: uuid() },
      span: { trace: root, parent, op: 'sql', name: 'select' },
    })
  }
  return body
}
let state = (storage: State['storage'], name: string): State => ({
  id: { name },
  storage,
  getWebSockets: () => [],
  acceptWebSocket: () => {},
})

test('trace shapes bound components, references, root and whole capture', () => {
  ok(traceBatch(rows()))
  let body = rows()
  equal(traceBatch([body[1]]), undefined)
  equal(
    traceBatch([
      { ...body[0], entity: { ...body[0].entity, num: 1 } },
      body[1],
    ]),
    undefined,
  )
  equal(traceBatch([{ ...body[0], $actor: space }, body[1]]), undefined)
  equal(traceBatch([{ ...body[0], error: {} }, body[1]]), undefined)
  equal(
    traceBatch([body[0], {
      ...body[1],
      span: { ...(body[1].span as object), parent: uuid() },
    }]),
    undefined,
  )
  equal(
    traceBatch([body[0], { ...body[1], statements: { n: Infinity } }]),
    undefined,
  )
  equal(
    traceBatch([...body, ...Array.from({ length: 9 }, () => rows()[1])]),
    undefined,
  )
  equal(traceBatch(rows(space, 201)), undefined)
  ok(traceBatch(rows(space, 200)))
  let capture = ok(traceBatch(body))
  equal(capture.cost, 136)
  let held = reserveTrace(undefined, 0, capture.cost)!
  equal(reserveTrace(held, 1_000_000, TRACE_CEILING), undefined)
})

test('global ceiling serializes spaces, persists across reboot, rolls from completion and counts drops', async () => {
  let db = durable(), clock = 0, delivered = 0
  let target = new Tracker(state(db, space), {}, () => clock)
  await target.boot()
  let forward = (body: Bundle[]) => {
    delivered++
    clock += 1000
    return target.ingestTrace(body)
  }
  let env = { TRACKERS: { getByName: () => ({ ingestTrace: forward }) } }
  let authority = new Tracker(state(db, platform), env, () => clock)
  await authority.boot()
  let outcomes = await Promise.all(
    Array.from(
      { length: 20 },
      () => authority.admitTrace(space, rows(space, 200)),
    ),
  )
  equal(outcomes.filter((r) => r.accepted).length, 3)
  equal(delivered, 3)
  equal(authority.traceBudget().reserved, 38616)
  equal(authority.traceBudget().dropped, 17)
  authority = new Tracker(state(db, platform), env, () => clock)
  equal((await authority.admitTrace(space, rows(space, 200))).accepted, false)
  clock = 3_600_999
  equal((await authority.admitTrace(space, rows(space, 200))).accepted, false)
  clock = 3_601_000
  equal((await authority.admitTrace(space, rows(space, 200))).accepted, true)
  // Clock rollback cannot expire a slot or restart the platform allowance.
  clock = -1
  equal((await authority.admitTrace(space, rows(space, 200))).accepted, false)
  let coldTarget = new Tracker(state(db, space), {}, () => clock)
  equal(await coldTarget.ingestTrace(rows()), true)
  equal((await coldTarget.tracker!.graph.read('.trace')).length, 5)
})

test('failed forwarding keeps a pending durable charge rather than refunding on restart', async () => {
  let db = durable(), clock = 0
  let env = {
    TRACKERS: {
      getByName: () => ({ ingestTrace: () => Promise.reject(Error('failed')) }),
    },
  }
  let authority = new Tracker(state(db, platform), env, () => clock)
  await authority.boot()
  for (let i = 0; i < 3; i++) {
    await authority.admitTrace(space, rows(space, 200))
  }
  equal(authority.traceBudget().pending, true)
  equal(authority.traceBudget().reserved, 38616)
  clock = 10_000_000
  authority = new Tracker(state(db, platform), env, () => clock)
  equal((await authority.admitTrace(space, rows(space, 200))).accepted, false)
  equal(authority.traceBudget().reserved, 38616)
})

test('queue acknowledges dropped traces without retrying or reporting and leaves errors independent', async () => {
  let db = durable(), authority = new Tracker(state(db, platform))
  await authority.boot()
  let acknowledged = 0, reported = 0, errored = 0
  let body = rows()
  await consume([
    {
      body: [body[1]],
      ack: () => acknowledged++,
      retry: () => {
        throw Error('trace retry')
      },
    },
    {
      body,
      ack: () => acknowledged++,
      retry: () => {
        throw Error('trace retry')
      },
    },
  ], () => ({
    ingest: () => {
      errored++
      return Promise.resolve()
    },
  }), () => {
    reported++
    return Promise.resolve()
  }, (scope, rows) => authority.admitTrace(scope, rows))
  equal([acknowledged, reported, errored], [2, 0, 0])
  await consume([{
    body: [{ entity: { eid: uuid() }, error: {} }],
    ack: () => acknowledged++,
    retry: () => {},
  }], () => ({
    ingest: () => {
      errored++
      return Promise.resolve()
    },
  }), () => {
    reported++
    return Promise.resolve()
  })
  equal(errored, 1)
})

test('budget status is platform-admin only and does not boot a graph', async () => {
  let db = durable(),
    object = new Tracker(state(db, platform), { TRACKER_SECRET: 'scratch' })
  let request = async (scope: string, admin = false) =>
    new Request('https://tracker.test/trace-budget', {
      headers: {
        authorization: 'Bearer ' +
          await sign({
            scope,
            person: space,
            admin,
            exp: Date.now() / 1000 + 60,
          }, 'scratch'),
      },
    })
  equal((await object.fetch(await request(platform))).status, 403)
  equal((await object.fetch(await request(platform, true))).status, 200)
  equal(object.tracker, undefined)
})

test('corrupt durable reservations fail closed without writing or reporting', async () => {
  let db = durable(), authority = new Tracker(state(db, platform))
  await authority.boot()
  let { meta } = await import('@yaks/sqlite')
  let { driver } = await import('@yaks/durable-object')
  meta(driver(db)).set('trace-budget', '{"slots":[{"reserved":-1,"until":0}]}')
  equal((await authority.admitTrace(space, rows(space, 200))).accepted, false)
  equal(authority.traceBudget().reserved, TRACE_CEILING)
})

test('trace authority transport failure retries without generating tracker errors', async () => {
  let retried = 0, reported = 0
  await consume(
    [{
      body: rows(),
      ack: () => {
        throw Error('transport failure acknowledged')
      },
      retry: () => retried++,
    }],
    () => ({ ingest: () => Promise.resolve() }),
    () => {
      reported++
      return Promise.resolve()
    },
    () => Promise.reject(Error('authority unavailable')),
  )
  equal([retried, reported], [1, 0])
})
