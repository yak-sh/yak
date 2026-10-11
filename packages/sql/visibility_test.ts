import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { preparedDriver, snapshot } from '../sqlite/testing.ts'
import {
  as,
  col,
  derivedOf,
  eq,
  insert,
  select,
  sub,
  table,
  visibleDerived,
} from './mod.ts'

let vocab = loadVocab({
  $defs: {
    public: {
      component: true,
      properties: { value: { type: 'string', computed: true } },
    },
    private: {
      component: true,
      properties: {
        text: { type: 'string' },
        at: { type: 'string', format: 'date-time' },
      },
    },
  },
})
let derived = {
  'public.value': {
    tag: 'text' as const,
    expr: (owner: ReturnType<typeof col>) =>
      sub(select({
        cols: [col('text', 'p')],
        from: table('private', 'p'),
        where: eq(col('entity', 'p'), owner),
      })),
  },
}
let driver = preparedDriver(snapshot(vocab, { derived }))
driver.query(insert('entity', { id: 1, eid: 'one' }))
driver.query(insert('public', { entity: 1 }))
driver.query(insert('private', {
  entity: 1,
  text: 'secret',
  at: '2026-10-11T12:00:00.000Z',
}))
let value = (scope: string, now?: number) => {
  let registry = visibleDerived(vocab, {
    derived,
    visibility: { components: { private: scope } },
    now,
  })
  return driver.query(select({
    cols: [as(registry['public.value'].expr(col('entity', 'public')), 'value')],
    from: table('public'),
  }))[0].value
}
for (let scope of ['.entity.eid=one', '.entity.eid=other']) value(scope)
for (let day of [11, 12]) {
  value('.private.at>=today', Date.UTC(2026, 9, day, 12))
}
for (
  let [name, scope, now, expected] of [
    ['visible', '.entity.eid=one', undefined, 'secret'],
    ['hidden', '.entity.eid=other', undefined, null],
    ['visible again', '.entity.eid=one', undefined, 'secret'],
    ['today', '.private.at>=today', Date.UTC(2026, 9, 11, 12), 'secret'],
    ['tomorrow', '.private.at>=today', Date.UTC(2026, 9, 12, 12), null],
    ['today again', '.private.at>=today', Date.UTC(2026, 9, 11, 12), 'secret'],
  ] as const
) {
  test(`derived sources follow the current permission screen: ${name}`, () =>
    assertEquals(value(scope, now), expected))
}

let auxiliary = loadVocab({
  $defs: {
    public: {
      component: true,
      properties: { value: { type: 'string', computed: true } },
    },
  },
})
let shared = derivedOf(auxiliary, derived)
let scopedValue = (v: typeof vocab) => {
  let registry = visibleDerived(v, {
    derived: shared,
    visibility: { entity: '.entity.eid=other' },
  })
  return driver.query(select({
    cols: [as(registry['public.value'].expr(col('entity', 'public')), 'value')],
    from: table('public'),
  }))[0].value
}
scopedValue(auxiliary)
test('a shared registry leaves auxiliary sources outside graph visibility', () =>
  assertEquals(scopedValue(auxiliary), 'secret'))
test('a shared registry scopes sources declared by this vocabulary', () =>
  assertEquals(scopedValue(vocab), null))
