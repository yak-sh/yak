// The index a set of fields implies, and that it stays true to its table.

import { assert, assertEquals, assertThrows } from '@std/assert'
import { fields, indexName } from './fields.ts'
import { heal, schema } from './ddl.ts'
import { find } from './search.ts'
import { shelf, shop, stashed } from './harness.ts'

let all = schema(fields(shop)).join('\n')
let away = schema(fields(shop), stashed).join('\n')

Deno.test('one external-content index per component, over its text columns', () => {
  assert(
    /create virtual table if not exists "book_fts" using fts5\(/.test(all),
    all,
  )
  assert(
    all.includes(`"title", "blurb", content='book', content_rowid='entity'`),
    all,
  )
  assert(all.includes(`"prose", content='review', content_rowid='entity'`), all)
})

Deno.test('three triggers follow each table, delete mirroring insert', () => {
  for (let t of ['book_fts_insert', 'book_fts_delete', 'book_fts_update']) {
    assert(all.includes(`create trigger if not exists "${t}"`), t)
  }
  // Both sides read the same way, or the index keeps words no row says.
  assert(all.includes(`coalesce(new."title", '')`), all)
  assert(all.includes(`coalesce(old."title", '')`), all)
})

Deno.test('a component with no text gets no index', () => {
  assertEquals(schema([]), [])
  assert(!all.includes('entity_fts'), all)
})

Deno.test('the triggers keep the index current as rows come and go', () => {
  let db = shelf()
  let hits = () =>
    Number(
      db.query(
        `select count(*) as n from book_fts where book_fts match ?`,
        ['"dragon"'],
      )[0].n,
    )
  assertEquals(hits(), 2)
  db.query(`update book set blurb = ? where entity = 3`, [
    'A dragon in the kitchen.',
  ])
  assertEquals(hits(), 3)
  db.exec(`delete from book where entity = 3`)
  assertEquals(hits(), 2)
})

Deno.test('heal leaves a true index alone and rebuilds a drifted one', () => {
  let db = shelf()
  assertEquals(heal(db, fields(shop)), [])
  // A row written with the triggers disabled is the drift a heal exists for.
  db.exec(`drop trigger ${indexName('book')}_insert`)
  db.query(`insert into entity (id, eid, num) values (9, 'book-9', 9)`, [])
  db.query(`insert into book (entity, title) values (9, 'Dune')`, [])
  assertEquals(heal(db, fields(shop)), ['book_fts'])
  assertEquals(
    Number(
      db.query(`select count(*) as n from book_fts where book_fts match ?`, [
        '"dune"',
      ])[0].n,
    ),
    1,
  )
})

// A column whose stored value is an ADDRESS, not its own words (@yaks/blob's
// `store: "blob"`). The index has to hold the prose, or a search finds a book
// by its title alone.

Deno.test('a resolved column indexes its words on both sides of the mirror', () => {
  // Every place the address could leak in: the two trigger sides, and the view
  // FTS5 reads a column back out of for `snippet()` and `rebuild`.
  assert(away.includes(`create view if not exists "book_text" as`), away)
  assert(away.includes(`content='book_text'`), away)
  assert(away.includes(`__s."key" = new."blurb"`), away)
  assert(away.includes(`__s."key" = old."blurb"`), away)
  // The column that is its own text is left alone, and so is a component with
  // no resolved column at all.
  assert(away.includes(`coalesce(new."title", '')`), away)
  assert(away.includes(`"prose", content='review'`), away)
  assert(!away.includes('review_text'), away)
})

Deno.test('a search over a stashed column matches its words, not its address', () => {
  let db = shelf(stashed)
  let hits = (word: string) =>
    find(db, fields(shop), word).map((h) => h.entity).sort()
  // The blurb is a key in the row and prose in the stash; the words are what
  // the index holds.
  let held = String(
    db.query(`select blurb from book where entity = 1`, [])[0].blurb,
  )
  assertEquals(held.includes('burglar'), false, held)
  assertEquals(hits('burglar'), ['book-1'])
  // …and the snippet reads back through the view, so what a page shows is the
  // prose rather than the address it is filed under.
  assert(find(db, fields(shop), 'burglar')[0].snippet.includes('burglar'))
  // A row that moves takes its words with it: the delete side resolves the
  // same way the insert side did, so nothing is left behind.
  db.query(`insert into stash (key, words) values (?, ?)`, [
    'words-9',
    'A dragon.',
  ])
  db.query(`update book set blurb = ? where entity = 1`, ['words-9'])
  assertEquals(hits('burglar'), [])
  assertEquals(hits('dragon').includes('book-1'), true)
  db.exec(`delete from book where entity = 1`)
  assertEquals(hits('dragon'), ['book-2', 'review-4'])
})

Deno.test('a rebuild reads the words back, so heal does not undo the resolution', () => {
  let db = shelf(stashed)
  db.exec(`drop trigger ${indexName('book')}_insert`)
  db.query(`insert into entity (id, eid, num) values (9, 'book-9', 9)`, [])
  db.query(`insert into stash (key, words) values ('words-9', 'Spice.')`, [])
  db.query(`insert into book (entity, title, blurb) values (9, 'Dune', ?)`, [
    'words-9',
  ])
  assertEquals(heal(db, fields(shop)), ['book_fts'])
  assertEquals(find(db, fields(shop), 'spice').map((h) => h.entity), ['book-9'])
  // And the words already indexed survived the rebuild.
  assertEquals(find(db, fields(shop), 'burglar').map((h) => h.entity), [
    'book-1',
  ])
})

Deno.test('a rebuild that cannot fix the fault throws, naming both faults', () => {
  let db = shelf()
  // An index whose table is gone can be neither read nor rebuilt.
  db.exec(`drop table review`)
  assertThrows(() => heal(db, fields(shop)))
})
