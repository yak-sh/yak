// Which properties are searchable, read off a vocabulary.

import { assertEquals } from '@std/assert'
import { fields, indexes, indexName } from './fields.ts'
import { shop } from './harness.ts'

Deno.test('every text property is indexed, whatever component holds it', () => {
  assertEquals(fields(shop), [
    { comp: 'book', prop: 'title' },
    { comp: 'book', prop: 'blurb' },
    { comp: 'review', prop: 'prose' },
  ])
})

Deno.test('a number, a reference and the spine are not prose', () => {
  let picked = fields(shop).map((f) => `${f.comp}.${f.prop}`)
  for (let not of ['book.price', 'review.stars', 'review.book', 'entity.num']) {
    assertEquals(picked.includes(not), false, not)
  }
})

Deno.test('a pick narrows the default — titles only', () => {
  assertEquals(fields(shop, (c) => c.prop == 'title'), [
    { comp: 'book', prop: 'title' },
  ])
})

Deno.test('fields group into one index per component', () => {
  assertEquals(indexes(fields(shop)), [
    { comp: 'book', props: ['title', 'blurb'] },
    { comp: 'review', props: ['prose'] },
  ])
  assertEquals(indexName('book'), 'book_fts')
})
