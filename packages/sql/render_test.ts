import { equal, test } from '@yaks/testing'
import {
  and,
  as,
  col,
  eq,
  exists,
  lit,
  render,
  select,
  table,
  val,
  when,
} from './mod.ts'
import { type Cte, raw } from './ast.ts'
import { deep, DEPTH, depth, inline, LENGTH, VARIABLES } from './render.ts'

test('compiled fragments inline values outside quoted text and names', () => {
  let fragment = render(select({
    cols: [val("can't?"), lit('already?quoted'), col('why?')],
    from: table('table?'),
    where: eq(col('key'), val('value?')),
  }))
  equal(
    inline(fragment),
    `(select 'can''t?', 'already?quoted', "why?" from "table?" where "key" = 'value?')`,
  )
})

test('vacuum binds its destination as a value', () => {
  let into = "/tmp/copy's database.db"
  let { sql, params } = render({ t: 'vacuum', into })
  equal({ sql, params }, { sql: 'vacuum into ?', params: [into] })
  let bare = render({ t: 'vacuum' })
  equal({ sql: bare.sql, params: bare.params }, { sql: 'vacuum', params: [] })
})

test('a table can keep its rows in its primary key, without a rowid', () => {
  let { sql } = render({
    t: 'create table',
    name: 'v',
    cols: [{ name: 'entity' }, { name: 'to' }],
    keys: [{ pk: ['entity', 'to'] }],
    withoutRowid: true,
  })
  equal(
    sql,
    'create table "v" ("entity", "to", primary key ("entity", "to")) without rowid',
  )
})

test('a kept tree renders again around the values bound this time', () => {
  let label = as(
    when([[eq(col('kind'), lit('task')), lit('work')]], lit('other')),
    'label',
  )
  let asked = (v: string) => {
    let { sql, params } = render(
      select({ cols: [label], from: table('t'), where: eq(col('id'), val(v)) }),
    )
    return { sql, params }
  }
  let sql = `select case when "kind" = 'task' then 'work' else 'other' end ` +
    `as "label" from "t" where "id" = ?`
  equal(asked('a'), { sql, params: ['a'] })
  equal(asked('b'), { sql, params: ['b'] })
})

test('a fragment that would bind past the limit is written as literals', () => {
  let { sql, params } = render(
    and(eq(col('a'), val(1)), raw('"b" in (?, ?)', ["it's", 'x?'])),
    2,
  )
  equal({ sql, params }, {
    sql: `("a" = ? and "b" in ('it''s', 'x?'))`,
    params: [1],
  })
})

// A statement whose scopes each hold the shared relation `__v`, built on a
// body `fill` characters long that binds `p`.
let shared = (fill: number, mark = 'x'): Cte => ({
  name: '__v',
  shared: true,
  q: select({
    cols: [as(val('p'), 'id')],
    where: eq(lit(mark.repeat(fill)), lit(mark.repeat(fill))),
  }),
})
let scopes = (ctes: Cte[], top?: Cte[]) =>
  select({
    with: top,
    cols: [
      val('o'),
      ...ctes.map((cte) =>
        exists(select({ with: [cte], cols: [lit(1)], from: table('__v') }))
      ),
    ],
  })
let copies = (sql: string) => sql.match(/"__v"(\([^)]*\))? as/g)?.length ?? 0

test('a statement past the engine’s length writes a shared relation once, at its top, binding in the order it is written', () => {
  let v = shared(15_000)
  let r = render(scopes([v, v, v, v]))
  equal(
    [copies(r.sql), r.sql.startsWith('with "__v" as'), r.sql.length < LENGTH],
    [1, true, true],
  )
  equal(r.params, ['p', 'o'])
})

test('a statement within the engine’s length writes a shared relation where it was built', () => {
  let v = shared(10)
  equal(copies(render(scopes([v, v])).sql), 2)
})

test('two relations under one name stay where they were built', () => {
  let v = shared(15_000)
  equal(copies(render(scopes([v, v, shared(15_000, 'y'), v])).sql), 4)
})

test('a shared relation the top already defines is dropped from the scopes below it', () => {
  let v = shared(15_000)
  let sql = render(scopes([v, v, v], [v])).sql
  equal([copies(sql), sql.length < LENGTH], [1, true])
})

test('two relations naming their columns differently stay where they were built', () => {
  let v = shared(15_000)
  equal(copies(render(scopes([v, v, { ...v, cols: ['other'] }])).sql), 3)
})

test('a statement past the engine’s length in UTF-8 bytes writes a shared relation once', () => {
  let v = shared(9_000, 'é')
  equal(copies(render(scopes([v, v, v])).sql), 1)
})

