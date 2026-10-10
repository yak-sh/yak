// A new tracker incarnation drains durable work without replaying its history.
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { equal, ok, test } from '@yaks/testing'
import { options, store, vocab } from './core.ts'

let fixture = async (pending = false) => {
  let storage = ram(vocab, options)
  let seed = graph({ vocab, storage })
  await seed.apply([
    {
      entity: { eid: 'bug' },
      bug: { fault: 'old' },
      ...pending ? {} : { resolved: {} },
    },
    {
      entity: { eid: 'error' },
      error: { bug: 'bug', message: 'Old failure' },
      exception: { type: 'Error', message: 'Old failure' },
    },
    ...pending
      ? [{
        entity: { eid: 'retry' },
        effect: {
          handler: 'bug_notify',
          target: 'bug',
          comp: 'bug',
          kind: 'created',
          state: 'pending',
          attempts: 1,
          next: '9999-01-01T00:00:00Z',
        },
      }]
      : [],
  ], { trusted: true })
  let notified = 0
  let tracker = store(storage, {
    sink: () => {},
    notify: () => void notified++,
  })
  let writes: Bundle[] = [], rows = 0
  let apply = tracker.graph.apply, read = tracker.graph.read
  tracker.graph.apply = async (...args) => {
    writes.push(...args[0])
    return await apply(...args)
  }
  tracker.graph.read = async (...args) => {
    let result = await read(...args)
    rows += result.length
    return result
  }
  return {
    tracker,
    storage,
    writes,
    rows: () => rows,
    notified: () => notified,
  }
}

let idle = await fixture()
let waiting = await fixture(true)
let retrying = await fixture(true)
// Simulate a recorded backoff becoming due before the next incarnation wakes.
retrying.storage.tx((tx) =>
  tx.patch([{
    entity: { eid: 'retry' },
    effect: { next: null },
  }])
)
// A live pass crosses task boundaries; prepare its outcome with the fixture.
let retryError = await retrying.tracker.drain().then(() => undefined, (e) => e)
let dormant = await fixture()
dormant.storage.tx((tx) =>
  tx.patch([{
    entity: { eid: 'unsupported' },
    effect: { handler: 'unloaded', state: 'pending' },
  }])
)

test('tracker restart with settled history reads no targets and writes nothing', async () => {
  idle.writes.length = 0
  let before = idle.rows()
  await idle.tracker.drain()
  equal(idle.writes, [])
  equal(idle.rows() - before, 0)
})

test('tracker idle drain preserves a recorded retry until its backoff is due', async () => {
  waiting.writes.length = 0
  await waiting.tracker.drain()
  equal(waiting.writes, [])
  equal(waiting.notified(), 0)
  let [row] = waiting.storage.get(['retry'])
  equal((row.effect as Comp)?.attempts, 1)
  equal((row.effect as Comp)?.next, '9999-01-01T00:00:00Z')
})

test('tracker restart finishes a due recorded retry without distributed claims', () => {
  equal(retryError, undefined)
  equal(retrying.notified(), 1)
  equal(retrying.storage.read('.effect'), [])
  ok(
    !retrying.writes.some((row) =>
      row.effect &&
      Object.keys(row.effect).some((key) => key.startsWith('lease_'))
    ),
  )
})

test('tracker schedules a supported retry at its backoff and ignores unloaded handlers', async () => {
  equal(await waiting.tracker.next(0), Date.parse('9999-01-01T00:00:00Z'))
  equal(await dormant.tracker.next(0), null)
})
