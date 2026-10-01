/// <reference lib="deno.ns" />
// The door, over the bookshop corpus: what each shape of query selects, in
// what order, and what it refuses.

import { test } from '@yaks/testing'
import { assert, assertEquals, assertFalse, assertThrows } from '@std/assert'
import { Unsupported } from '@yaks/sql'
import { Unknown } from '@yaks/vocab'
import { absent, and, eq, pred, present } from '@yaks/query'
import { filter, matcher } from './match.ts'
import { bundles, NOW, shop } from './testing.ts'

let sel = (q: string): string[] =>
  matcher(q, shop, { now: NOW })(bundles).map((b) => b.entity.eid)

test('a scalar filter selects, and an absent property is a value', () => {
  assertEquals(sel('.book.price>=12'), ['b1', 'b2'])
  assertEquals(sel('.book.status=shelved,sold'), ['b1', 'b2', 'b4'])
  // every entity with no released stamp, book or not
  assertEquals(sel('!book.released'), [
    'a1',
    'a2',
    'b4',
    'r1',
    'r2',
    'r3',
    'm1',
    'd1',
  ])
  assertEquals(sel('.book.available=1'), ['b1', 'b3', 'b4'])
})

test('a component is worn or it is not', () => {
  assertEquals(sel('.review'), ['r1', 'r2', 'r3'])
  assertEquals(sel('.member'), ['m1'])
  // a tag — no properties at all, so wearing it is the whole fact
  assertEquals(sel('.signed'), ['b4'])
  assertEquals(sel('.signed~='), ['b4'])
  assertFalse(sel('!signed').includes('b4'))
  assert(sel('!signed').includes('b1'))
})

test('presence reads plugin components without a declared schema', () => {
  let e = { entity: { eid: 'i1' }, doc: { title: 'Invoice' }, invoice: {} }
  let hit = filter(
    and(pred('doc', '!', null), pred('invoice', '!', null)),
    shop,
  )
  assert(hit(e))
  assertFalse(hit({ ...e, invoice: null }))
  assertFalse(hit({ entity: e.entity, doc: e.doc }))
  assertFalse(filter('.missing', shop)(e))
  assert(filter('.entity', shop)(e))
  assert(filter('.entity.eid', shop)(e))
  assert(filter('.doc.title', shop)(e))
  assertFalse(filter('.doc.title', shop)({ ...e, doc: {} }))
  assertThrows(() => filter('.invoice=1', shop), Error, 'unknown prop')
})

test('a property named alone is refused with the forms that name it', () => {
  for (let q of ['.price>=12', '.title', '!released', '.order=price']) {
    assertThrows(() => matcher(q, shop), Unknown, 'name it .', q)
  }
  assertThrows(
    () => matcher('.price>=12', shop),
    Unknown,
    '.price is a property, not a component — name it .book.price',
  )
  assertThrows(() => matcher('.eid=b1', shop), Unknown, '.entity.eid')
})

test('a name alone is the component, never the property beside it', () => {
  // `book` is both a component and review's reference property: alone it is
  // the component, and the property is named with its own.
  assertEquals(sel('.book'), ['b1', 'b2', 'b3', 'b4'])
  assertEquals(sel('.review.book=b1'), ['r1', 'r2'])
  assertEquals(sel('.review.book'), ['r1', 'r2', 'r3'])
  // Its absence names the component too: the reviews lack it, the books don't.
  assertEquals(sel('!book').filter((e) => /^[br]\d$/.test(e)), [
    'r1',
    'r2',
    'r3',
  ])
})

test('the kind scope names the most specific kind', () => {
  assertEquals(sel('.kind=book'), ['b1', 'b2', 'b3', 'b4'])
  assertEquals(sel('.kind=books'), ['b1', 'b2', 'b3', 'b4'])
  assertEquals(sel('.kind=doc'), ['a1', 'a2', 'd1'])
  assertEquals(sel('.kind=member'), ['m1'])
})

test('a reference is followed through the set it was given', () => {
  assertEquals(sel('.book.author=a1'), ['b1', 'b4'])
  assertEquals(sel('.book.author.doc.title~=vale'), ['b1', 'b4'])
  assertEquals(sel('.book.author.doc.body~=manuals'), ['b2'])
  assertEquals(sel('.book.author.member'), [])
})

test('a reverse hop reads the children pointing back', () => {
  assertEquals(sel('.reviews'), ['b1', 'b2'])
  assertEquals(sel('.reviews>=2'), ['b1'])
  assertEquals(sel('.reviews.review.stars=5'), ['b1'])
  assertEquals(sel('.books'), ['a1', 'a2'])
})

test('.refs= gathers the backlinks of an entity', () => {
  assertEquals(sel('.refs=a1'), ['b1', 'b4'])
  assertEquals(sel('.refs=b1'), ['r1', 'r2'])
})

test('a bare word matches by whole word, not by substring', () => {
  assertEquals(sel('fables'), ['a1', 'b4'])
  assertEquals(sel('cat*'), ['b3'])
  assertEquals(sel('cat'), [])
  assertEquals(sel('"winter journey"'), ['b1'])
  assertEquals(sel(''), [])
})

