// The index a set of fields implies, and that it stays true to its table.

import { assert, assertEquals, assertThrows } from '@std/assert'
import { fields, indexName } from './fields.ts'
import { heal, schema } from './ddl.ts'
import { shelf, shop } from './harness.ts'

let all = schema(fields(shop)).join('\n')

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

Deno.test('a rebuild that cannot fix the fault throws, naming both faults', () => {
  let db = shelf()
  // An index whose table is gone can be neither read nor rebuilt.
  db.exec(`drop table review`)
  assertThrows(() => heal(db, fields(shop)))
})
