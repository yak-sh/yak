import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { preparedDriver, snapshot, textual } from '../sqlite/testing.ts'
import {
  as,
  col,
  derivedOf,
  desc,
  eq,
  fn,
  from,
  insert,
  join,
  lit,
  or,
  render,
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

test('a shared source still screens each probe whose owner can differ', () => {
  driver.query(insert('entity', { id: 2, eid: 'two' }))
  driver.query(insert('private', { entity: 2, text: 'hidden' }))
  let p = table('private', 'p')
  let correlated = eq(col('entity', 'p'), col('entity', 'anchor'))
  let different = eq(col('entity', 'p'), lit(2))
  let probe = (where: typeof correlated) =>
    sub(select({
      cols: [col('text', 'p')],
      from: p,
      where,
      order: [desc(col('entity', 'p'))],
      limit: lit(1),
    }))
  let scoped = visibleDerived(vocab, {
    derived: {
      'public.value': {
        tag: 'text',
        expr: (owner) =>
          sub(select({
            cols: [fn(
              'json_array',
              probe(correlated),
              probe(different),
              probe(or(correlated, different)),
            )],
            from: table('private', 'anchor'),
            where: eq(col('entity', 'anchor'), owner),
          })),
      },
    },
    visibility: { entity: '.private.text=secret' },
  })['public.value']
  let got = driver.query(select({
    cols: [as(scoped.expr(col('entity', 'public')), 'value')],
    from: table('public'),
  }))[0].value
  assertEquals(JSON.parse(String(got)), ['secret', null, 'secret'])
})

test('a peer read through a subquery is screened by the rows the subquery reads', () => {
  driver.query(insert('entity', { id: 3, eid: 'three' }))
  driver.query(insert('private', { entity: 3, text: 'hidden too' }))
  // The peer joins a subquery's entity: the subquery's own rows decide what
  // it may see, so a row the scope hides finds no peer.
  let through = (id: number) =>
    sub(select({
      cols: [col('text', 'peer')],
      from: from(
        select({
          cols: [col('entity', 'x')],
          from: table('private', 'x'),
          where: eq(col('entity', 'x'), lit(id)),
        }),
        's',
      ),
      joins: [join(
        table('private', 'peer'),
        eq(col('entity', 'peer'), col('entity', 's')),
      )],
    }))
  let scoped = visibleDerived(vocab, {
    derived: {
      'public.value': {
        tag: 'text',
        expr: () => fn('json_array', through(1), through(3)),
      },
    },
    visibility: { entity: '.private.text=secret' },
  })['public.value']
  let got = driver.query(select({
    cols: [as(scoped.expr(col('entity', 'public')), 'value')],
    from: table('public'),
  }))[0].value
  assertEquals(JSON.parse(String(got)), ['secret', null])
})

// Several probes of the same protected relation must fit the engine's statement
// allowance without exposing a row its component permission hides.
let wide = textual({ sqlLength: 100_000 }, snapshot(vocab, { derived }))
let exec = (stmt: Parameters<typeof render>[0]) => {
  let { sql, params } = render(stmt)
  return wide.run(sql, params)
}
let prose = 'visible'.repeat(8_000)
exec(insert('entity', { id: 1, eid: 'one' }))
exec(insert('public', { entity: 1 }))
exec(insert('private', { entity: 1, text: prose }))
let repeated = {
  'public.value': {
    ...derived['public.value'],
    expr: (owner: ReturnType<typeof col>) =>
      fn(
        'coalesce',
        ...Array.from(
          { length: 30 },
          () => derived['public.value'].expr(owner),
        ),
      ),
  },
}
let guardedValue = (text: string, entire = false) => {
  let scope = `.private.text="${text}"`
  let except = Array.from(
    { length: 120 },
    (_, i) => `.private.text!="hidden-${i}"`,
  ).join(' ')
  let registry = visibleDerived(vocab, {
    derived: repeated,
    visibility: entire
      ? { entity: `${scope} ${except}` }
      : { components: { private: scope } },
  })
  return exec(select({
    cols: [as(registry['public.value'].expr(col('entity', 'public')), 'value')],
    from: table('public'),
  }))[0].value
}
guardedValue(prose)
guardedValue(prose + 'hidden')
test('repeated derived probes share their permission screen within SQL limits', () => {
  assertEquals(guardedValue(prose), prose)
  assertEquals(guardedValue(prose + 'hidden'), null)
})

test('repeated derived probes share an owner-keyed entity screen within SQL limits', () => {
  assertEquals(guardedValue(prose, true), prose)
  assertEquals(guardedValue(prose + 'hidden', true), null)
})

let projected = (text: string) => {
  let scoped = visibleDerived(vocab, {
    derived,
    visibility: { components: { private: `.private.text="${text}"` } },
  })['public.value']
  let owner = col('entity', 'public')
  return exec(select({
    cols: ['first', 'second'].map((name) => as(scoped.expr(owner), name)),
    from: table('public'),
  }))[0]
}

test('multiple derived values fit the statement limit with a large permission value', () => {
  assertEquals(projected(prose), { first: prose, second: prose })
  assertEquals(projected(prose + 'hidden'), { first: null, second: null })
})