// A statement naming the relation `seen`, written `not materialized`, as a
// source in two scopes.
let seen: Cte = {
  name: 'seen',
  materialized: false,
  q: select({
    cols: [col('id')],
    from: table('item'),
    where: eq(col('k'), val('a')),
  }),
}
let naming = (ctes: Cte[]) =>
  select({
    with: ctes,
    cols: [col('id', 's')],
    from: table('seen', 's'),
    where: and(
      eq(col('n', 's'), val('b')),
      exists(select({ cols: [lit(1)], from: table('seen') })),
    ),
  })

test('a relation written not materialized is a subquery wherever it is named, each binding its own values in order', () => {
  let r = render(naming([seen]))
  equal({ sql: r.sql, params: r.params }, {
    sql:
      'select "s"."id" from (select "id" from "item" where "k" = ?) as "s" ' +
      'where ("s"."n" = ? and exists (select 1 from ' +
      '(select "id" from "item" where "k" = ?) as "seen"))',
    params: ['a', 'b', 'a'],
  })
})

test('the relations beside one written out stay in the statement’s with', () => {
  let kept: Cte = {
    name: 'kept',
    materialized: true,
    q: select({ cols: [val('m')] }),
  }
  let r = render(naming([kept, seen]))
  equal([
    r.sql.startsWith('with "kept" as materialized (select ?) select'),
    r.params,
  ], [
    true,
    ['m', 'a', 'b', 'a'],
  ])
  equal(render(naming([seen, kept])).params, ['m', 'a', 'b', 'a'])
})

test('a relation one written out names is written out inside it', () => {
  let through: Cte = {
    name: 'through',
    materialized: false,
    q: select({ cols: [col('id')], from: table('seen') }),
  }
  let r = render(
    select({
      with: [seen, through],
      cols: [col('id')],
      from: table('through'),
    }),
  )
  equal({ sql: r.sql, params: r.params }, {
    sql: 'select "id" from (select "id" from ' +
      '(select "id" from "item" where "k" = ?) as "seen") as "through"',
    params: ['a'],
  })
})

test('a copy past the engine’s parameters is written as literals', () => {
  let r = render(naming([seen]), 2)
  equal([r.params, r.sql.endsWith(`where "k" = 'a') as "seen"))`)], [
    ['a', 'b'],
    true,
  ])
})

test('a table’s index hint is left off a relation written out', () => {
  let r = render(select({
    with: [seen],
    cols: [col('id')],
    from: raw('"seen" as "s" not indexed'),
  }))
  equal(
    r.sql,
    'select "id" from (select "id" from "item" where "k" = ?) as "s"',
  )
})

test('a relation that names its columns, or leaves the planner to choose, stays in the with', () => {
  for (
    let cte of [{ ...seen, cols: ['id'] }, { ...seen, materialized: undefined }]
  ) {
    equal(render(naming([cte])).sql.startsWith('with "seen"'), true)
  }
})

test('a statement that would pass the engine’s length keeps its relation in the with', () => {
  let wide: Cte = {
    ...seen,
    q: select({
      cols: [col('id')],
      from: table('item'),
      where: eq(lit('x'.repeat(60_000)), lit('y')),
    }),
  }
  equal(
    render(naming([wide])).sql.startsWith('with "seen" as not materialized'),
    true,
  )
})

// A page read once and named twice, over a screen of `tables` tables.
let paged = (tables: number): Cte => ({
  name: 'page',
  materialized: true,
  q: select({
    cols: [col('id')],
    from: table('item'),
    where: and(
      eq(col('k'), val('a')),
      ...Array.from(
        { length: tables },
        (_, i) => exists(select({ cols: [lit(1)], from: table(`hidden${i}`) })),
      ),
    ),
  }),
})
let twice = (cte: Cte, most?: number) =>
  render(
    select({
      with: [cte],
      cols: [col('id')],
      from: table('page'),
      where: exists(select({ cols: [lit(1)], from: table('page') })),
    }),
    VARIABLES,
    most,
  )

test('a materialized relation stays in the with while the engine counts the statement under its depth', () => {
  let r = twice(paged(20), DEPTH)
  equal([r.sql.startsWith('with "page" as materialized ('), deep(r.sql)], [
    true,
    false,
  ])
  // An engine that counts nothing is written every relation as it was built.
  equal(twice(paged(60)).sql.startsWith('with "page" as materialized ('), true)
})

test('a statement the engine would count past its depth has its relations written where they are named', () => {
  let r = twice(paged(60), DEPTH)
  equal([r.sql.includes('with'), depth(r.sql), r.params], [false, 0, [
    'a',
    'a',
  ]])
  equal(
    r.sql.startsWith(
      'select "id" from (select "id" from "item" where ("k" = ?',
    ),
    true,
  )
})

test('a recursive relation past the depth stays as it was written', () => {
  let sql = 'with recursive "up"("id") as (select 1 union all select "id" ' +
    'from "up" join ' +
    Array.from({ length: 60 }, (_, i) => `"t${i}"`).join(' join ') +
    ') select 1 from "up" where exists (select 1 from "up")'
  equal(render(raw(sql), VARIABLES, DEPTH).sql, sql)
})
