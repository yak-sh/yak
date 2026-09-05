// Self-contained unit tests: @yaks/sql over a TINY inline vocab, no fleet, no
// src/. They pin the public contract the integration builds on — the shape of
// the compiled statement, the derived-column hook, that values are BOUND never
// inlined, and that a gap declines loudly.

import { assert, assertEquals, assertThrows } from '@std/assert'
import { parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import type { VocabDoc } from '@yaks/vocab'
import { compile, type Derived, Unsupported } from './mod.ts'

// The spine, a doc, and a task with a stored priority and a COMPUTED status
// (persist: false) — the smallest vocab that exercises routing, a scalar, and
// the derived hook.
let doc: VocabDoc = {
  $defs: {
    entity: {
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    doc: {
      type: 'object',
      kind: true,
      properties: {
        title: { type: 'string' },
        body: { type: 'string', store: 'blob' },
      },
    },
    task: {
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        priority: { type: 'number', format: 'priority' },
        status: { enum: ['open', 'wip', 'done'], persist: false },
      },
    },
    note: {
      type: 'object',
      properties: {
        about: { type: 'string', ref: 'entity', death: 'cascade' },
        stars: { type: 'number' },
      },
    },
  },
}
let v = loadVocab(doc)

let status: Derived = {
  'task.status': {
    tag: 'enum',
    values: ['open', 'wip', 'done'],
    expr: (owner) => `(case when ${owner} is null then null else 'open' end)`,
  },
}

Deno.test('a scalar predicate binds its value as a param, never inlined', () => {
  let { sql, params } = compile(parse('.priority=1'), v)
  assertEquals(params, [1])
  assert(sql.includes('"task"."priority" = ?'), sql)
})

Deno.test('a text term becomes a bound FTS match', () => {
  let { sql, params } = compile(parse('hello'), v)
  assert(sql.includes('doc_fts match ?'), sql)
  assertEquals(params, ['"hello"'])
})

Deno.test('a contains needle rides as a param', () => {
  let { params } = compile(parse('.title~=hi'), v)
  assert(params.includes('hi'))
})

Deno.test('the derived hook supplies a computed column expression', () => {
  let { sql, params } = compile(parse('.status=open'), v, { derived: status })
  assert(sql.includes('case when'), sql)
  assertEquals(params, ['open'])
})

Deno.test('a computed column with no registration declines loudly', () => {
  assertThrows(
    () => compile(parse('.status=open'), v),
    Unsupported,
  )
})

Deno.test('the .kind scope expands to present-and-earlier-absent', () => {
  // task sorts before doc, so `.kind=doc` is doc present AND task absent.
  let { sql } = compile(parse('.kind=doc'), v)
  assert(sql.includes('"doc"."entity" is not null'), sql)
  assert(sql.includes('"task"."entity" is null'), sql)
})

Deno.test('a reverse hop compiles to a correlated EXISTS', () => {
  let { sql, params } = compile(parse('.notes!'), v)
  assert(
    sql.includes('exists (select 1 from "note" where "note"."about" ='),
    sql,
  )
  assertEquals(params, [])
  assert(compile(parse('.notes='), v).sql.includes('not exists'), 'absence')
})

Deno.test('a reverse cardinality binds its count', () => {
  let { sql, params } = compile(parse('.notes>=5'), v)
  assert(sql.includes('count(*) from "note"'), sql)
  assert(sql.includes(') >= ?'), sql)
  assertEquals(params, [5])
})

Deno.test('a reverse child filter screens the child row', () => {
  let { sql, params } = compile(parse('.notes.stars=5'), v)
  assert(sql.includes('"note"."stars" = ?'), sql)
  assertEquals(params, [5])
  // a child column in another component is LEFT JOINed inside the subquery
  let joinSql = compile(parse('.notes.title~=hi'), v).sql
  assert(
    joinSql.includes(
      'left join "doc_value" as "doc" on "doc"."entity" = ' +
        '"note"."entity"',
    ),
    joinSql,
  )
})

Deno.test('a reverse hop with no count and no child filter declines', () => {
  let e = assertThrows(() => compile(parse('.notes~=lots'), v), Unsupported)
  assertEquals((e as Unsupported).feature, 'a reverse hop')
  // and one reaching for the spine, whose name means the OUTER row down there
  assertThrows(() => compile(parse('.notes.num=3'), v), Unsupported)
})

Deno.test('an unreachable directive throws Unsupported naming the feature', () => {
  let e = assertThrows(
    () => compile(parse('.near=x&.order=similar'), v),
    Unsupported,
  ) as Unsupported
  assertEquals(e.feature, '.near')
})

Deno.test('ordering by an unfiltered column still joins its table', () => {
  let { sql } = compile(parse('.priority=1&.order=title'), v)
  assert(sql.includes('left join "doc_value" as "doc"'), sql)
  // the spine num breaks ties, so the order a query asks for is TOTAL and a
  // page of it is the same page wherever it is cut
  assert(sql.endsWith('order by "doc"."title", "entity"."num" desc'), sql)
})

Deno.test('a window with no .order is newest-first by spine num', () => {
  let { sql, params } = compile(parse('.priority=1&.limit=2&.after=7'), v)
  assert(sql.includes('order by "entity"."num" desc'), sql)
  assert(sql.includes('"entity"."num" < ?'), sql)
  assertEquals(params, [1, 7, 2])
})

Deno.test('an explicit .order survives a window', () => {
  let { sql } = compile(parse('.priority=1&.order=-title&.limit=2'), v)
  assert(
    sql.endsWith('order by "doc"."title" desc, "entity"."num" desc limit ?'),
    sql,
  )
})

Deno.test('.after pages within the asked order, keyed on the anchor', () => {
  let { sql, params } = compile(parse('.order=title&.limit=2&.after=7'), v)
  // the cursor names an ENTITY by its num — the same spelling whatever the
  // order — and the anchor's own value is read back to page past it
  assert(sql.includes('where "__cur"."num" = 7'), sql)
  assert(sql.includes('"doc"."title" > (select'), sql)
  // ties fall to the spine num, and an anchor no entity has is the first page
  assert(sql.includes(`"entity"."num" < ?`), sql)
  assert(sql.includes('not exists (select 1 from "entity" as "__cur"'), sql)
  assertEquals(params, [7, 2])
})

Deno.test('.after over a derived order reads the anchor through the hook', () => {
  let { sql } = compile(parse('.order=status&.after=7'), v, { derived: status })
  // the derived expression is spelled twice: once over the row, once over the
  // anchor's own owner id
  assert(sql.includes(`(case when "task"."entity" is null`), sql)
  assert(
    sql.includes('(case when (select "__cur"."id" from "entity" as "__cur"'),
    sql,
  )
})

Deno.test('the membership statement excludes graves and answers one eid', () => {
  let { sql } = compile(parse('.priority>=1'), v)
  assert(sql.startsWith('select "entity"."eid" as eid from "entity"'), sql)
  assert(sql.includes('not exists (select 1 from tombstone'), sql)
})
