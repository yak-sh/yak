/// <reference lib="deno.ns" />
// Subscriptions over a bookshop: what a subscriber is told when the graph
// moves under it, and — just as much the point — what it is never told.

import { assert, assertEquals } from '@std/assert'
import type { Graph } from '@yaks/graph'
import { comp, shopGraph } from './harness.ts'
import { type Frame, type Sink, subscriptions } from './subs.ts'

// A sink that remembers, and hands over what it has heard since last asked.
let ear = () => {
  let heard: Frame[] = []
  let to: Sink = (f) => {
    heard.push(f)
  }
  return { to, take: () => heard.splice(0, heard.length) }
}

let ids = (f: Frame) => (f.bundles ?? []).map((b) => b.entity.eid)

let shop = (): Graph => shopGraph()

Deno.test('a subscription opens on the set it already selects', () => {
  let graph = shop()
  graph.apply([
    { entity: { eid: 'b1' }, book: { price: 12 } },
    { entity: { eid: 'b2' }, book: { price: 30 } },
  ])
  let subs = subscriptions(graph)
  let { to, take } = ear()
  subs.open(to, 'cheap', '.price<20')
  let [first] = take()
  assertEquals(first.id, 'cheap')
  assertEquals(ids(first), ['b1'])
})

Deno.test('a commit pushes what the query selects, and nothing else', () => {
  let graph = shop()
  let subs = subscriptions(graph)
  let { to, take } = ear()
  subs.open(to, 'cheap', '.price<20')
  take()

  graph.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  let [hit] = take()
  assertEquals(ids(hit), ['b1'])
  assertEquals(comp(hit.bundles![0], 'book').price, 12)

  // an entity the query does not select is never mentioned
  graph.apply([{ entity: { eid: 'b2' }, book: { price: 30 } }])
  assertEquals(take(), [])
})

Deno.test('an entity that stops matching is reported gone', () => {
  let graph = shop()
  graph.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  let subs = subscriptions(graph)
  let { to, take } = ear()
  subs.open(to, 'cheap', '.price<20')
  take()

  graph.apply([{ entity: { eid: 'b1' }, book: { price: 99 } }])
  let [left] = take()
  assertEquals(left.gone, ['b1'])
  assertEquals(ids(left), [])
})

Deno.test('a deleted member is reported gone', () => {
  let graph = shop()
  graph.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  let subs = subscriptions(graph)
  let { to, take } = ear()
  subs.open(to, 'cheap', '.price<20')
  take()

  graph.apply([{ entity: { eid: 'b1' }, $delete: true }])
  assertEquals(take()[0].gone, ['b1'])
})

Deno.test('the raw feed carries the batch exactly as it was applied', () => {
  let graph = shop()
  let subs = subscriptions(graph)
  let { to, take } = ear()
  subs.open(to, 'all', true)
  assertEquals(take(), []) // a raw feed has no opening set

  graph.apply([{ entity: { eid: 'b1' }, doc: { title: 'Spring' } }])
  let [batch] = take()
  assertEquals(batch.id, 'all')
  assertEquals(comp(batch.bundles![0], 'doc'), { title: 'Spring' })
  assert(batch.bundles!.some((b) => comp(b, 'created').at != null))
})

Deno.test('a windowed query re-reads its whole answer', () => {
  let graph = shop()
  graph.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  let subs = subscriptions(graph)
  let { to, take } = ear()
  // `.limit` pages newest-first, so this set can change when an entity the
  // batch never named moves — the fallback path, not the per-bundle test.
  subs.open(to, 'newest', '.price<20&.limit=1')
  assertEquals(ids(take()[0]), ['b1'])

  graph.apply([{ entity: { eid: 'b2' }, book: { price: 10 } }])
  let [moved] = take()
  assertEquals(ids(moved), ['b2'])
  assertEquals(moved.gone, ['b1'])
})

Deno.test('a query the graph cannot answer is refused, not held', () => {
  let graph = shop()
  let subs = subscriptions(graph)
  let { to, take } = ear()
  subs.open(to, 'bad', '.colour=red')
  let [said] = take()
  assertEquals(said.id, 'bad')
  assert(said.refused)
  assert(said.bundles == null)

  graph.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  assertEquals(take(), [])
})

Deno.test('closing and dropping stop the pushes', () => {
  let graph = shop()
  let subs = subscriptions(graph)
  let one = ear()
  let two = ear()
  subs.open(one.to, 'cheap', '.price<20')
  subs.open(two.to, 'cheap', '.price<20')
  one.take()
  two.take()

  subs.close(one.to, 'cheap')
  graph.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  assertEquals(one.take(), [])
  assertEquals(ids(two.take()[0]), ['b1'])

  subs.drop(two.to)
  graph.apply([{ entity: { eid: 'b2' }, book: { price: 9 } }])
  assertEquals(two.take(), [])
})
