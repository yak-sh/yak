// One rule for a listing, at the one seam both doors read (listing.ts): the
// tools' graph_query and the page's `/api/query` used to answer the same
// filter line differently (C-32574 item 5).
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { asking, listing, mentions, named } from './listing.ts'
import { graph } from '@yaks/graph'
import { storage } from '@yaks/sqlite'
import { mem } from '../../packages/sqlite/testing.ts'
import { loadVocab } from '@yaks/vocab'
import { toolsDoc } from '@yaks/tools'

let rows = (body: string) => JSON.parse(body) as Record<string, unknown>[]

test('a listing carries what a person saved, not the stamps', () => {
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
  assertEquals(rows(listing(body, '.book')), [
    { kind: 'book', entity: { eid: 'a', num: 1 }, doc: { title: 'Dune' } },
  ])
  // Naming a stamp asks for it back, and asks it back for every row.
  assertEquals(rows(listing(body, '.book&.created')).length, 2)
  assertEquals(rows(listing(body, '.created.by=jeff'))[0].created, {
    by: 'jeff',
    at: 'now',
  })
})

test("the kernel's own rows are not the person's", () => {
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
  assertEquals(rows(listing(body, '.created')).map((r) => r.kind), ['doc'])
  assertEquals(rows(listing(body, '.doc')).map((r) => r.kind), ['doc'])
  assertEquals(rows(listing(body, '.exception')).map((r) => r.kind), [
    'doc',
    'entity',
  ])
})

test('a session query and an eid include its refusal entry', () => {
  let error = {
    kind: 'entry',
    entity: { eid: 'failure' },
    entry: { session: 'heal', seq: 3 },
    refusal: { code: 'http_400' },
    content: { body: 'OpenRouter speech request failed (400)' },
  }
  let body = JSON.stringify([error])
  assertEquals(
    asking('.entry.session=heal', ['refusal']),
    '.entry.session=heal',
  )
  assertEquals(rows(listing(body, '.entry.session=heal&*')), [error])
  assertEquals(rows(listing(body, '.entity.eid=failure&*')), [error])
  assertEquals(rows(listing(body, '.content')), [])
})

test('refusals are hidden by default but explicit transcript and refusal asks include them', () => {
  let refusal = {
    kind: 'entry',
    entity: { eid: 'refused' },
    entry: { session: 'heal', seq: 4 },
    refusal: { code: 'limit' },
    content: { body: 'Budget exhausted' },
  }
  let exception = { ...refusal, exception: { message: 'unexpected' } }
  let body = JSON.stringify([refusal, exception])
  assertEquals(rows(listing(body, '.content')), [])
  assertEquals(rows(listing(body, '.created')), [])
  assertEquals(rows(listing(body, '.entry.session=heal&*')), [refusal])
  assertEquals(rows(listing(JSON.stringify([refusal]), '.refusal')), [refusal])
  assertEquals(rows(listing(JSON.stringify([refusal]), '.eid=refused&*')), [
    refusal,
  ])
  assertEquals(
    asking('.entry.session=heal', ['refusal']),
    '.entry.session=heal',
  )
})

// A page's own ask carries the screen, so a `.count` counts what the list
// beside it lists — a person the store minted wears a `doc` title now, and
// would otherwise be one more recipe (T-32627).
test("the platform's rows are left out of the question too", () => {
  let words = ['error', 'person']
  assertEquals(asking('?.doc', words), '?.doc&!error&!person')
  // and out of every alternative, not just the last
  assertEquals(asking('?.a|.b', words), '?(.a|.b)&!error&!person')
  // Naming one asks for it, and an address asks for its row whatever it is.
  assertEquals(asking('?.person', words), '?.person&!error')
  assertEquals(asking('?id=abc'), '?id=abc')
  // An empty ask selects nothing; a screen would not change that.
  assertEquals(asking('?'), '?')
})

test('query screening excludes refusals from all alternatives and counts', async () => {
  let vocab = loadVocab([toolsDoc, {
    $defs: {
      doc: { component: true, properties: { title: { type: 'string' } } },
      entry: {
        component: true,
        properties: { session: { type: 'string' } },
      },
    },
  }])
  let db = storage(mem(), vocab)
  db.install()
  let g = graph({ vocab, storage: db })
  await g.apply([{
    entity: { eid: 'saved' },
    doc: { title: 'Saved' },
  }, {
    entity: { eid: 'refused' },
    refusal: { code: 'limit' },
    entry: { session: 'heal' },
    content: { body: 'Budget exhausted' },
  }])
  let q = '(.doc|.content)'
  assertEquals(
    (await g.read(asking(q, ['refusal']))).map((b) => b.entity.eid),
    ['saved'],
  )
  assertEquals(
    await g.read(asking(q + '&.count', ['refusal'])),
    await g.read('.doc&.count'),
  )
  assertEquals(
    (await g.read(asking('.entry.session=heal', ['refusal']))).map((b) =>
      b.entity.eid
    ),
    ['refused'],
  )
  assertEquals(
    (await g.read(asking('.refusal', ['refusal']))).map((b) => b.entity.eid),
    ['refused'],
  )
})

test('what is not a row listing passes through as it came', () => {
  assertEquals(listing('{"count":3}', '.count'), '{"count":3}')
  assertEquals(listing('not json at all', '.doc'), 'not json at all')
})

// Outputs speak human: a reference to somebody the store knows carries their
// name, so a view's one query draws a byline (C-32730 item 5).
test('a reference to a person answers with a name', () => {
  let rows = [
    {
      kind: 'jog',
      entity: { eid: 'a', num: 1 },
      jog: { miles: 5, with: 'ada', note: 'ada' },
      created: { by: 'ada', via: 'a-session' },
    },
    // A reference to something that is not a person, and a row with none.
    { kind: 'jog', entity: { eid: 'b', num: 2 }, created: { by: 'nobody' } },
  ]
  let ref = (comp: string, prop: string) =>
    (comp == 'created' && (prop == 'by' || prop == 'via')) ||
    (comp == 'jog' && prop == 'with')
  let seen = mentions(rows, ref)
  assertEquals(seen.eids.sort(), ['a-session', 'ada', 'nobody'])
  // Who the store knows among them is its own word; Ada is a person.
  let out = named(rows, { refs: seen.refs, names: { ada: 'Ada' } })
  assertEquals(out[0].created, {
    by: { eid: 'ada', name: 'Ada' },
    via: 'a-session',
  })
  // Any property that references them, not just the stamp, and only one
  // that references: a note that says her eid is a note.
  assertEquals(out[0].jog, {
    miles: 5,
    with: { eid: 'ada', name: 'Ada' },
    note: 'ada',
  })
  // A stranger keeps the eid the store has always answered with.
  assertEquals(out[1].created, { by: 'nobody' })
  // Nobody to name is the rows themselves, untouched.
  assertEquals(named(rows, { refs: seen.refs, names: {} }), rows)
})
