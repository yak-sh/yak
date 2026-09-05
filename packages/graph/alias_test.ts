// Aliases: the batch names an entity, the graph names the id. These hold the
// two ways an id is picked (fresh, or derived from the content), the rewriting
// of every reference to it, and the refusals — a dangling alias, and a knot of
// aliases that name each other.

import { assert, assertEquals, assertThrows } from '@std/assert'
import { graph } from './graph.ts'
import type { Bundle } from './bundle.ts'
import { Refused } from './admit.ts'
import { sha256 } from './sha256.ts'
import { books, comp, memory } from './harness.ts'

// A predictable mint, so a test can say which id came out.
let ids = () => {
  let n = 0
  return () => `id-${++n}`
}

let g = (mint = ids()) =>
  graph({ storage: memory(), vocab: books, mint, plugins: [] })

Deno.test('an alias becomes a fresh id, and the return says which', () => {
  let one = g()
  let out = one.apply([
    { entity: { eid: '$dune' }, doc: { title: 'Dune' } },
  ]) as Bundle[]
  let named = out.find((b) => b.$alias == '$dune')!
  assertEquals(named.entity.eid, 'id-1')
  let [stored] = one.storage.tx((tx) => tx.get(['id-1'])) as Bundle[]
  assertEquals(comp(stored, 'doc').title, 'Dune')
})

Deno.test('every reference to the alias points at the same entity', () => {
  let one = g()
  one.apply([
    { entity: { eid: '$dune' }, book: { pages: 412 } },
    { entity: { eid: 'r1' }, review: { stars: 5, book: '$dune' } },
    { entity: { eid: '$dune' }, doc: { title: 'Dune' } }, // same entity again
  ])
  let [r] = one.storage.tx((tx) => tx.get(['r1'])) as Bundle[]
  assertEquals(comp(r, 'review').book, 'id-1') // one id for both bundles
  let [d] = one.storage.tx((tx) => tx.get(['id-1'])) as Bundle[]
  assertEquals(comp(d, 'doc').title, 'Dune')
  assertEquals(comp(d, 'book').pages, 412)
})

Deno.test('a content-addressed component names its own entity', () => {
  // A plugin says how ITS component is named; here a bookmark is the sentence
  // "this points at that", so two writers stating it land on one entity.
  let one = graph({
    storage: memory(),
    vocab: books,
    mint: ids(),
    plugins: [{
      name: 'bookmarks',
      derive: { bookmark: (c) => sha256(`bookmark:${c.of}`) },
    }],
  })
  let out = one.apply([
    { entity: { eid: 'b1' }, doc: { title: 'Dune' } },
    { entity: { eid: '$mark' }, bookmark: { of: 'b1' } },
  ]) as Bundle[]
  let mark = out.find((b) => b.$alias == '$mark')!
  assertEquals(mark.entity.eid, sha256('bookmark:b1'))
  // said again, in another batch, it is the same entity — not a second one
  let again = one.apply([
    { entity: { eid: '$mark' }, bookmark: { of: 'b1' } },
  ]) as Bundle[]
  assertEquals(
    again.find((b) => b.$alias == '$mark')!.entity.eid,
    mark.entity.eid,
  )
})

Deno.test('a derived id sees the aliases under it already resolved', () => {
  let one = graph({
    storage: memory(),
    vocab: books,
    mint: ids(),
    plugins: [{
      name: 'bookmarks',
      derive: { bookmark: (c) => `mark:${c.of}` },
    }],
  })
  let out = one.apply([
    { entity: { eid: '$dune' }, doc: { title: 'Dune' } },
    { entity: { eid: '$mark' }, bookmark: { of: '$dune' } },
  ]) as Bundle[]
  assertEquals(out.find((b) => b.$alias == '$mark')!.entity.eid, 'mark:id-1')
})

Deno.test('an alias nothing in the batch mints is refused', () => {
  let one = g()
  assertThrows(
    () =>
      one.apply([
        { entity: { eid: 'r1' }, review: { stars: 5, book: '$nowhere' } },
      ]),
    Refused,
    '$nowhere',
  )
})

Deno.test('aliases that only name each other are refused', () => {
  let one = graph({
    storage: memory(),
    vocab: books,
    mint: ids(),
    plugins: [{ name: 'marks', derive: { bookmark: (c) => `mark:${c.of}` } }],
  })
  assertThrows(
    () =>
      one.apply([
        { entity: { eid: '$a' }, bookmark: { of: '$b' } },
        { entity: { eid: '$b' }, bookmark: { of: '$a' } },
      ]),
    Refused,
    'depend on each other',
  )
})

Deno.test('a batch with no alias is left exactly alone', () => {
  let one = g()
  let out = one.apply([
    { entity: { eid: 'b1' }, doc: { title: 'Dune' } },
  ]) as Bundle[]
  assert(out.every((b) => b.$alias == null))
  assertEquals(out[0].entity.eid, 'b1')
})
