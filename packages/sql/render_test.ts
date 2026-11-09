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
import { inline, LENGTH } from './render.ts'

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
