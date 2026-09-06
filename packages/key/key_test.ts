// The key as a graph plugin: a value states itself, is named by what it says,
// dies with what it names, cannot be half-said, and a value somebody holds
// takes the batch's minted entity onto its holder.

import { assert, assertEquals, assertThrows } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { isPromise } from '@yaks/graph'
import { keyEid } from './eid.ts'
import { keyed, unkeyed } from './say.ts'
import { held } from './resolve.ts'
import { libraryGraph } from './harness.ts'

let sync = (out: Bundle[] | Promise<Bundle[]>): Bundle[] => {
  assert(!isPromise(out), 'apply() went async over an embedded database')
  return out
}

let books = (g: ReturnType<typeof libraryGraph>) => {
  sync(g.apply([
    { entity: { eid: 'b1' }, book: { title: 'Dune' } },
    { entity: { eid: 'b2' }, book: { title: 'Emma' } },
  ]))
  return g
}

let read = (g: ReturnType<typeof libraryGraph>, q: string) =>
  (g.read(q) as Bundle[]).map((b) => b.entity.eid).sort()

let DUNE = '9780441013593'

Deno.test('a key states itself and is stored', () => {
  let g = books(libraryGraph())
  sync(g.apply([keyed('isbn', 'b1', DUNE)]))
  assertEquals(read(g, '.isbn!'), [keyEid('isbn', DUNE)])
  assertEquals(read(g, '.key.value=' + DUNE), [keyEid('isbn', DUNE)])
})

Deno.test('the same value stated twice is one entity', () => {
  let g = books(libraryGraph())
  sync(g.apply([keyed('isbn', 'b1', DUNE)]))
  sync(g.apply([keyed('isbn', 'b1', DUNE)]))
  assertEquals(read(g, '.isbn!').length, 1)
})

Deno.test('an aliased key mints at the pair it states', () => {
  let g = books(libraryGraph())
  let out = sync(g.apply([{
    entity: { eid: '$k' },
    key: { of: 'b1', value: DUNE },
    isbn: {},
  }]))
  assertEquals(
    out.find((b) => b.$alias == '$k')!.entity.eid,
    keyEid('isbn', DUNE),
  )
})

Deno.test('a kind read under another name derives from its tag', () => {
  let g = libraryGraph()
  sync(g.apply([{ entity: { eid: 'p1' }, person: {} }]))
  sync(g.apply([keyed('email', 'p1', 'ada@example.com')]))
  assertEquals(read(g, '.email!'), [keyEid('email', 'ada@example.com')])
})

Deno.test('a key with no kind, no value or no `of` is refused by name', () => {
  let g = books(libraryGraph())
  assertThrows(
    () => sync(g.apply([{ entity: { eid: 'k1' }, key: { of: 'b1' } }])),
    Error,
    'has no `value`',
  )
  assertThrows(
    () => sync(g.apply([{ entity: { eid: 'k1' }, key: { value: DUNE } }])),
    Error,
    'has no `of`',
  )
  assertThrows(
    () =>
      sync(g.apply([{
        entity: { eid: keyEid('isbn', DUNE) },
        key: { of: 'b1', value: DUNE },
        pinned: {},
      }])),
    Error,
    'says no kind',
  )
})

Deno.test('a key written anywhere but its own id is refused', () => {
  let g = books(libraryGraph())
  assertThrows(
    () =>
      sync(g.apply([{
        entity: { eid: 'k1' },
        key: { of: 'b1', value: DUNE },
        isbn: {},
      }])),
    Error,
    keyEid('isbn', DUNE),
  )
})

Deno.test('a held value takes the batch onto its holder', () => {
  let g = books(libraryGraph())
  sync(g.apply([keyed('isbn', 'b1', DUNE)]))
  // The seed, written again from scratch: a fresh `$alias` and the same value.
  let out = sync(g.apply([
    { entity: { eid: '$b' }, book: { title: 'Dune (1965)' } },
    { entity: { eid: '$k' }, key: { of: '$b', value: DUNE }, isbn: {} },
  ]))
  assertEquals(out.find((b) => b.$alias == '$b')!.entity.eid, 'b1')
  assertEquals(read(g, '.book!'), ['b1', 'b2'])
  assertEquals(
    (g.read('.eid=b1') as Bundle[])[0].doc,
    undefined,
    'the patch landed on the holder',
  )
  assertEquals(
    ((g.read('.eid=b1') as Bundle[])[0].book as { title: string }).title,
    'Dune (1965)',
  )
})

Deno.test('a reference to the batch entity follows it onto the holder', () => {
  let g = books(libraryGraph())
  sync(g.apply([keyed('isbn', 'b1', DUNE)]))
  let out = sync(g.apply([
    { entity: { eid: '$b' }, book: { title: 'Dune' } },
    { entity: { eid: '$k' }, key: { of: '$b', value: DUNE }, isbn: {} },
    { entity: { eid: 'n1' }, pinned: {}, key: null },
  ]))
  assertEquals(out.find((b) => b.$alias == '$b')!.entity.eid, 'b1')
  assertEquals(
    (g.read('.key.of=b1') as Bundle[]).map((b) => b.entity.eid),
    [keyEid('isbn', DUNE)],
  )
})

Deno.test('a client-minted entity claiming a held value is refused', () => {
  let g = books(libraryGraph())
  sync(g.apply([keyed('isbn', 'b1', DUNE)]))
  assertThrows(
    () => sync(g.apply([keyed('isbn', 'b2', DUNE)])),
    Error,
    "is b1's",
  )
})

Deno.test('a value is free again once what it named is gone', () => {
  let g = books(libraryGraph())
  sync(g.apply([keyed('isbn', 'b1', DUNE)]))
  sync(g.apply([{ entity: { eid: 'b1' }, $delete: true }]))
  assertEquals(read(g, '.isbn!'), [])
  sync(g.apply([keyed('isbn', 'b2', DUNE)]))
  assertEquals(read(g, '.key.of=b2'), [keyEid('isbn', DUNE)])
})

Deno.test('a retired value can be claimed again', () => {
  let g = books(libraryGraph())
  sync(g.apply([keyed('isbn', 'b1', DUNE)]))
  sync(g.apply([unkeyed('isbn', DUNE)]))
  assertEquals(read(g, '.isbn!'), [])
  sync(g.apply([keyed('isbn', 'b2', DUNE)]))
  assertEquals(read(g, '.key.of=b2'), [keyEid('isbn', DUNE)])
})

Deno.test('held answers who holds each value, in one get', () => {
  let g = books(libraryGraph())
  sync(g.apply([keyed('isbn', 'b1', DUNE)]))
  let at = g.storage.tx((tx) => held(tx, 'isbn', [DUNE, 'nobody'])) as Map<
    string,
    string
  >
  assertEquals([...at], [[DUNE, 'b1']])
})
