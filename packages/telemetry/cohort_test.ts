// The fingerprint ignores the message and the line numbers; it keeps the
// class, the door, and the frames.

import { assertEquals, assertNotEquals } from '@std/assert'
import { fingerprint, type Log } from './cohort.ts'

let row = (over: Partial<Log>): Log => ({
  ts: '',
  source: 'web',
  name: 'render',
  session_id: null,
  ok: 0,
  ms: null,
  error: null,
  detail: null,
  ...over,
})

Deno.test('same class and frames, different message and lines: one key', () => {
  let a = row({ error: 'TypeError: user 1', detail: 'at f (a.ts:1:2)' })
  let b = row({ error: 'TypeError: user 2', detail: 'at f (a.ts:9:9)' })
  assertEquals(fingerprint(a), fingerprint(b))
})

Deno.test('a different class or door is a different key', () => {
  let a = row({ error: 'TypeError: x', detail: 'at f (a.ts)' })
  assertNotEquals(fingerprint(a), fingerprint({ ...a, error: 'RangeError: x' }))
  assertNotEquals(fingerprint(a), fingerprint({ ...a, source: 'mcp' }))
})

Deno.test('with no class and no frames, the first message line is the key', () => {
  assertEquals(
    fingerprint(row({ error: 'plain\nmore' })),
    fingerprint(row({ error: 'plain\nother' })),
  )
})
