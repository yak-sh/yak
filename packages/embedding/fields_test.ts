// Which text feeds a vector: every text property, across components, and
// nothing that is not prose.

import { assert, assertEquals } from '@std/assert'
import { fields, pieces } from './fields.ts'
import { shop } from './harness.ts'

Deno.test('every text property is embedded, across components', () => {
  assertEquals(fields(shop), [
    { comp: 'book', prop: 'title' },
    { comp: 'book', prop: 'blurb' },
    { comp: 'review', prop: 'prose' },
  ])
})

Deno.test('a price is not prose and a Pick can narrow further', () => {
  let titles = fields(shop, (c) => c.prop == 'title')
  assertEquals(titles, [{ comp: 'book', prop: 'title' }])
})

Deno.test('the pieces statement drops blank text and orders the join', () => {
  let stmt = pieces(fields(shop))!
  assert(stmt.sql.includes('union all'), stmt.sql)
  assert(stmt.sql.includes(`trim(coalesce("book"."title", ''), ?) != ''`))
  assertEquals(stmt.params.length, 3)
  // the ord is the field's position, which is the order a text is joined in
  assert(stmt.sql.includes('0 as ord') && stmt.sql.includes('2 as ord'))
})

Deno.test('a vocabulary with no prose has no statement to write', () => {
  assertEquals(pieces([]), null)
})
