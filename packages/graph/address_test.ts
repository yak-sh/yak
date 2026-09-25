// The address door: an id a caller names — in a tool's arguments, a query, a
// write — becomes the eid it names through the plugins' `address`, and one a
// plugin recognised and nobody resolved is refused rather than minted as an
// entity of that literal name.

import { assertEquals, assertThrows } from '@std/assert'
import { graph } from './graph.ts'
import type { Bundle } from './bundle.ts'
import type { Plugin } from './plugin.ts'
import { Refused } from './admit.ts'
import { books, comp, memory } from './testing.ts'

// What @yaks/id is to a graph that numbers its entities: `B-7` is the book
// `dune`, and every other `B-` id is written its way and names nothing.
let numbered: Plugin = {
  name: 'numbered',
  address: (_tx, ids) =>
    new Map(
      ids.filter((id) => id.startsWith('B-'))
        .map((id) => [id, id == 'B-7' ? 'dune' : null]),
    ),
}

// A later plugin that knows `B-8` by name.
let named: Plugin = {
  name: 'named',
  address: (_tx, ids) =>
    new Map(ids.filter((id) => id == 'B-8').map((id) => [id, 'dune'])),
}

let g = (...plugins: Plugin[]) => {
  let one = graph({ storage: memory(), vocab: books, plugins })
  one.apply([{ entity: { eid: 'dune' }, doc: { title: 'Dune' } }])
  return one
}
let get = (one: ReturnType<typeof g>, eid: string) =>
  (one.storage.tx((tx) => tx.get([eid])) as Bundle[])[0]

Deno.test('an id that names nothing is refused, by name', () => {
  assertThrows(
    () => g(numbered).address(['dune', 'B-7', 'B-9', 'B-10']),
    Refused,
    'B-9, B-10 name nothing',
  )
  assertEquals(g(numbered).address(['dune', 'B-7']), new Map([['B-7', 'dune']]))
})

Deno.test('a later plugin may resolve what an earlier one found nothing for', () => {
  assertEquals(g(numbered, named).address(['B-8']), new Map([['B-8', 'dune']]))
})

Deno.test('a write lands on the entity its ids name', () => {
  let one = g(numbered)
  one.apply([
    { entity: { eid: 'B-7' }, book: { pages: 412 } },
    { entity: { eid: 'r1' }, review: { stars: 5, book: 'B-7' } },
  ])
  assertEquals(comp(get(one, 'dune'), 'book').pages, 412)
  assertEquals(comp(get(one, 'r1'), 'review').book, 'dune')
  assertEquals(get(one, 'B-7'), undefined)
})

Deno.test('a write naming nothing is refused before anything is minted', () => {
  let one = g(numbered)
  assertThrows(
    () => one.apply([{ entity: { eid: 'B-9' }, doc: { title: 'x' } }]),
    Refused,
    'B-9 names nothing',
  )
  assertThrows(
    () => one.apply([{ entity: { eid: 'r2' }, review: { book: 'B-9' } }]),
    Refused,
  )
  assertEquals([get(one, 'B-9'), get(one, 'r2')], [undefined, undefined])
})

Deno.test('a read naming nothing is refused too', () => {
  assertThrows(() => g(numbered).read('.review.book=B-9'), Refused)
})
