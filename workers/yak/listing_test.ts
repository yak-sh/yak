// One rule for a listing, at the one seam both doors read (listing.ts): the
// tools' graph_query and the page's `/api/query` used to answer the same
// filter line differently (C-32574 item 5).
import { assertEquals } from '@std/assert'
import { asking, listing, named } from './listing.ts'

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

Deno.test("the kernel's own rows are not the person's", () => {
  let body = JSON.stringify([
    { kind: 'doc', entity: { eid: 'a', num: 1 }, doc: { title: 'Pancakes' } },
    {
      kind: 'entity',
      entity: { eid: 'b', num: 2 },
      exception: { message: 'boom' },
      created: { by: null },
    },
  ])
  // Asking for the stamps is not asking for the platform's bookkeeping
  // (C-32607 item 4): a break stays out until the filter names it.
  assertEquals(rows(listing(body, '.created!')).map((r) => r.kind), ['doc'])
  assertEquals(rows(listing(body, '.doc!')).map((r) => r.kind), ['doc'])
  assertEquals(rows(listing(body, '.exception!')).map((r) => r.kind), [
    'doc',
    'entity',
  ])
})

// A page's own ask carries the screen, so a `.count!` counts what the list
// beside it lists — a person the store minted wears a `doc` title now, and
// would otherwise be one more recipe (T-32627).
Deno.test("the platform's rows are left out of the question too", () => {
  assertEquals(asking('?.doc!'), '?.doc!&.exception=&.error=&.person=')
  // Naming one asks for it, and an address asks for its row whatever it is.
  assertEquals(asking('?.person!'), '?.person!&.exception=&.error=')
  assertEquals(asking('?id=abc'), '?id=abc')
  // An empty ask selects nothing; a screen would not change that.
  assertEquals(asking('?'), '?')
})

Deno.test('what is not a row listing passes through as it came', () => {
  assertEquals(listing('{"count":3}', '.count!'), '{"count":3}')
  assertEquals(listing('not json at all', '.doc!'), 'not json at all')
})

// Outputs speak human: a reference to somebody the store knows carries their
// name, so a view's ONE query draws a byline (C-32730 item 5).
Deno.test('a reference to a person answers with a name', () => {
  let rows = [
    {
      kind: 'jog',
      entity: { eid: 'a', num: 1 },
      jog: { miles: 5, with: 'ada' },
      created: { by: 'ada', via: 'a-session' },
    },
    // A reference to something that is not a person, and a row with none.
    { kind: 'jog', entity: { eid: 'b', num: 2 }, created: { by: 'nobody' } },
  ]
  let ref = (comp: string, col: string) =>
    (comp == 'created' && (col == 'by' || col == 'via')) ||
    (comp == 'jog' && col == 'with')
  let out = named(
    rows,
    ref,
    (eids) => new Map(eids.filter((e) => e == 'ada').map((e) => [e, 'Ada'])),
  )
  assertEquals(out[0].created, {
    by: { eid: 'ada', name: 'Ada' },
    via: 'a-session',
  })
  // Any column that references them, not just the stamp.
  assertEquals(out[0].jog, { miles: 5, with: { eid: 'ada', name: 'Ada' } })
  // A stranger keeps the eid the store has always answered with.
  assertEquals(out[1].created, { by: 'nobody' })
  // Nobody to name is the rows themselves, untouched.
  assertEquals(named(rows, ref, () => new Map()), rows)
})
