/// <reference lib="deno.ns" />
// A network routes an entity to exactly the queries whose filter it passes:
// every line of the grammar the in-memory evaluator is held to (its parity with
// @yaks/sqlite), held in one network at once, against every entity of the
// fixture.

import { assert, assertEquals } from '@std/assert'
import { filter } from './match.ts'
import { net } from './net.ts'
import { bundles, NOW, QUERIES, shop } from './testing.ts'

let routed = () => {
  let n = net<string>(shop, { now: NOW })
  let held = QUERIES.filter((q) => n.add(q, q))
  return { n, held }
}

Deno.test('a network routes each entity to the queries it matches', () => {
  let { n, held } = routed()
  for (let b of bundles) {
    let want = held.filter((q) => filter(q, shop, { now: NOW })(b, bundles))
    assertEquals(n.route(b).sort(), want.sort(), b.entity.eid)
  }
  // and the agreement is not vacuous: most of the grammar is about one entity
  assert(held.length > QUERIES.length / 2)
})

Deno.test('a question about other entities is left to its caller', () => {
  let n = net<string>(shop)
  for (
    let q of [
      '.book.author.doc.title~=vale',
      '.reviews>=2',
      '.refs=a1',
      '.kind=book&.order=price',
      '.kind=book&.limit=2',
      '.near=b1',
    ]
  ) assertEquals(n.add(q, q), false, q)
  assertEquals(n.add('b', '.kind=book&*'), true)
})

Deno.test('moving an entity says which queries it is in now and which it left', () => {
  let n = net<string>(shop, { now: NOW })
  n.add('cheap', '.price<10', ['b4'])
  n.add('dear', '.price>=10')
  let b4 = bundles.find((b) => b.entity.eid == 'b4')!
  let dearer = { ...b4, book: { ...b4.book as object, price: 20 } }
  assertEquals(n.move(dearer), { into: ['dear'], out: ['cheap'] })
  assertEquals(n.move(dearer), { into: ['dear'], out: [] })
  assertEquals(n.move({ entity: b4.entity, tombstone: {} }), {
    into: [],
    out: ['dear'],
  })
  n.move(b4)
  assertEquals(n.forget('b4'), ['cheap'])
  assertEquals(n.forget('b4'), [])
})

Deno.test('a dropped query is never reached again, and what it shared still works', () => {
  let n = net<string>(shop, { now: NOW })
  n.add('cheap', '.price<10')
  n.add('cheap shelved', '.price<10&.status=shelved')
  let b4 = bundles.find((b) => b.entity.eid == 'b4')!
  assertEquals(n.route(b4).sort(), ['cheap', 'cheap shelved'])
  n.drop('cheap')
  assertEquals(n.route(b4), ['cheap shelved'])
  n.add('cheap shelved', '.price>=10')
  assertEquals(n.route(b4), [])
})
