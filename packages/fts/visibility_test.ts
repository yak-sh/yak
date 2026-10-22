import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parse } from '@yaks/query'
import { compile, insert } from '@yaks/sql'
import { fields } from './fields.ts'
import { search } from './compile.ts'
import { find, ranked, screens } from './search.ts'
import { named, term } from './term.ts'
import { entity, shelf, shop } from './testing.ts'

let text = fields(shop)
let db = shelf()
entity(db, 5, 'mixed')
db.query(insert('book', {
  entity: 5,
  title: 'Dragon',
  blurb: 'Public dragon adventures',
  price: 10,
}))
db.query(insert('review', {
  entity: 5,
  prose: 'dragon privateword',
  stars: 1,
  book: 1,
}))
let opts = {
  visibility: {
    entity: '.entity.eid!=book-2',
    components: { review: '.entity.eid=review-4' },
  },
}
let extension = search(text, db)
let ids = (q: string) =>
  db.query(compile(parse(q), shop, { ...opts, extend: [extension] }))
    .map((r) => r.eid).sort()
let sources = screens(text, shop, opts)
// The owners `.order=search` ranks for the words, as compile.ts asks.
let rank = (words: string) =>
  db.query(ranked(text, term(words), { screens: sources, name: named(words) })!)
    .map((r) => r.owner)
// Open the selection's, the ranker's and the standalone search's statements
// beside the fixture's search indexes, so each case times only its search.
ids('privateword')
rank('privateword')
find(db, text, 'privateword', { screens: sources })

test('private indexed text cannot select a public entity', () =>
  assertEquals(ids('privateword'), []))
test('private indexed text cannot affect count', () =>
  assertEquals(
    db.query(compile(parse('privateword .count'), shop, {
      ...opts,
      extend: [extension],
    })),
    [{ value: '', n: 0 }],
  ))
test('search ranking excludes hidden entities and private matching arms', () =>
  assertEquals(rank('privateword'), []))
test('standalone search excludes private matching sources', () =>
  assertEquals(find(db, text, 'privateword', { screens: sources }), []))
test('snippets come from a permitted matching source on a public entity', () => {
  let mixed = find(db, text, 'dragon', { screens: sources })
    .find((hit) => hit.entity == 'mixed')!
  assertEquals(mixed.snippet.includes('privateword'), false)
})
test('standalone ranking excludes a hidden owner', () =>
  assertEquals(
    find(db, text, 'dragon', { screens: sources })
      .some((hit) => hit.entity == 'book-2'),
    false,
  ))
