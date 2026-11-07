// The traversal clauses, compiled through @yaks/sql and answered by SQLite.

import { test } from '@yaks/testing'
import { assert, assertEquals, assertThrows } from '@std/assert'
import { parse } from '@yaks/query'
import { compile, Unsupported } from '@yaks/sql'
import type { Bundle, Storage } from '@yaks/graph'
import { traverse } from './sql.ts'
import { link } from './say.ts'
import { blog, blogGraph, store } from './testing.ts'

let sql = (line: string) =>
  compile(parse(line), blog, { extend: [traverse(blog)] })

// A chain: p1 → p2 → p3 → p4, plus one post citing nothing.
let chain = (): Storage => {
  let s = store()
  let g = blogGraph(s)
  g.apply([
    { entity: { eid: 'p1' }, post: { title: 'One' } },
    { entity: { eid: 'p2' }, post: { title: 'Two' } },
    { entity: { eid: 'p3' }, post: { title: 'Three' } },
    { entity: { eid: 'p4' }, post: { title: 'Four' } },
    { entity: { eid: 'p9' }, post: { title: 'Alone' } },
  ])
  g.apply([
    link('p2', 'cites', 'p1'),
    link('p3', 'cites', 'p2'),
    link('p4', 'cites', 'p3'),
    link('p9', 'links', 'p1'),
  ])
  return s
}

let found = (s: Storage, line: string): string[] =>
  (s.read(line) as Bundle[]).map((b) => b.entity.eid).sort()

test('a walk follows the links, bounded by its cap', () => {
  let s = chain()
  assertEquals(found(s, '.cites[<=1]->p1'), ['p2'])
  assertEquals(found(s, '.cites[<=2]->p1'), ['p2', 'p3'])
  assertEquals(found(s, '.cites[<=9]->p1'), ['p2', 'p3', 'p4'])
  // no bracket: the default cap, deep enough for this chain
  assertEquals(found(s, '.cites->p1'), ['p2', 'p3', 'p4'])
})

test('<- walks the other way: what the target reaches', () => {
  let s = chain()
  assertEquals(found(s, '.cites[<=1]<-p4'), ['p3'])
  assertEquals(found(s, '.cites<-p4'), ['p1', 'p2', 'p3'])
  assertEquals(found(s, '.cites<-p1'), [])
})

test('a walk follows one relation, not every link', () => {
  // p9 links to p1 but does not cite it.
  assert(!found(chain(), '.cites[<=9]->p1').includes('p9'))
  assertEquals(found(chain(), '.linked[<=1]->p1'), ['p9'])
})

test('the target itself is not something it reaches', () => {
  assert(!found(chain(), '.cites[<=9]->p1').includes('p1'))
})

test('a cycle terminates on the depth cap', () => {
  let s = chain()
  blogGraph(s).apply([link('p1', 'cites', 'p4')])
  assertEquals(found(s, '.cites[<=9]->p1'), ['p1', 'p2', 'p3', 'p4'])
})

test('a walk narrows a filter like any other clause', () => {
  assertEquals(found(chain(), '.cites[<=9]->p1 .post.title=Three'), ['p3'])
})

test("a kept release's .edges answers as if absent; a link reads as a row", () => {
  let s = chain()
  for (
    let rider of ['.edges', '.edges[cites]', '.edges[admires,post.title]']
  ) assertEquals(found(s, `.post&${rider}`), found(s, '.post'))
  assertEquals(found(s, '.cites&.edge.to=p1').length, 1)
  assertEquals(found(s, '.post&.edges_to.edge.from=p2'), ['p1'])
})

test('a relation nothing declares is refused, not answered', () => {
  assertThrows(() => sql('.admires[<=2]->p1'), Unsupported)
})

test('the walk seeks the edge table, never scans it', () => {
  let { sql: s, params } = sql('.cites[<=3]->p1')
  assert(s.includes('with recursive'), s)
  assert(s.includes('join "cites" as "t" on "t"."entity" = "l"."entity"'), s)
  assertEquals(params, ['p1', 3])
})
