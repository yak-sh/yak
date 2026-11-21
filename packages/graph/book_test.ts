// `book`: bookkeeping written through storage alone, under its `$was`.

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

let gone = (was: Bundle['$was']) => ({
  entity: { eid: row },
  $was: was,
  $delete: true,
})

for (let async of [false, true]) {
  let kind = async ? 'async' : 'sync'

  test(`a book erases what its $was still names, and no hook hears it (${kind})`, async () => {
    let { g, heard, ready } = shelf(async)
    await ready()
    assertEquals(await g.book([gone(pages(7))]), [row])
    assertEquals(await g.get([row]), [])
    assertEquals(heard, [])
    assertEquals(await g.book([gone(pages(7))]), [])
  })

  test(`a book patches what its $was still names, unstamped and unheard (${kind})`, async () => {
    let { g, heard, ready } = shelf(async)
    await ready()
    let [was] = await g.get([row])
    let write = { entity: { eid: row }, $was: pages(7), book: { pages: 8 } }
    assertEquals(await g.book([write]), [row])
    let [now] = await g.get([row])
    assertEquals([now.book, now.updated], [{ pages: 8 }, was.updated])
    assertEquals(heard, [])
  })

  test(`a book whose $was moved writes nothing (${kind})`, async () => {
    let { g, ready } = shelf(async)
    await ready()
    let stale = async () => await g.book([gone(pages(8))])
    await assertRejects(stale, Stale)
    let [kept] = await g.get([row])
    assertEquals(kept.book, { pages: 7 })
  })
}

test('a book creates nothing', async () => {
  let { g } = shelf(false)
  let made = {
    entity: { eid: row },
    $was: { book: { pages: token(null) } },
    book: { pages: 1 },
  }
  assertEquals(await g.book([made]), [])
  assertEquals(await g.get([row]), [])
})

test('a book writes declared components only', () => {
  let { g } = shelf(false)
  assertThrows(
    () => g.book([{ entity: { eid: row }, shelf: { at: 1 } }]),
    Refused,
  )
})
