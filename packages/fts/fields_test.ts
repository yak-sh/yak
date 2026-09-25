// Which properties are searchable, read off a vocabulary.

import { assertEquals } from '@std/assert'
import { fields, indexes, indexName } from './fields.ts'
import { loadVocab } from '@yaks/vocab'
import { shop } from './testing.ts'

Deno.test('the declared text properties are indexed, whatever component holds them', () => {
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
    { name: 'book', comp: 'book', props: ['title', 'blurb'] },
    { name: 'review', comp: 'review', props: ['prose'] },
  ])
  assertEquals(indexName('book'), 'book_fts')
})

Deno.test('a text property nobody declared is stored, readable, and never searched', () => {
  let quiet = loadVocab({
    $defs: {
      book: {
        component: true,
        type: 'object',
        properties: {
          title: { type: 'string', search: true },
          shelf: { type: 'string' },
        },
      },
    },
  })
  assertEquals(fields(quiet), [{ comp: 'book', prop: 'title' }])
})

Deno.test('a vocabulary declaring no search has nothing to search', () => {
  let silent = loadVocab({
    $defs: {
      book: {
        component: true,
        type: 'object',
        properties: { title: { type: 'string' } },
      },
    },
  })
  assertEquals(fields(silent), [])
})
