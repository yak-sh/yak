// The traversal clauses, compiled through @yaks/sql and answered by SQLite.

import { assert, assertEquals, assertThrows } from '@std/assert'
import { parse } from '@yaks/query'
import { compile, Unsupported } from '@yaks/sql'
import type { Bundle, Storage } from '@yaks/graph'
import { traverse } from './sql.ts'
import { link } from './say.ts'
import { blog, blogGraph, store } from './harness.ts'

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

Deno.test('.reaches walks the links, bounded by its cap', () => {
  let s = chain()
  assertEquals(found(s, '.reaches[cites,<=1]=p1'), ['p2'])
  assertEquals(found(s, '.reaches[cites,<=2]=p1'), ['p2', 'p3'])
  assertEquals(found(s, '.reaches[cites,<=9]=p1'), ['p2', 'p3', 'p4'])
})

Deno.test('.reaches walks one relation, not every link', () => {
  // p9 links to p1 but does not cite it.
  assert(!found(chain(), '.reaches[cites,<=9]=p1').includes('p9'))
  assertEquals(found(chain(), '.reaches[linked,<=1]=p1'), ['p9'])
})

Deno.test('the target itself is not something it reaches', () => {
  assert(!found(chain(), '.reaches[cites,<=9]=p1').includes('p1'))
})

Deno.test('a cycle terminates on the depth cap', () => {
  let s = chain()
  blogGraph(s).apply([link('p1', 'cites', 'p4')])
  assertEquals(found(s, '.reaches[cites,<=9]=p1'), ['p1', 'p2', 'p3', 'p4'])
})

Deno.test('.reaches narrows a filter like any other clause', () => {
  assertEquals(
    found(chain(), '.reaches[cites,<=9]=p1&.post.title=Three'),
    ['p3'],
  )
})

Deno.test('.edges rides a query without narrowing it', () => {
  // The rider asks for the links to be delivered, so it must not change which
  // entities the query selects.
  let s = chain()
  assertEquals(found(s, '.post!&.edges!'), found(s, '.post!'))
  assertEquals(sql('.post!&.edges!').sql, sql('.post!').sql)
})

Deno.test('a relation nothing declares is refused, not answered', () => {
  assertThrows(() => sql('.reaches[admires,<=2]=p1'), Unsupported)
  assertThrows(() => sql('.edges[admires]!'), Unsupported)
})

Deno.test('the walk seeks the edge table, never scans it', () => {
  let { sql: s, params } = sql('.reaches[cites,<=3]=p1')
  assert(s.includes('with recursive'), s)
  assert(s.includes('join "cites" t on t.entity = l.entity'), s)
  assertEquals(params, ['p1', 3])
})
