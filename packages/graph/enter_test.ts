// A waiting writer retries entry, never a transaction body or an uncertain
// commit. The pause is controlled so the checks need no clock delay.

import { equal, test } from '@yaks/testing'
import { assertRejects, assertThrows } from '@std/assert'
import { enter } from './enter.ts'

let busy = Object.assign(new Error('database is locked'), { retryable: true })
let pause = () => Promise.resolve()

test('a refused entry waits and runs the body only once', async () => {
  let entries = 0
  let bodies = 0
  let waits = 0
  let out = await enter((begun) => {
    if (++entries < 3) throw busy
    begun()
    return ++bodies
  }, () => {
    waits++
    return Promise.resolve()
  })
  equal([out, entries, bodies, waits], [1, 3, 1, 2])
})

test('an async refused entry can recover before its body starts', async () => {
  let entries = 0
  equal(
    await enter(async (begun) => {
      await Promise.resolve()
      if (++entries == 1) throw busy
      begun()
      return 42
    }, pause),
    42,
  )
})

test('an entered body is never repeated even if it throws a retryable error', () => {
  let bodies = 0
  assertThrows(() =>
    enter((begun) => {
      begun()
      bodies++
      throw busy
    }, pause)
  )
  equal(bodies, 1)
})

test('an async entered body is never repeated', async () => {
  let bodies = 0
  await assertRejects(async () =>
    await enter(async (begun) => {
      await Promise.resolve()
      begun()
      bodies++
      throw busy
    }, pause)
  )
  equal(bodies, 1)
})

test('an uncertain failure is not retried', () => {
  let entries = 0
  assertThrows(() =>
    enter(() => {
      entries++
      throw new Error('commit failed')
    }, pause)
  )
  equal(entries, 1)
})

test('a permanently held lock stops retrying', async () => {
  let entries = 0
  await assertRejects(async () =>
    await enter(() => {
      entries++
      throw busy
    }, pause)
  )
  equal(entries, 4)
})

test('an uncontended synchronous write stays synchronous', () => {
  equal(
    enter((begun) => {
      begun()
      return 42
    }),
    42,
  )
})
