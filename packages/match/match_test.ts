/// <reference lib="deno.ns" />
// The door, over the bookshop corpus: what each shape of query selects, in
// what order, and what it refuses.

import { assert, assertEquals, assertFalse, assertThrows } from '@std/assert'
import { Unsupported } from '@yaks/sql'
import { filter, matcher } from './match.ts'
import { bundles, NOW, shop } from './harness.ts'

let sel = (q: string): string[] =>
  matcher(q, shop, { now: NOW })(bundles).map((b) => b.entity.eid)

Deno.test('a scalar filter selects, and an absent column is a value', () => {
  assertEquals(sel('.price>=12'), ['b1', 'b2'])
  assertEquals(sel('.status=shelved,sold'), ['b1', 'b2', 'b4'])
  // every entity with no released stamp, book or not
  assertEquals(sel('.released='), [
    'a1',
    'a2',
    'b4',
    'r1',
    'r2',
    'r3',
    'm1',
    'd1',
  ])
  assertEquals(sel('.available=1'), ['b1', 'b3', 'b4'])
})

Deno.test('a component is worn or it is not', () => {
  assertEquals(sel('.review!'), ['r1', 'r2', 'r3'])
  assertEquals(sel('.member!'), ['m1'])
})

Deno.test('the kind scope names the most specific kind', () => {
  assertEquals(sel('.kind=book'), ['b1', 'b2', 'b3', 'b4'])
  assertEquals(sel('.kind=books'), ['b1', 'b2', 'b3', 'b4'])
  assertEquals(sel('.kind=doc'), ['a1', 'a2', 'd1'])
  assertEquals(sel('.kind=member'), ['m1'])
})

Deno.test('a reference is followed through the set it was given', () => {
  assertEquals(sel('.author=a1'), ['b1', 'b4'])
  assertEquals(sel('.book.author.doc.title~=vale'), ['b1', 'b4'])
  assertEquals(sel('.book.author.doc.body~=manuals'), ['b2'])
  assertEquals(sel('.book.author.member!'), [])
})

Deno.test('a reverse hop reads the children pointing back', () => {
  assertEquals(sel('.reviews!'), ['b1', 'b2'])
  assertEquals(sel('.reviews>=2'), ['b1'])
  assertEquals(sel('.reviews.stars=5'), ['b1'])
  assertEquals(sel('.books!'), ['a1', 'a2'])
})

Deno.test('.refs= gathers the backlinks of an entity', () => {
  assertEquals(sel('.refs=a1'), ['b1', 'b4'])
  assertEquals(sel('.refs=b1'), ['r1', 'r2'])
})

Deno.test('a bare word matches by whole word, not by substring', () => {
  assertEquals(sel('fables'), ['a1', 'b4'])
  assertEquals(sel('cat*'), ['b3'])
  assertEquals(sel('cat'), [])
  assertEquals(sel('"winter journey"'), ['b1'])
  assertEquals(sel(''), [])
})

Deno.test('an ordering sorts, with absent values first', () => {
  assertEquals(sel('.kind=book&.order=price'), ['b3', 'b4', 'b1', 'b2'])
  assertEquals(sel('.kind=book&.order=-price'), ['b2', 'b1', 'b4', 'b3'])
  assertEquals(sel('.kind=book&.order=released'), ['b4', 'b2', 'b3', 'b1'])
  assertEquals(sel('.kind=book&.order=-released'), ['b1', 'b3', 'b2', 'b4'])
})

Deno.test('a window pages newest first, whatever else was asked', () => {
  assertEquals(sel('.kind=book&.limit=2'), ['b4', 'b3'])
  assertEquals(sel('.kind=book&.after=5'), ['b2', 'b1'])
  assertEquals(sel('.kind=book&.order=price&.limit=2'), ['b4', 'b3'])
})

Deno.test('a deleted entity is never selected', () => {
  assertEquals(sel('.stars=1'), [])
  assertEquals(sel('.stars!'), ['r1', 'r2', 'r3'])
})

Deno.test('the filter door judges one bundle at a time', () => {
  let cheap = filter('.price<10', shop)
  assert(cheap(bundles.find((b) => b.entity.eid == 'b4')!))
  assertFalse(cheap(bundles.find((b) => b.entity.eid == 'b1')!))
  // a question about another entity is answered from the set it is given
  let byVale = filter('.book.author.doc.title~=vale', shop)
  let b1 = bundles.find((b) => b.entity.eid == 'b1')!
  assertFalse(byVale(b1))
  assert(byVale(b1, bundles))
})

Deno.test('what it cannot answer exactly, it declines', () => {
  for (let q of ['.near=b1', '.count!', '.distinct=status', '.edges!']) {
    let e = assertThrows(() => matcher(q, shop), Unsupported) as Unsupported
    assertEquals(e.by, '@yaks/match', q)
  }
  // a reverse hop that is neither a count nor a child filter
  assertThrows(() => matcher('.reviews~=deep', shop), Unsupported)
  // a path whose root is no reference
  assertThrows(() => matcher('.price.title=x', shop), Unsupported)
  // and a column the vocabulary does not declare is a routing error, as ever
  assertThrows(() => matcher('.nonesuch=1', shop), Error, 'unknown prop')
})
