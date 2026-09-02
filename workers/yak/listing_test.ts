// One rule for a listing, at the one seam both doors read (listing.ts): the
// tools' graph_query and the page's `/api/query` used to answer the same
// filter line differently (C-32574 item 5).
import { assertEquals } from '@std/assert'
import { listing } from './listing.ts'

let rows = (body: string) => JSON.parse(body) as Record<string, unknown>[]

Deno.test('a listing carries what a person saved, not the stamps', () => {
  let body = JSON.stringify([
    {
      kind: 'book',
      entity: { eid: 'a', num: 1 },
      doc: { title: 'Dune' },
      created: { by: 'jeff', at: 'now' },
      updated: { at: 'now' },
    },
    // A row that is nothing but bookkeeping is not a row a person saved.
    { kind: 'entity', entity: { eid: 'b', num: 2 }, created: { by: null } },
  ])
  assertEquals(rows(listing(body, '.book!')), [
    { kind: 'book', entity: { eid: 'a', num: 1 }, doc: { title: 'Dune' } },
  ])
  // Naming a stamp asks for it back, and asks it back for every row.
  assertEquals(rows(listing(body, '.book!&.created!')).length, 2)
  assertEquals(rows(listing(body, '.created.by=jeff'))[0].created, {
    by: 'jeff',
    at: 'now',
  })
})

Deno.test('what is not a row listing passes through as it came', () => {
  assertEquals(listing('{"count":3}', '.count!'), '{"count":3}')
  assertEquals(listing('not json at all', '.doc!'), 'not json at all')
})
