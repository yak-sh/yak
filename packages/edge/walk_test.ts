// Following links over a storage: out, in, and a bounded reach.

import { assert, assertEquals, assertThrows } from '@std/assert'
import type { Eid, Storage } from '@yaks/graph'
import { isPromise } from '@yaks/graph'
import { link } from './say.ts'
import { walk } from './walk.ts'
import { blog, blogGraph, store } from './harness.ts'

// p2 → p1, p3 → p2, p4 → p3 (each cites the one before), and p9 → p1 links.
let chain = (): Storage => {
  let s = store()
  let g = blogGraph(s)
  g.apply(['p1', 'p2', 'p3', 'p4', 'p9'].map((eid) => ({
    entity: { eid },
    post: { title: eid },
  })))
  g.apply([
    link('p2', 'cites', 'p1'),
    link('p3', 'cites', 'p2'),
    link('p4', 'cites', 'p3'),
    link('p9', 'links', 'p1'),
  ])
  return s
}

let now = (v: Eid[] | Promise<Eid[]>): Eid[] => {
  assert(!isPromise(v), 'the walk went async over an embedded database')
  return v.sort()
}

Deno.test('out follows the link away, in follows it back', () => {
  let w = walk(chain(), blog)
  assertEquals(now(w.out('p2', 'cites')), ['p1'])
  assertEquals(now(w.in('p1', 'cites')), ['p2'])
  assertEquals(now(w.out('p1', 'cites')), [])
})

Deno.test('a walk follows one relation only', () => {
  let w = walk(chain(), blog)
  assertEquals(now(w.in('p1', 'linked')), ['p9'])
  assert(!now(w.in('p1', 'cites')).includes('p9'))
})

Deno.test('reach is bounded, and does not answer with where it started', () => {
  let w = walk(chain(), blog)
  assertEquals(now(w.reach('p4', 'cites', 1)), ['p3'])
  assertEquals(now(w.reach('p4', 'cites', 2)), ['p2', 'p3'])
  assertEquals(now(w.reach('p4', 'cites', 9)), ['p1', 'p2', 'p3'])
  assertEquals(now(w.reach('p1', 'cites', 9)), [])
})

Deno.test('reach walks either way', () => {
  let w = walk(chain(), blog)
  assertEquals(now(w.reach('p1', 'cites', 9, 'in')), ['p2', 'p3', 'p4'])
})

Deno.test('a cycle ends the walk rather than spinning', () => {
  // p1 cites p4, closing the ring — so p4 reaches itself, and the walk still
  // stops. This is the answer `.reaches[cites,<=9]=p1` gives too (sql_test).
  let s = chain()
  blogGraph(s).apply([link('p1', 'cites', 'p4')])
  assertEquals(now(walk(s, blog).reach('p4', 'cites', 99)), [
    'p1',
    'p2',
    'p3',
    'p4',
  ])
})

Deno.test('the walk and .reaches answer the same question', () => {
  // Two evaluators of one idea: this one reads bundles a hop at a time, the
  // other compiles a recursive CTE. They must not disagree.
  let s = chain()
  let w = walk(s, blog)
  for (let depth of [1, 2, 9]) {
    assertEquals(
      now(w.reach('p1', 'cites', depth, 'in')),
      (s.read(`.reaches[cites,<=${depth}]=p1`) as { entity: { eid: Eid } }[])
        .map((b) => b.entity.eid).sort(),
      `depth ${depth}`,
    )
  }
})

Deno.test('a relation the vocabulary does not declare is refused', () => {
  let e = assertThrows(() => walk(chain(), blog).out('p1', 'admires'))
  assert(
    (e as Error).message.includes('no such relation'),
    (e as Error).message,
  )
})
