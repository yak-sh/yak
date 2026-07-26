// The scalar language: each PropType has one stored value and one face.
import { assertEquals, assertThrows } from '@std/assert'
import { formatProp, parseProp, type Prop, propAt } from './props.ts'
import { type PropType } from './types.ts'

let p = (name: string, type: PropType): Prop => ({
  comp: 'test',
  prop: name,
  name,
  type,
})
let parse = (name: string, type: PropType, value: unknown) =>
  parseProp(p(name, type), value, { now: Date.UTC(2026, 6, 15, 14, 30) })

Deno.test('parseProp: text and optional scalar empties stay distinct', () => {
  for (let t of ['text', 'body', 'query', 'url'] as PropType[]) {
    assertEquals(parse('note', t, ''), '')
  }
  assertEquals(parse('domain', { text: 'domains' }, ''), '')
  for (let t of ['number', 'priority', 'bool', 'time'] as PropType[]) {
    assertEquals(parse('value', t, ''), null)
  }
  assertEquals(parse('target_eid', { eid: '', death: 'keep' }, ''), null)
  assertEquals(parse('status', { enum: ['open'] }, null), null)
})

Deno.test('parseProp: numbers and priorities become finite numbers', () => {
  for (
    let [value, want] of [
      ['02', 2],
      ['-2.5', -2.5],
      ['6e3', 6000],
    ] as [unknown, number][]
  ) {
    assertEquals(parse('x', 'number', value), want)
  }
  for (
    let [value, want] of [
      ['P02', 2],
      ['p2', 2],
      ['2', 2],
      ['P1.5', 1.5],
      [1.5, 1.5],
    ] as [unknown, number][]
  ) {
    assertEquals(parse('priority', 'priority', value), want)
  }
  for (let value of ['0x10', 'Infinity', 'P', 'Pnope']) {
    assertThrows(
      () => parse('priority', 'priority', value),
      Error,
      'priority is',
    )
  }
})

Deno.test('parseProp: booleans, enum aliases, and time canonicalize', () => {
  for (
    let [value, want] of [
      ['TRUE', 1],
      ['yes', 1],
      [1, 1],
      ['false', 0],
      ['NO', 0],
      [0, 0],
    ] as [unknown, number][]
  ) {
    assertEquals(parse('ready', 'bool', value), want)
  }
  let status: PropType = {
    enum: ['open', 'cancelled'],
    aliases: { todo: 'open', canceled: 'cancelled' },
  }
  assertEquals(parse('status', status, 'OPEN'), 'open')
  assertEquals(parse('status', status, 'CANCELED'), 'cancelled')
  assertEquals(
    parse('at', 'time', '2026-07-25T09:00:00Z'),
    '2026-07-25T09:00:00.000Z',
  )
  assertEquals(
    parse('at', 'time', 'in 60m'),
    '2026-07-15T15:30:00.000Z',
  )
})

Deno.test('parseProp: references resolve and every rejection teaches', () => {
  let type: PropType = { eid: '', death: 'keep' }
  let id = 'AAAAAAAA-0000-4000-8000-000000000001'
  assertEquals(parseProp(p('target_eid', type), id), id.toLowerCase())
  assertEquals(
    parseProp(p('target_eid', type), 'T-3', { resolve: () => id }),
    id.toLowerCase(),
  )
  assertThrows(
    () => parseProp(p('task.status', { enum: ['open', 'done'] }), 'gone'),
    Error,
    "task.status is one of open, done — got 'gone'",
  )
  assertThrows(
    () => parse('ready', 'bool', 'maybe'),
    Error,
    "ready is a boolean (true, false, 1, 0, yes, no) — got 'maybe'",
  )
  assertThrows(
    () => parseProp(p('target_eid', type), 'missing'),
    Error,
    "target_eid is a human id / alias / UUID — got 'missing'",
  )
})

Deno.test('parseProp: rejected values name the property, grammar, and input', () => {
  let cases: [Prop, unknown, string][] = [
    [p('x', 'number'), '0x10', 'x is a finite decimal number'],
    [p('at', 'time'), 'later', 'at is a time'],
    [p('status', { enum: ['open'] }), '', 'status is one of open'],
    [p('title', 'text'), 3, "title is text — got '3'"],
  ]
  for (let [prop, input, message] of cases) {
    assertThrows(() => parseProp(prop, input), Error, message)
  }
})

Deno.test('formatProp: every semantic type has one face', () => {
  let id = 'aaaaaaaa-0000-4000-8000-000000000001'
  assertEquals(formatProp(p('priority', 'priority'), 'p2'), 'P2')
  assertEquals(formatProp(p('priority', 'priority'), 1.5), 'P1.5')
  assertEquals(formatProp(p('ready', 'bool'), 'YES'), 'true')
  assertEquals(
    formatProp(p('target_eid', { eid: '', death: 'keep' }), id, {
      describe: () => 'T-3 — Ship',
    }),
    'T-3 — Ship',
  )
  assertEquals(formatProp(p('note', 'text'), ''), '')
  assertEquals(formatProp(p('x', 'number'), null), null)
})

Deno.test('propAt: types and unambiguous error names come from schema', () => {
  assertEquals(propAt('task', 'priority'), {
    comp: 'task',
    prop: 'priority',
    name: 'priority',
    type: 'priority',
  })
  assertEquals(propAt('created', 'at')?.name, 'created.at')
  assertEquals(propAt('task', 'missing'), undefined)
})
