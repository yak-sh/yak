// The key as a graph plugin: a value states itself, is named by what it says,
// dies with what it names, cannot be half-said, and a value somebody holds
// takes the batch's minted entity onto its holder.

import { test } from '@yaks/testing'
import { assert, assertEquals, assertThrows } from '@std/assert'
import { type Bundle, graph, Stale, token, type Was } from '@yaks/graph'
import { isPromise } from '@yaks/fp'
import { keyEid } from './eid.ts'
import { keyed, unkeyed } from './say.ts'
import { held } from './resolve.ts'
import { library, libraryGraph, store } from './testing.ts'
import { keys } from './plugin.ts'

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

test('a key states itself and is stored', () => {
  let g = books(libraryGraph())
  sync(g.apply([keyed('isbn', 'b1', DUNE)]))
  assertEquals(read(g, '.isbn'), [keyEid('isbn', DUNE)])
  assertEquals(read(g, '.key.value=' + DUNE), [keyEid('isbn', DUNE)])
})

test('the same value stated twice is one entity', () => {
  let g = books(libraryGraph())
  sync(g.apply([keyed('isbn', 'b1', DUNE)]))
  sync(g.apply([keyed('isbn', 'b1', DUNE)]))
  assertEquals(read(g, '.isbn').length, 1)
})

