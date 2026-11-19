// `drop`: bookkeeping removed through storage alone, under its `$was`.

import { test } from '@yaks/testing'
import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { ram } from '@yaks/ram'
import { graph } from './graph.ts'
import type { Bundle } from './bundle.ts'
import { Refused, Stale } from './errors.ts'
import { token } from './sha256.ts'
import { books, slow } from './testing.ts'

let row = '00000000-0000-4000-8000-000000000001'

// A graph holding one book of 7 pages, and what its hooks heard.
let shelf = (async: boolean) => {
  let heard: string[] = []
  let base = ram(books)
  let g = graph({
    storage: async ? slow(base) : base,
    vocab: books,
    plugins: [{
      name: 'ear',
      hooks: Object.fromEntries(
        ['validate', 'mutate', 'cascade', 'journal', 'commit', 'effect'].map(
          (p) => [p, (b: Bundle[]) => (heard.push(p), b)],
        ),
      ),
    }],
  })
  return {
    g,
    heard,
    ready: async () => {
      await g.apply([{ entity: { eid: row }, book: { pages: 7 } }])
      heard.length = 0
    },
  }
}
let pages = (n: number) => ({ book: { pages: token(n) } })

for (let async of [false, true]) {
  let kind = async ? 'async' : 'sync'

  test(`a drop removes what its $was still names, and no hook hears it (${kind})`, async () => {
    let { g, heard, ready } = shelf(async)
    await ready()
    assertEquals(await g.drop([{ entity: { eid: row }, $was: pages(7) }]), [
      row,
    ])
    let [gone] = await g.get([row])
    assertEquals(gone.book, undefined)
    assertEquals(heard, [])
    assertEquals(await g.drop([{ entity: { eid: row }, $was: pages(7) }]), [])
  })

  test(`a drop whose $was moved removes nothing (${kind})`, async () => {
    let { g, ready } = shelf(async)
    await ready()
    let stale = async () =>
      await g.drop([{ entity: { eid: row }, $was: pages(8) }])
    await assertRejects(stale, Stale)
    let [kept] = await g.get([row])
    assertEquals(kept.book, { pages: 7 })
  })
}

test('a drop takes an entity and its $was, nothing else', () => {
  let { g } = shelf(false)
  assertThrows(
    () => g.drop([{ entity: { eid: row }, book: { pages: 1 } }]),
    Refused,
  )
})
