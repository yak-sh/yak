// The rules facet: the clauses a host that composes this package compiles
// without wiring the traversal up itself.

import { assertEquals, assertThrows } from '@std/assert'
import { parse } from '@yaks/query'
import { compile, type Extension, Unsupported } from '@yaks/sql'
import { extend } from './rules.ts'
import { blog } from './harness.ts'

let sql = (line: string, ext: Extension[] = extend({ vocab: blog })) =>
  compile(parse(line), blog, { extend: ext }).sql

Deno.test('a host composing the package compiles .edges! and a relation walk', () => {
  assertEquals(sql('.post!&.edges!'), sql('.post!'))
  assertEquals(sql('.cites[<=3]->p1').includes('with recursive'), true)
  assertThrows(() => sql('.post!&.edges!', []), Unsupported)
  assertThrows(() => sql('.cites[<=3]->p1', []), Unsupported)
})
