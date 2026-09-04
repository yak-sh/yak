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

Deno.test('an unreachable directive throws Unsupported naming the feature', () => {
  let e = assertThrows(
    () => compile(parse('.near=x&.order=similar'), v),
    Unsupported,
  ) as Unsupported
  assertEquals(e.feature, '.near')
})

Deno.test('the membership statement excludes graves and answers one eid', () => {
  let { sql } = compile(parse('.priority>=1'), v)
  assert(sql.startsWith('select "entity"."eid" as eid from "entity"'), sql)
  assert(sql.includes('not exists (select 1 from tombstone'), sql)
})
