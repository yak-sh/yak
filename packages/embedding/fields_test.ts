// Which text feeds a vector: every text property, across components, and
// nothing that is not prose.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { fields, pieces } from './fields.ts'
import { shop } from './testing.ts'

test('every text property is embedded, across components', () => {
  assertEquals(fields(shop), [
    { comp: 'book', prop: 'title' },
    { comp: 'book', prop: 'blurb' },
    { comp: 'review', prop: 'prose' },
  ])
})

test('a price is not prose and a Pick can narrow further', () => {
  let titles = fields(shop, (c) => c.prop == 'title')
  assertEquals(titles, [{ comp: 'book', prop: 'title' }])
})

test('a vocabulary with no prose has no statement to write', () => {
  assertEquals(pieces([]), null)
})
