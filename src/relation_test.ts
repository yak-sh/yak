// The relation layer on its own: what the combinators put in the value, what
// the value renders to, and the two properties that make it worth being a value
// at all — nothing mutates, and it survives a round trip through JSON.
import { assertEquals } from '@std/assert'
import {
  also,
  distinct,
  from,
  group,
  joined,
  order,
  outer,
  project,
  take,
  toSql,
  where,
} from './relation.ts'

Deno.test('a bare relation selects everything alive over nothing', () => {
  assertEquals(toSql(from('"entity"')), {
    sql: 'select * from "entity" where 1',
    params: [],
  })
})

// The clauses come out in the order SQL demands however the steps were piped,
// and the binds in the order SQLite consumes them: conditions first, in the
// order they were added, then the bound.
Deno.test('toSql renders clauses in SQL order and binds in bind order', () => {
  let rel = from(
    '"entity"',
    project('"entity"."eid" as eid'),
    outer('"task"', '"task"."entity" = "entity"."id"'),
    where({ sql: '"task"."domain" = ?', params: ['Eng'] }),
    where({ sql: '"entity"."num" < ?', params: [42] }),
    order('"entity"."num" desc'),
    take(10),
  )
  assertEquals(toSql(rel), {
    sql: 'select "entity"."eid" as eid from "entity"' +
      ' left join "task" on "task"."entity" = "entity"."id"' +
      ' where "task"."domain" = ? and "entity"."num" < ?' +
      ' order by "entity"."num" desc limit ?',
    params: ['Eng', 42, 10],
  })
})

Deno.test('distinct and group ride the same value', () => {
  assertEquals(
    toSql(from('"entity"', distinct(), project('"d"."title" as value'))).sql,
    'select distinct "d"."title" as value from "entity" where 1',
  )
  assertEquals(
    toSql(from('"entity"', project('value', 'count(*) as n'), group('value')))
      .sql,
    'select value, count(*) as n from "entity" where 1 group by value',
  )
})

// A caller that may or may not have a clause needs no branch.
Deno.test('a nil condition and a nil bound are no clauses at all', () => {
  let rel = from('"entity"', where(null), where(undefined), take(null))
  assertEquals(toSql(rel), {
    sql: 'select * from "entity" where 1',
    params: [],
  })
})

// The whole reason `windowed` can add clauses to a finished selection: steps
// build a NEW relation, so nothing that already holds one can be changed under
// it.
Deno.test('also extends without touching the relation it extends', () => {
  let base = from('"entity"', project('eid'), where({ sql: '1=1', params: [] }))
  let more = also(base, order('"entity"."num" desc'), take(5))
  assertEquals(base.sort, [])
  assertEquals(base.bound, null)
  assertEquals(more.sort, ['"entity"."num" desc'])
  assertEquals(toSql(base).sql, 'select eid from "entity" where 1=1')
})

// It is data: printable in a test, diffable, and rewritable by a later pass.
Deno.test('a relation survives a round trip through JSON', () => {
  let rel = from(
    '"entity"',
    project('eid'),
    outer('"doc_value" as "doc"', '"doc"."entity" = "entity"."id"'),
    where({ sql: '"doc"."title" = ?', params: ['x'] }),
    take(3),
  )
  assertEquals(JSON.parse(JSON.stringify(rel)), rel)
})

Deno.test('joined renders the joins a hand-written statement splices in', () => {
  assertEquals(joined([]), '')
  assertEquals(
    joined([{ source: '"task"', on: '"task"."entity" = "entity"."id"' }]),
    ' left join "task" on "task"."entity" = "entity"."id"',
  )
})
