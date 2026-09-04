// Builder -> AST, and the parts of the AST that are builder-only: `or`
// composition and the explicit `time` node the text format cannot spell, plus
// the accessors a downstream compiler reads directives off with.

import { assertEquals } from '@std/assert'
import {
  and,
  clauses,
  coerce,
  edges,
  eq,
  field,
  fields,
  gt,
  limit,
  list,
  nearOf,
  or,
  order,
  orderOf,
  parse,
  range,
  scalar,
  time,
  windowOf,
} from './mod.ts'

Deno.test('builders produce plain data', () => {
  assertEquals(eq('status', 'open'), {
    kind: 'pred',
    path: ['status'],
    op: '=',
    value: { kind: 'scalar', raw: 'open' },
  })
  assertEquals(list('a', 'b'), {
    kind: 'list',
    items: [scalar('a'), scalar('b')],
  })
  assertEquals(range(1, 5), {
    kind: 'range',
    lo: scalar('1'),
    hi: scalar('5'),
    exclusiveEnd: false,
  })
})

// A number coerces to a scalar, so a builder reads naturally.
Deno.test('numeric input coerces to a scalar', () => {
  assertEquals(coerce(2), scalar('2'))
  assertEquals(gt('priority', 2), gt('priority', '2'))
})

// A ready value node passes through untouched.
Deno.test('value nodes compose', () => {
  assertEquals(eq('priority', range('1', '5')), {
    kind: 'pred',
    path: ['priority'],
    op: '=',
    value: range('1', '5'),
  })
})

// `or` is builder-only — the text format is a flat AND-list.
Deno.test('or composes', () => {
  assertEquals(or(eq('a', '1'), eq('b', '2')), {
    kind: 'or',
    clauses: [eq('a', '1'), eq('b', '2')],
  })
})

// `time` is an explicit phrase node a builder makes; parse never emits one.
Deno.test('time node is builder-made', () => {
  assertEquals(time('today'), { kind: 'time', raw: 'today' })
  assertEquals(eq('created.at', time('today')), {
    kind: 'pred',
    path: ['created', 'at'],
    op: '=',
    value: { kind: 'time', raw: 'today' },
  })
})

// A field selector from a spec string, `~` marking volatile.
Deno.test('field selector', () => {
  assertEquals(field('pin.x'), { path: ['pin', 'x'], wake: true })
  assertEquals(field('pin.z~'), { path: ['pin', 'z'], wake: false })
  assertEquals(fields('pin.x', 'pin.z~').fields, [
    { path: ['pin', 'x'], wake: true },
    { path: ['pin', 'z'], wake: false },
  ])
})

// Edges builder shapes match the parser's.
Deno.test('edges builder', () => {
  assertEquals(edges(), { kind: 'edges', peers: [] })
  assertEquals(edges({ peers: [['status']] }), {
    kind: 'edges',
    peers: [['status']],
  })
})

// Accessors pick directives out of a clause list.
Deno.test('accessors', () => {
  let ast = parse('.status=open&.order=hot&.near=T-3&.limit=50&.after=900')
  assertEquals(orderOf(ast), 'hot')
  assertEquals(nearOf(ast), 'T-3')
  assertEquals(windowOf(ast), { limit: 50, after: 900 })
  assertEquals(clauses(and(eq('a', '1'))), [eq('a', '1')])
  assertEquals(windowOf(and(limit(10))), { limit: 10 })
  assertEquals(orderOf(and(order('search'))), 'search')
})
