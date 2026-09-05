// The edge as a graph plugin: a link states itself, is named by what it says,
// dies with either end, and cannot be half-said.

import { assert, assertEquals, assertThrows } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { isPromise } from '@yaks/graph'
import { edgeEid } from './eid.ts'
import { link, unlink } from './say.ts'
import { blogGraph } from './harness.ts'

let sync = (out: Bundle[] | Promise<Bundle[]>): Bundle[] => {
  assert(!isPromise(out), 'apply() went async over an embedded database')
  return out
}

// Two posts to link together.
let posts = (g: ReturnType<typeof blogGraph>) => {
  sync(g.apply([
    { entity: { eid: 'p1' }, post: { title: 'One' } },
    { entity: { eid: 'p2' }, post: { title: 'Two' } },
  ]))
  return g
}

let read = (g: ReturnType<typeof blogGraph>, q: string) =>
  (g.read(q) as Bundle[]).map((b) => b.entity.eid).sort()

Deno.test('a link states itself and is stored', () => {
  let g = posts(blogGraph())
  sync(g.apply([link('p1', 'cites', 'p2')]))
  assertEquals(read(g, '.cites!'), [edgeEid('p1', 'cites', 'p2')])
  assertEquals(read(g, '.edge.from=p1'), [edgeEid('p1', 'cites', 'p2')])
})

Deno.test('the same link stated twice is one entity', () => {
  let g = posts(blogGraph())
  sync(g.apply([link('p1', 'cites', 'p2')]))
  sync(g.apply([link('p1', 'cites', 'p2', 3)]))
  assertEquals(read(g, '.cites!').length, 1)
})

Deno.test('an aliased link mints at the sentence it states', () => {
  let g = posts(blogGraph())
  let out = sync(g.apply([{
    entity: { eid: '$l' },
    edge: { from: 'p1', to: 'p2' },
    cites: {},
  }]))
  let made = out.find((b) => b.$alias == '$l')!
  assertEquals(made.entity.eid, edgeEid('p1', 'cites', 'p2'))
})

Deno.test('a link to an entity the same batch mints resolves first', () => {
  let g = blogGraph()
  let out = sync(g.apply([
    { entity: { eid: 'p1' }, post: { title: 'One' } },
    { entity: { eid: '$new' }, post: { title: 'Fresh' } },
    { entity: { eid: '$l' }, edge: { from: 'p1', to: '$new' }, cites: {} },
  ]))
  let born = out.find((b) => b.$alias == '$new')!.entity.eid
  let made = out.find((b) => b.$alias == '$l')!
  assertEquals(made.entity.eid, edgeEid('p1', 'cites', born))
})

Deno.test('unlinking drops the sentence and keeps the identity', () => {
  let g = posts(blogGraph())
  sync(g.apply([link('p1', 'cites', 'p2')]))
  sync(g.apply([unlink('p1', 'cites', 'p2')]))
  assertEquals(read(g, '.cites!'), [])
  // and it can be said again — the id was never tombstoned
  sync(g.apply([link('p1', 'cites', 'p2')]))
  assertEquals(read(g, '.cites!'), [edgeEid('p1', 'cites', 'p2')])
})

Deno.test('a link dies with either end', () => {
  let g = posts(blogGraph())
  sync(g.apply([link('p1', 'cites', 'p2'), link('p2', 'links', 'p1')]))
  assertEquals(read(g, '.edge!').length, 2)
  sync(g.apply([{ entity: { eid: 'p2' }, $delete: true }]))
  assertEquals(read(g, '.edge!'), [])
})

Deno.test('an edge with no relation is refused, and says so', () => {
  let g = posts(blogGraph())
  let e = assertThrows(() =>
    sync(g.apply([{
      entity: { eid: '$l' },
      edge: { from: 'p1', to: 'p2' },
      pinned: {},
    }]))
  )
  assert(
    (e as Error).message.includes('states no relation'),
    (e as Error).message,
  )
  // and it names the relations this vocabulary does declare
  assert((e as Error).message.includes('cites, linked'), (e as Error).message)
})

Deno.test('an edge missing an end is refused, naming the end', () => {
  let g = posts(blogGraph())
  let e = assertThrows(() =>
    sync(g.apply([{ entity: { eid: 'x1' }, edge: { from: 'p1' }, cites: {} }]))
  )
  assert((e as Error).message.includes('`to` end'), (e as Error).message)
})

Deno.test('a sentence spread over two bundles is one sentence', () => {
  let g = posts(blogGraph())
  let eid = edgeEid('p1', 'cites', 'p2')
  sync(g.apply([
    { entity: { eid }, edge: { from: 'p1', to: 'p2' } },
    { entity: { eid }, cites: {} },
  ]))
  assertEquals(read(g, '.cites!'), [eid])
})

Deno.test('a patch that states no ends is left alone', () => {
  let g = posts(blogGraph())
  sync(g.apply([link('p1', 'cites', 'p2')]))
  sync(g.apply([{
    entity: { eid: edgeEid('p1', 'cites', 'p2') },
    edge: { ord: 2 },
  }]))
  let [edge] = g.read('.cites!') as Bundle[]
  assertEquals((edge.edge as Record<string, unknown>).ord, 2)
})