test('an aliased key mints at the pair it states', () => {
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

test('a kind read under another name derives from its tag', () => {
  let g = libraryGraph()
  sync(g.apply([{ entity: { eid: 'p1' }, person: {} }]))
  sync(g.apply([keyed('email', 'p1', 'ada@example.com')]))
  assertEquals(read(g, '.email'), [keyEid('email', 'ada@example.com')])
})

test('a key with no kind, no value or no `of` is refused by name', () => {
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
    'declares no kind',
  )
})

test('a key written anywhere but its own id is refused', () => {
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

test('a held value takes the batch onto its holder', () => {
  let g = books(libraryGraph())
  sync(g.apply([keyed('isbn', 'b1', DUNE)]))
  // The seed, written again from scratch: a fresh `$alias` and the same value.
  let out = sync(g.apply([
    { entity: { eid: '$b' }, book: { title: 'Dune (1965)' } },
    { entity: { eid: '$k' }, key: { of: '$b', value: DUNE }, isbn: {} },
  ]))
  assertEquals(out.find((b) => b.$alias == '$b')!.entity.eid, 'b1')
  assertEquals(read(g, '.book'), ['b1', 'b2'])
  assertEquals(
    (g.read('.entity.eid=b1') as Bundle[])[0].doc,
    undefined,
    'the patch landed on the holder',
  )
  assertEquals(
    ((g.read('.entity.eid=b1') as Bundle[])[0].book as { title: string }).title,
    'Dune (1965)',
  )
})

test('a reference to the batch entity follows it onto the holder', () => {
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

test('a client-minted entity claiming a held value is refused', () => {
  let g = books(libraryGraph())
  sync(g.apply([keyed('isbn', 'b1', DUNE)]))
  assertThrows(
    () => sync(g.apply([keyed('isbn', 'b2', DUNE)])),
    Error,
    "is b1's",
  )
})

test('a value is free again once what it named is gone', () => {
  let g = books(libraryGraph())
  sync(g.apply([keyed('isbn', 'b1', DUNE)]))
  sync(g.apply([{ entity: { eid: 'b1' }, $delete: true }]))
  assertEquals(read(g, '.isbn'), [])
  sync(g.apply([keyed('isbn', 'b2', DUNE)]))
  assertEquals(read(g, '.key.of=b2'), [keyEid('isbn', DUNE)])
})

test('a retired value can be claimed again', () => {
  let g = books(libraryGraph())
  sync(g.apply([keyed('isbn', 'b1', DUNE)]))
  sync(g.apply([unkeyed('isbn', DUNE)]))
  assertEquals(read(g, '.isbn'), [])
  sync(g.apply([keyed('isbn', 'b2', DUNE)]))
  assertEquals(read(g, '.key.of=b2'), [keyEid('isbn', DUNE)])
})

test('held answers who holds each value, in one get', () => {
  let g = books(libraryGraph())
  sync(g.apply([keyed('isbn', 'b1', DUNE)]))
  let at = g.storage.tx((tx) => held(tx, 'isbn', [DUNE, 'nobody'])) as Map<
    string,
    string
  >
  assertEquals([...at], [[DUNE, 'b1']])
})

for (let deletion of [{ $delete: true }, { tombstone: {} }]) {
  test(`a held value transfers when its holder is explicitly deleted: ${Object.keys(deletion)[0]}`, () => {
    let g = books(libraryGraph())
    let eid = keyEid('isbn', DUNE)
    sync(g.apply([keyed('isbn', 'b1', DUNE)]))
    let out = sync(g.apply([
      { entity: { eid: 'b1' }, ...deletion },
      {
        ...keyed('isbn', 'b2', DUNE),
        $was: { key: { of: token('b1'), value: token(DUNE) } },
      },
    ]))
    assertEquals(read(g, '.book'), ['b2'])
    assertEquals(read(g, '.isbn'), [eid])
    assertEquals(read(g, '.key.of=b2'), [eid])
    assertEquals(out.find((b) => b.entity.eid == eid)?.isbn, {})
  })
}

test('explicit deletion permits a minted owner without resolving it onto the old holder', () => {
  let g = books(libraryGraph())
  sync(g.apply([keyed('isbn', 'b1', DUNE)]))
  let out = sync(g.apply([
    { entity: { eid: '$b' }, book: { title: 'New edition' } },
    { entity: { eid: '$k' }, key: { of: '$b', value: DUNE }, isbn: {} },
    { entity: { eid: 'b1' }, $delete: true },
  ]))
  let owner = out.find((b) => b.$alias == '$b')!.entity.eid
  assert(owner != 'b1')
  assertEquals(read(g, '.key.of=' + owner), [keyEid('isbn', DUNE)])
  assertEquals(read(g, '.isbn'), [keyEid('isbn', DUNE)])
})

test('a conflicting transfer precondition is refused without changing any state', () => {
  let g = books(libraryGraph())
  sync(g.apply([keyed('isbn', 'b1', DUNE)]))
  let before = g.read('*')
  assertThrows(
    () =>
      sync(g.apply([
        { entity: { eid: 'b1' }, $delete: true },
        { entity: { eid: 'b2' }, book: { title: 'Changed' } },
        { ...keyed('isbn', 'b2', DUNE), $was: { key: { of: null } } },
      ])),
    Error,
    'conflicting $was key.of',
  )
  assertEquals(g.read('*'), before)
})

test('transfer keeps guards on other properties and components atomic', () => {
  let guards: Was[] = [
    { key: { of: token('b1'), value: token('another value') } },
    { entity: { num: token(-1) } },
  ]
  for (let was of guards) {
    let g = books(libraryGraph())
    sync(g.apply([keyed('isbn', 'b1', DUNE)]))
    let before = g.read('*')
    assertThrows(() =>
      sync(g.apply([
        { entity: { eid: 'b1' }, $delete: true },
        { entity: { eid: 'b2' }, book: { title: 'Changed' } },
        { ...keyed('isbn', 'b2', DUNE), $was: was },
      ])), Stale)
    assertEquals(g.read('*'), before)
  }
})

test('an ordinary conflict refuses the entire change', () => {
  let g = books(libraryGraph())
  sync(g.apply([keyed('isbn', 'b1', DUNE)]))
  let before = g.read('*')
  assertThrows(
    () =>
      sync(g.apply([
        { entity: { eid: 'b2' }, book: { title: 'Changed' } },
        keyed('isbn', 'b2', DUNE),
      ])),
    Error,
    "is b1's",
  )
  assertEquals(g.read('*'), before)
})

test('a transfer guards the holder observed before the transaction', () => {
  let storage = store()
  let rival = books(libraryGraph(storage))
  sync(rival.apply([
    { entity: { eid: 'b3' }, book: { title: 'Rival' } },
    keyed('isbn', 'b1', DUNE),
  ]))
  let before: Bundle[] = []
  let g = graph({
    storage,
    vocab: library,
    plugins: [keys(library), {
      name: 'rival transfer',
      hooks: {
        // After key mint observed b1, but before the guarded transaction.
        mint: (bundles) => {
          sync(rival.apply([
            { entity: { eid: 'b1' }, $delete: true },
            keyed('isbn', 'b3', DUNE),
          ]))
          before = rival.read('*') as Bundle[]
          return bundles
        },
      },
    }],
  })
  let err = assertThrows(() =>
    sync(g.apply([
      { entity: { eid: 'b1' }, $delete: true },
      { entity: { eid: 'b2' }, book: { title: 'Stale transfer' } },
      keyed('isbn', 'b2', DUNE),
    ])), Stale)
  assertEquals([err.comp, err.prop, err.current], ['key', 'of', 'b3'])
  assertEquals(g.read('*'), before)
  assertEquals(read(g, '.key.of=b3'), [keyEid('isbn', DUNE)])
  assertEquals(read(g, '.isbn'), [keyEid('isbn', DUNE)])
})
