// An edge is named by the sentence it states.

import { assert, assertEquals, assertNotEquals } from '@std/assert'
import { derive, edgeEid, tagOf } from './eid.ts'
import { link } from './say.ts'

let UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

Deno.test('a sentence names one id, every time', () => {
  assertEquals(edgeEid('p1', 'cites', 'p2'), edgeEid('p1', 'cites', 'p2'))
  assert(UUID.test(edgeEid('p1', 'cites', 'p2')), edgeEid('p1', 'cites', 'p2'))
})

Deno.test('the id is a uuid nothing else can mint', () => {
  // version nibble 8 (a derived id), variant bits stamped: it passes every uuid
  // door and can never collide with a random v4.
  let eid = edgeEid('a-very-long-eid', 'cites', 'another')
  assertEquals(eid[14], '8')
  assert('89ab'.includes(eid[19]), eid)
})

Deno.test('direction and relation are part of the sentence', () => {
  assertNotEquals(edgeEid('p1', 'cites', 'p2'), edgeEid('p2', 'cites', 'p1'))
  assertNotEquals(edgeEid('p1', 'cites', 'p2'), edgeEid('p1', 'links', 'p2'))
})

Deno.test('the derivation is fixed — a stored id stays findable', () => {
  // A frozen expectation on purpose: this hash is written into stored data, so
  // changing it silently would orphan every edge already saved.
  assertEquals(
    edgeEid('p1', 'cites', 'p2'),
    'aaa46dc2-227c-86b4-8886-5810f90db37a',
  )
})

let tags = { cites: 'cites', links: 'linked' }

Deno.test('the tag is the relation the bundle wears, not a passing component', () => {
  let b = { ...link('p1', 'cites', 'p2'), pinned: {} }
  assertEquals(tagOf(b, tags), 'cites')
  assertEquals(tagOf({ entity: { eid: 'p1' }, pinned: {} }, tags), undefined)
})

Deno.test('an edge bundle derives its own id', () => {
  let name = derive(tags)
  let b = link('p1', 'links', 'p2')
  assertEquals(name(b.edge as Record<string, unknown>, b), b.entity.eid)
  assertEquals(b.entity.eid, edgeEid('p1', 'links', 'p2'))
})

Deno.test('an incomplete sentence derives nothing', () => {
  let name = derive(tags)
  // no relation
  assertEquals(name({ from: 'p1', to: 'p2' }, { entity: { eid: '$e' } }), '')
  // no far end
  assertEquals(
    name({ from: 'p1' }, { entity: { eid: '$e' }, cites: {} }),
    '',
  )
})
