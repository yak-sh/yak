/// <reference lib="deno.ns" />
// The value rules, one operator at a time: what each spelling selects, and
// where a question is refused rather than guessed at.

import { assert, assertEquals, assertFalse } from '@std/assert'
import type { Tag } from '@yaks/sql'
import { check } from './value.ts'

let NOW = Date.parse('2024-06-15T12:00:00.000Z')
let ago = (ms: number) => new Date(NOW - ms).toISOString()

// Does `.<col> <op> <value>` select a column holding `v`?
let hit = (op: string, value: string, tag: Tag, v: unknown): boolean => {
  let c = check(op, value, tag, NOW)
  assert(c, `${op} ${value} (${tag}) should be answerable`)
  return c(v)
}

Deno.test('equality reads text, numbers, lists and ranges', () => {
  assert(hit('', 'open', 'enum', 'open'))
  assertFalse(hit('', 'open', 'enum', 'done'))
  assert(hit('', '12', 'number', 12))
  assertFalse(hit('', '12.0', 'number', 12)) // no round trip, so no match
  assert(hit('', 'a,b', 'text', 'b'))
  assert(hit('', '1..5', 'number', 5))
  assertFalse(hit('', '1...5', 'number', 5)) // an exclusive end
  assert(hit('', '1', 'bool', 1))
})

Deno.test('an empty operand asks for an absent column', () => {
  assert(hit('', '', 'text', null))
  assert(hit('', '', 'text', ''))
  assertFalse(hit('', '', 'text', 'x'))
})

Deno.test('not-equals counts an absent column as different', () => {
  assert(hit('!', 'open', 'enum', null))
  assert(hit('!', 'open', 'enum', 'done'))
  assertFalse(hit('!', 'open', 'enum', 'open'))
})

Deno.test('contains is case-insensitive, and empty means present', () => {
  assert(hit('~', 'SPRING', 'text', 'the spring catalogue'))
  assertFalse(hit('~', 'spring', 'text', null))
  assert(hit('~', '', 'text', 'anything'))
  assertFalse(hit('~', '', 'text', null))
})

Deno.test('an absent column never compares true', () => {
  assert(hit('>=', '10', 'number', 10))
  assertFalse(hit('>=', '10', 'number', null))
  assert(hit('<', 'm', 'text', 'alpha'))
})

Deno.test('presence asks only whether the column has a value', () => {
  assert(hit('exists', '', 'text', ''))
  assertFalse(hit('exists', '', 'text', null))
})

Deno.test('a time phrase names a span and the operator picks its edge', () => {
  let mins = 60_000
  assert(hit('', '1 hour ago', 'time', ago(30 * mins)))
  assertFalse(hit('', '1 hour ago', 'time', ago(90 * mins)))
  assert(hit('<', '1 hour ago', 'time', ago(90 * mins)))
  assert(hit('>=', '1 hour ago', 'time', ago(30 * mins)))
  assert(hit('!', '1 hour ago', 'time', ago(90 * mins)))
  // a value that is no stamp at all answers no time question
  assertFalse(hit('', '1 hour ago', 'time', 'someday'))
  // and an operand that is no phrase falls back to the plain rules
  assert(hit('', 'someday', 'time', 'someday'))
})

Deno.test('a question the column cannot answer is refused, not guessed', () => {
  assertEquals(check('>=', 'cheap', 'number', NOW), null)
  assertEquals(check('<', '10', 'text', NOW), null)
  assertEquals(check('nonsense', 'x', 'text', NOW), null)
  // an operand no number can equal is a constant false, which IS exact
  assertFalse(hit('', 'cheap', 'number', 3))
})
