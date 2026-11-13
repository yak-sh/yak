/// <reference lib="deno.ns" />
// An object's async key-value calls count against its ceiling, a key a row,
// and a stopped object refuses them as it refuses statements.

import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { keys } from './keys.ts'
import { bounded, Stopped } from './ceiling.ts'
import { durable } from './testing.ts'

// Storage whose ceiling allows `written` rows a minute, read and written
// counted as they are spent.
let kept = (written = 100) => {
  let storage = durable()
  let ceiling = bounded(storage, {
    windows: [{ ms: 60_000, read: 100, written }],
    now: () => 0,
    refuse: true,
    report: () => {},
  })
  let spent = () => {
    let [{ read, written }] = ceiling.spent()
    return [read, written]
  }
  return { kv: keys(storage), spent }
}

test('a key read is a row read, a key put or deleted a row written, and a list its keys', async () => {
  let { kv, spent } = kept()
  await kv.put('a:1', 1)
  await kv.put('a:2', 2)
  await kv.put('b', 3)
  assertEquals(await kv.get('a:1'), 1)
  assertEquals([...(await kv.list({ prefix: 'a:' })).keys()], ['a:1', 'a:2'])
  assertEquals(await kv.delete('b'), true)
  assertEquals(spent(), [3, 4])
})

test('a stopped object refuses a write, and still reads until its read rows are spent', async () => {
  let { kv, spent } = kept(1)
  await kv.put('a', 1)
  await kv.put('b', 2)
  await assertRejects(() => kv.put('c', 3), Stopped)
  assertEquals([await kv.get('a'), spent()], [1, [1, 2]])
})
