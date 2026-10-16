// A root selection never restricts text owned by one of its children.
import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { type And, parse, type Pred, text as word } from '@yaks/query'
import {
  among,
  col,
  compile,
  type Extension,
  insert,
  select,
  TRUE,
} from '@yaks/sql'
import { match } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { bindings, matched } from '../sqlite/rules.ts'
import { driver } from '../sqlite/native.ts'
import { fields } from './fields.ts'
import { search } from './compile.ts'
import { shelf, shop } from './testing.ts'

let db = shelf(), extension = search(fields(shop), db)
let child = (not = false): Pred => ({
  kind: 'pred',
  path: ['reviews'],
  op: '!',
  value: null,
  not,
  where: {
    kind: 'and',
    clauses: [
      word('dragon'),
      ...parse('.review.book.book.price=12').clauses,
    ],
  },
})
for (
  let [name, query, visibility, expected] of [
    ['a child outside root candidates', '.entity.eid=book-1', undefined, [
      'book-1',
    ]],
    ['a hidden child entity', '.entity.eid=book-1', { entity: '.book' }, []],
    ['a permitted child component', '.entity.eid=book-1', {
      components: { review: '.entity.eid=review-4' },
    }, ['book-1']],
    ['a hidden child component', '.entity.eid=book-1', {
      components: { review: '.entity.eid=book-1' },
    }, []],
  ] as const
) {
  let asked: And = {
    kind: 'and',
    clauses: [...parse(query).clauses, child()],
  }
  let statement = compile(asked, shop, { visibility, extend: [extension] })
  test(`text membership: ${name}`, () => {
    assertEquals(db.query(statement).map((r) => r.eid), [...expected])
  })
}
for (
  let [parent, expected] of [['book-1', []], ['book-2', ['book-2']]] as const
) {
  let asked: And = {
    kind: 'and',
    clauses: [...parse(`.entity.eid=${parent}`).clauses, child(true)],
  }
  let statement = compile(asked, shop, { extend: [extension] })
  test(`negative child text keeps its child owner scope: ${parent}`, () => {
    assertEquals(db.query(statement).map((r) => r.eid), [...expected])
  })
}

let patterns = match(
  '.entity.eid=book-1 "dragon"; .entity.eid=book-2 "dragon"',
)
let overlay = match('.entity.eid=book-1 .book.price=13 "dragon"')
let prices = loadVocab({
  $defs: {
    entity: { component: true, properties: {} },
    book: { component: true, properties: { price: { type: 'number' } } },
  },
})
let matching = driver(new Database(':memory:'))
for (
  let [name, columns] of [
    ['entity', [{ name: 'id', type: 'integer', pk: true }, {
      name: 'eid',
      type: 'text',
      unique: true,
    }, { name: 'num', type: 'integer' }]],
    ['book', [{ name: 'entity', type: 'integer', pk: true }, {
      name: 'price',
      type: 'real',
    }]],
    ['tombstone', [{ name: 'entity', type: 'integer', pk: true }]],
  ] as const
) matching.query({ t: 'create table', name, cols: [...columns] })
matching.query(insert('entity', { id: 1, eid: 'book-1', num: 1 }, {
  id: 2,
  eid: 'book-2',
  num: 2,
}))
matching.query(insert('book', { entity: 1, price: 12 }, {
  entity: 2,
  price: 10,
}))
let selected: Extension = {
  name: 'selected',
  compile: {
    text: (_clause, site) => {
      let within = site.screen?.()
      return within
        ? among(
          site.owner,
          select({
            cols: [col('id')],
            from: site.share(within),
          }),
        )
        : TRUE
    },
  },
}
let opts = {
  exactIds: true,
  extend: [selected],
}
let overlayMatches = [overlay]
let overlayBatch = [{ entity: { eid: 'book-1' }, book: { price: 13 } }]
let overlayCovers = ['book']
// Prepare inputs above; exercise the public matcher inside each case.
test('shared text screens survive multiple rule patterns', () => {
  assertEquals(
    matched(matching, patterns, prices, opts).map((r) => r.entities),
    [['book-1', 'book-2']],
  )
})
test('shared text screens read batch overlays', () => {
  assertEquals(
    bindings(
      matching,
      prices,
      overlayMatches,
      overlayBatch,
      overlayCovers,
      opts,
    ).map((rows) => rows.map((r) => r.entities)),
    [[['book-1']]],
  )
})

let duplicate = compile(parse('dragon .entity.eid=book-1,book-1'), shop, {
  exactIds: true,
  extend: [search([{ comp: 'book', prop: 'blurb' }], db)],
})
test('a finite text membership returns repeated identity operands once', () => {
  assertEquals(db.query(duplicate).map((r) => r.eid), ['book-1'])
})
import '../sqlite/sqlitepath.ts'
import { Database } from '@db/sqlite'
