// Sync pass-through, pinned: a pipeline of synchronous steps must stay
// synchronous (no promise anywhere in the result), and one asynchronous step
// must carry the rest of the run with it.

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { each, isPromise, over, then } from './pipe.ts'

test('then passes a plain value straight through', () => {
  let out = then(2, (n) => n + 1)
  assert(!isPromise(out))
  assertEquals(out, 3)
})

test('then awaits a promise', async () => {
  assertEquals(await then(Promise.resolve(2), (n) => n + 1), 3)
})

test('each folds synchronously while every step is synchronous', () => {
  let out = each([1, 2, 3], 0, (acc, n) => acc + n)
  assert(!isPromise(out))
  assertEquals(out, 6)
})

test('one async step makes the rest of the fold a promise, in order', async () => {
  let seen: number[] = []
  let out = each([1, 2, 3], 0, (acc, n) => {
    seen.push(n)
    return n == 2 ? Promise.resolve(acc + n) : acc + n
  })
  assert(isPromise(out))
  assertEquals(await out, 6)
  assertEquals(seen, [1, 2, 3])
})

test('over runs for effect, in order, sync staying sync', () => {
  let seen: string[] = []
  let out = over(['a', 'b'], (s) => seen.push(s))
  assert(!isPromise(out))
  assertEquals(seen, ['a', 'b'])
})