test('an ordering sorts, with absent values first', () => {
  assertEquals(sel('.kind=book&.order=book.price'), ['b3', 'b4', 'b1', 'b2'])
  assertEquals(sel('.kind=book&.order=-book.price'), ['b2', 'b1', 'b4', 'b3'])
  assertEquals(sel('.kind=book&.order=book.released'), ['b4', 'b2', 'b3', 'b1'])
  assertEquals(sel('.kind=book&.order=-book.released'), [
    'b1',
    'b3',
    'b2',
    'b4',
  ])
})

test('a window with no order pages newest first', () => {
  assertEquals(sel('.kind=book&.limit=2'), ['b4', 'b3'])
  assertEquals(sel('.kind=book&.after=5'), ['b2', 'b1'])
})

test('a window pages WITHIN the order it was asked for', () => {
  assertEquals(sel('.kind=book&.order=book.price&.limit=2'), ['b3', 'b4'])
  // the cursor names an entity, and paging continues from its place in the
  // order — b4 is the second cheapest, so the next page is the two dearest
  assertEquals(sel('.kind=book&.order=book.price&.limit=2&.after=6'), [
    'b1',
    'b2',
  ])
  assertEquals(sel('.kind=book&.order=book.price&.limit=2&.after=b4'), [
    'b1',
    'b2',
  ])
  assertEquals(sel('.kind=book&.order=-book.price&.after=4'), [
    'b1',
    'b4',
    'b3',
  ])
  // an anchor no entity has is the first page again
  assertEquals(sel('.kind=book&.order=book.price&.limit=2&.after=99'), [
    'b3',
    'b4',
  ])
  // an anchor outside the selection still names a place in the order (r3 has
  // no price, and absent values sort first)
  assertEquals(sel('.kind=book&.order=book.price&.after=9'), [
    'b3',
    'b4',
    'b1',
    'b2',
  ])
})

test('an eid cursor pages entities without human numbers', () => {
  let bare = bundles.map((b) => ({ ...b, entity: { eid: b.entity.eid } }))
  let read = (q: string) => matcher(q, shop)(bare).map((b) => b.entity.eid)
  assertEquals(read('.kind=book&.limit=2'), ['b4', 'b3'])
  assertEquals(read('.kind=book&.limit=2&.after=b3'), ['b2', 'b1'])
})

test('a time phrase answers for the moment each run is asked at', () => {
  let today = (now: number) =>
    matcher('.book.released=today', shop, { now })(bundles).map((b) =>
      b.entity.eid
    )
  assertEquals(today(NOW), ['b1'])
  assertEquals(today(NOW - 864e5), ['b3'])
  assertEquals(today(NOW), ['b1'])
})

test('a deleted entity is never selected', () => {
  assertEquals(sel('.review.stars=1'), [])
  assertEquals(sel('.review.stars'), ['r1', 'r2', 'r3'])
})

test('the filter door judges one bundle at a time', () => {
  let cheap = filter('.book.price<10', shop)
  assert(cheap(bundles.find((b) => b.entity.eid == 'b4')!))
  assertFalse(cheap(bundles.find((b) => b.entity.eid == 'b1')!))
  // a question about another entity is answered from the set it is given
  let byVale = filter('.book.author.doc.title~=vale', shop)
  let b1 = bundles.find((b) => b.entity.eid == 'b1')!
  assertFalse(byVale(b1))
  assert(byVale(b1, bundles))
})

test('what it cannot answer exactly, it declines', () => {
  for (let q of ['.near=b1', '.count', '.distinct=book.status', '.edges']) {
    let e = assertThrows(() => matcher(q, shop), Unsupported) as Unsupported
    assertEquals(e.by, '@yaks/match', q)
  }
  // the rule sigils: a component to add, a gate, a write set, a resource and a
  // variable are instructions to a rule engine, not questions about a bundle,
  // so they decline here rather than quietly matching everything
  for (let q of ['+book', '+!book', '*book', '#book', '$b']) {
    let e = assertThrows(() => matcher(q, shop), Unsupported) as Unsupported
    assertEquals(e.by, '@yaks/match', q)
  }
  // a reverse hop that is neither a count nor a child filter
  assertThrows(() => matcher('.reviews~=deep', shop), Unsupported)
  // a path whose root is no reference
  assertThrows(() => matcher('.book.price.doc.title=x', shop), Unsupported)
  // and a property the vocabulary does not declare is a routing error, as ever
  assertThrows(() => matcher('.nonesuch=1', shop), Error, 'unknown prop')
})

test('reverse NONE and a builder child conjunction keep quantifier semantics', () => {
  assertEquals(sel('.reviews!.review.stars=5').includes('b1'), false)
  assertEquals(sel('.reviews!.review.stars=5').includes('b4'), true)
  let ast = and({
    ...present('reviews'),
    where: and(eq('review.stars', 5), present('review')),
  })
  assertEquals(matcher(ast, shop)(bundles).map((b) => b.entity.eid), ['b1'])
  assertEquals(
    matcher(and(absent('book')), shop)(bundles).some((b) =>
      b.entity.eid == 'b1'
    ),
    false,
  )
})
