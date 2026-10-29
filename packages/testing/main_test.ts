import { cleanup, equal, ok, test } from './mod.ts'
import { one } from './run.ts'

// A test as the runner holds one, its body being `body`.
let declared = (body: () => unknown) =>
  one({ name: 't', body, tags: [], skip: false, file: '' }, 1000)

test('a test closes what it opened, last first, before its time is taken', async () => {
  let closed: string[] = []
  let ran = await declared(async () => {
    cleanup(() => closed.push('opened first'))
    await Promise.resolve()
    cleanup(() => closed.push('opened last'))
  })
  ok(ran.ok)
  equal(closed, ['opened last', 'opened first'])
  let stuck = await declared(() =>
    cleanup(() => {
      throw new Error('would not close')
    })
  )
  equal(stuck.ok, false)
  equal(String(stuck.errors[0]), 'Error: would not close')
})

let releasedBody = () => new Uint8Array(32)
let releasedOutcome = await one({
  name: 'fixture owner',
  body: releasedBody,
  tags: ['memory'],
  skip: false,
  file: 'fixture_test.ts',
}, 100)
test('a completed outcome keeps report metadata without retaining the fixture body', () => {
  equal(releasedOutcome.ok, true)
  equal(releasedOutcome.test, {
    name: 'fixture owner',
    tags: ['memory'],
    skip: false,
    file: 'fixture_test.ts',
  })
  equal(Object.hasOwn(releasedOutcome.test, 'body'), false)
})

test('one reports passing, failing and skipped bodies independently', async () => {
  let ran: string[] = []
  let body = (name: string, fail = false, skip = false) => ({
    name,
    body: () => {
      ran.push(name)
      if (fail) throw new Error(name)
    },
    tags: ['unit'],
    skip,
    file: 'memory_test.ts',
  })
  let passed = await one(body('passed'), 1000)
  let failed = await one(body('failed', true), 1000)
  let skipped = await one(body('skipped', false, true), 1000)
  equal([passed.ok, failed.ok, skipped.ok], [true, false, true])
  equal(skipped.skipped, true)
  equal(ran, ['passed', 'failed'])
  equal(String(failed.errors[0]), 'Error: failed')
})
