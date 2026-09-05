/// <reference lib="deno.ns" />
// The translation between the page's wire and the Store's (wire.ts). The
// end-to-end proof is serving_test.ts; this is the grammar's own edges, where
// a value carries the character the other wire spells structure with.
import { assertEquals, assertThrows } from '@std/assert'
import { batched, lined, lowered } from './wire.ts'

let cases: [string, string][] = [
  // The riders the page spells bare
  ['id=abc', '.eid=abc'],
  ['.doc!&limit=10&after=3', '.doc!&.limit=10&.after=3'],
  // Everything else is already the same grammar
  ['.doc.title~=cake&.recipe.serves<=4', '.doc.title~=cake&.recipe.serves<=4'],
  ['.doc?&.recipe!', '.doc?&.recipe!'],
  // A value the page escaped, so the whole line can be escaped once on the way
  // out: a space, and an `&` that is part of a title rather than a separator
  ['.doc.title~=lemon%20cake', '.doc.title~=lemon cake'],
  // An `&` is the other wire's separator, so a value carrying one is glued
  // back together with quotes (@yaks/query); a space inside one dot-param
  // needs none, since a segment that IS one keeps its spaces.
  ['.doc.title~=salt%26pepper', '.doc.title~="salt&pepper"'],
  ['.doc.title~=two%20words', '.doc.title~=two words'],
  ['.doc.title~=a%20.b', '.doc.title~="a .b"'],
  // A bare word is a full-text term and carries no operator
  ['lemon%20drizzle', 'lemon drizzle'],
  ['cake&.doc?', 'cake&.doc?'],
  // A stray `%` is a value with a `%` in it, not an escape
  ['.doc.title~=100%', '.doc.title~=100%'],
  // The leading `?` a search string arrives with, and nothing at all
  ['?.doc!', '.doc!'],
  ['', ''],
]

Deno.test('a page line, as the store spells it', () => {
  for (let [page, store] of cases) assertEquals(lined(page), store, page)
})

Deno.test('a batch arrives in either envelope, and never as junk', () => {
  let one = [{ entity: { eid: 'e1' }, doc: { title: 'x' } }]
  assertEquals(batched({ entities: one }), one)
  assertEquals(batched(one), one)
  assertThrows(() => batched({ nope: 1 }), Error, 'entities')
  assertThrows(() => batched(null), Error, 'entities')
})

Deno.test('the batch as applied, in the page own words', () => {
  assertEquals(
    lowered([
      {
        entity: { eid: 'e1', num: 4 },
        kind: 'doc',
        $alias: '$cake',
        doc: { title: 'Lemon drizzle' },
        created: { at: 'now' },
      },
      { entity: { eid: 'e2' }, tombstone: {} },
    ]),
    {
      ok: true,
      changes: [
        { eid: 'e1', name: 'doc', comp: { title: 'Lemon drizzle' } },
        { eid: 'e1', name: 'created', comp: { at: 'now' } },
        // A death is a change like any other: a page folding an answer has to
        // hear it.
        { eid: 'e2', name: 'tombstone', comp: {} },
      ],
      aliases: { $cake: 'e1' },
    },
  )
})
