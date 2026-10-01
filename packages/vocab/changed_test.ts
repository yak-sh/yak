import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { changed, same } from './mod.ts'
import type { VocabDoc } from './mod.ts'

test('type unions are unordered and prose and keywords do not retype a word', () => {
  assertEquals(
    same({ type: ['null', 'string'], description: 'old' }, {
      type: ['string', 'null'],
      description: 'new',
      search: true,
    }),
    true,
  )
  assertEquals(same({ type: 'string' }, { type: ['string'] }), true)
  assertEquals(
    same({ type: 'string' }, { type: 'string', format: 'date-time' }),
    false,
  )
  assertEquals(same({ type: 'number' }, { type: 'integer' }), false)
})

test('documents compare definitions and properties without consulting stored rows', () => {
  let was: VocabDoc = {
    $defs: {
      gone: { component: true, type: 'object' },
      call: { tool: true, properties: { arg: { type: 'string' } } },
      row: {
        component: true,
        type: 'object',
        properties: {
          gone: { type: 'string' },
          changed: { type: 'number' },
          formatted: { type: 'string', format: 'date-time' },
          stable: { type: ['null', 'string'], description: 'before' },
        },
      },
      shape: { type: 'string' },
    },
  }
  let next: VocabDoc = {
    $defs: {
      call: { tool: true, properties: { arg: { type: 'number' } } },
      row: {
        component: true,
        type: 'object',
        properties: {
          changed: { type: 'string' },
          formatted: { type: 'string' },
          stable: { type: ['string', 'null'], description: 'after' },
          new: { type: 'boolean' },
        },
      },
      shape: { type: 'object' },
      fresh: { tool: true },
    },
  }
  assertEquals(changed(was, next), {
    dropped: ['gone', 'row.gone'],
    added: [
      'call.arg',
      'row.changed',
      'row.formatted',
      'row.new',
      'shape',
      'fresh',
    ],
    retyped: ['call.arg', 'row.changed', 'row.formatted', 'shape'],
  })
  assertEquals(changed({}, {}), { dropped: [], added: [], retyped: [] })
  assertEquals(changed({ $defs: { call: { tool: true } } }, {}), {
    dropped: ['call'],
    added: [],
    retyped: [],
  })
})
