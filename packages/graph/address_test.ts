// The address door: an id a caller names — in a tool's arguments, a query, a
// write — becomes the eid it names through the plugins' `address`, and one a
// plugin recognised and nobody resolved is refused rather than minted as an
// entity of that literal name.

import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { graph } from './graph.ts'
import type { Bundle } from './bundle.ts'
import type { Plugin } from './plugin.ts'
import { Refused } from './admit.ts'
import { books, comp, memory } from './testing.ts'
import { ram } from '@yaks/ram'
import { ids } from '@yaks/id/graph'

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
  (one.get([eid]) as Bundle[])[0]

test('an id that names nothing is refused, by name', () => {
  assertThrows(
    () => g(numbered).address(['dune', 'B-7', 'B-9', 'B-10']),
    Refused,
    'B-9, B-10 name nothing',
  )
  assertEquals(g(numbered).address(['dune', 'B-7']), new Map([['B-7', 'dune']]))
})

test('a later plugin may resolve what an earlier one found nothing for', () => {
  assertEquals(g(numbered, named).address(['B-8']), new Map([['B-8', 'dune']]))
})

test('a write lands on the entity its ids name', () => {
  let one = g(numbered)
  one.apply([
    { entity: { eid: 'B-7' }, book: { pages: 412 } },
    { entity: { eid: 'r1' }, review: { stars: 5, book: 'B-7' } },
  ])
  assertEquals(comp(get(one, 'dune'), 'book').pages, 412)
  assertEquals(comp(get(one, 'r1'), 'review').book, 'dune')
  assertEquals(get(one, 'B-7'), undefined)
})

test('a write naming nothing is refused before anything is minted', () => {
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

test('a read naming nothing is refused too', () => {
  assertThrows(() => g(numbered).read('.review.book=B-9'), Refused)
})

// A handle as a person copies it: the hex after the `#`, which a shell takes
// for a comment and a sentence drops. It is asked after every plugin (here
// @yaks/id's, which knows numbers and `#` handles), about what none resolved.
let session = 'e854bf7d-c0d0-469b-a5c8-557a2ce0dfe4'
let digits = '55801474-7259-4ea7-9e58-1febbfd30fcd'
let both = [
  '47e9678b-df12-4000-8000-000000000001',
  '47e9678b-df99-4000-8000-000000000002',
]
let handles = (...plugins: Plugin[]) => {
  let one = graph({
    storage: ram(books, { number: true }),
    vocab: books,
    plugins: [...plugins, ids(books)],
  })
  one.apply([
    { entity: { eid: session }, doc: { title: 'a session' } },
    { entity: { eid: digits }, doc: {} },
    ...both.map((eid) => ({ entity: { eid }, book: {} })),
    // a title spelled as a handle, beside an entity whose eid starts so
    { entity: { eid: 'abcdef01-23' }, doc: {} },
    { entity: { eid: 'titled' }, doc: { title: 'abcdef0123' } },
    // an eid of exactly that spelling, beside a longer one
    { entity: { eid: 'c0ffee0123' }, doc: {} },
    { entity: { eid: 'c0ffee012345' }, doc: {} },
  ])
  return one
}
let knows = (said: string, eid: string): Plugin => ({
  name: 'knows',
  address: (_tx, ids) =>
    new Map(ids.filter((id) => id == said).map((id) => [id, eid])),
})
let plain = handles()
let known = handles(knows('e854bf7dc0', 'dune'), knows('5580147472', 'dune'))
let resolves = (said: string, to: string | undefined, one = plain) =>
  assertEquals((one.address([said]) as Map<string, string>).get(said), to)

test('a handle without its #, as long as one is shown, names its entity', () => {
  resolves('e854bf7dc0', session)
  resolves('E854BF7DC0', session)
  resolves('e854bf7dc0d0469ba5c8557a2ce0dfe4', session)
  resolves('c0ffee01234', 'c0ffee012345')
  // digits alone are a number first, and no entity carries this one
  resolves('5580147472', digits)
  resolves('#5580147472', digits)
})

test('one without its # never takes what something else names', () => {
  resolves(session, undefined)
  resolves('e854bf7d', undefined)
  resolves('abcdef0123', undefined)
  resolves('c0ffee0123', undefined)
  resolves('ffffffffff', undefined)
  resolves('1', session)
  resolves('e854bf7dc0', 'dune', known)
  resolves('5580147472', 'dune', known)
  assertThrows(
    () => plain.address(['8675309999']),
    Refused,
    '8675309999 names nothing',
  )
})

test('a handle several eids start with is refused, naming them', () => {
  for (let said of ['47e9678bdf', '#47e9678bdf']) {
    assertThrows(
      () => plain.address([said]),
      Refused,
      `${said} names 2 entities (${both.join(', ')}); give more of it`,
    )
  }
})

// A deleted entity keeps its eid and number, so its id names it still, though
// no query selects it.
let buried = handles()
buried.apply([{ entity: { eid: 'gone' }, doc: {} }])
let grave = `D-${get(buried, 'gone').entity.num}`
buried.apply([{ entity: { eid: 'gone' }, $delete: true }])
test('a deleted entity’s number still names it', () => {
  resolves(grave, 'gone', buried)
  assertEquals(buried.read(`.entity.eid=${grave}`), [])
})

test('a read and a write name the entity a bare handle does', () => {
  plain.apply([{ entity: { eid: 'r9' }, review: { book: '47e9678bdf12' } }])
  assertEquals(comp(get(plain, 'r9'), 'review').book, both[0])
  assertEquals(
    (plain.read('.review.book=47e9678bdf12') as Bundle[]).map((b) =>
      b.entity.eid
    ),
    ['r9'],
  )
})
