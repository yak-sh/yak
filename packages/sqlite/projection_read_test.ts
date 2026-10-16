// A component gather may resolve the stored column already in its row, but
// dynamic, computed and graph-dependent expressions still read their owner.
import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import {
  col,
  type Derived,
  fn,
  insert,
  select,
  sub,
  table,
  val,
} from '@yaks/sql'
import { loadVocab } from '@yaks/vocab'
import { get } from './read.ts'
import { preparedDriver, snapshot } from './testing.ts'

let vocab = loadVocab({
  $defs: {
    word: {
      component: true,
      properties: {
        plain: { type: 'string' },
        dynamic: { type: 'string' },
        related: { type: 'string' },
        calculated: { type: 'string', computed: true },
      },
    },
    other: { component: true, properties: { value: { type: 'string' } } },
  },
})
let options: { derived: Derived } = {
  derived: {
    'word.plain': {
      tag: 'text',
      stable: true,
      expr: () => val('HELLO'),
      text: (stored) => fn('upper', stored),
    },
    'word.dynamic': {
      tag: 'text',
      expr: () => val('current clock'),
      text: () => val('stored clock'),
    },
    'word.related': {
      tag: 'text',
      stable: true,
      expr: () => val('owner relation'),
      text: () => sub(select({ cols: [col('value')], from: table('other') })),
    },
    'word.calculated': {
      tag: 'text',
      stable: true,
      expr: () => val('computed value'),
      text: () => val('stored value'),
    },
  },
}
let sql = preparedDriver(
  snapshot(vocab, options, [
    insert('entity', { id: 1, eid: 'one' }),
    insert('word', {
      entity: 1,
      plain: 'hello',
      dynamic: 'held clock',
      related: 'held relation',
    }),
    insert('other', { entity: 1, value: 'stored relation' }),
  ]),
)

test('gathers preserve owner expressions outside stable stored text', () => {
  assertEquals(get(sql, vocab, ['one'], options)[0].word, {
    plain: 'HELLO',
    dynamic: 'current clock',
    related: 'owner relation',
    calculated: 'computed value',
  })
})
