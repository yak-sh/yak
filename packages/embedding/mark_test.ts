// The mark: set by every write to the vectors, cleared only by a rebuild, and
// readable without any index in the process.

import { assertEquals } from '@std/assert'
import { fields } from './fields.ts'
import { schema } from './ddl.ts'
import { sweep } from './sweep.ts'
import { clean, dirty, mark, state } from './mark.ts'
import { embedder, mem, shelf, shop, stocked } from './testing.ts'

Deno.test('a fresh mark is dirty: an index never built is owed one', () => {
  assertEquals(dirty(shelf()), true)
})

Deno.test('a rebuild cleans it and the next write sets it again', async () => {
  let db = await stocked()
  clean(db)
  assertEquals(dirty(db), false)
  db.exec(`delete from embedding where entity = 4`)
  assertEquals(dirty(db), true)
  clean(db)
  db.exec(`update embedding set hash = 'moved' where entity = 1`)
  assertEquals(dirty(db), true)
  clean(db)
  assertEquals(await sweep(db, fields(shop), embedder), { fresh: 2, left: 0 })
  assertEquals(dirty(db), true)
})

Deno.test('mark() sets it by hand', async () => {
  let db = await stocked()
  clean(db)
  mark(db)
  assertEquals(dirty(db), true)
})

Deno.test('state() reports the mark beside the corpus', async () => {
  let db = await stocked()
  let s = state(db)
  assertEquals([s.dirty, s.rows, typeof s.newest], [true, 4, 'string'])
  assertEquals(state(shelf()), { dirty: true, rows: 0, newest: null })
})

// Tables an application already built by hand, in the shape this package
// emits, are adopted as they are: install changes nothing in sqlite_master.
let PRIOR = [
  `create table entity (id integer primary key, eid text not null unique, num integer)`,
  `create table if not exists embedding (
    entity integer primary key references entity(id),
    model  text not null,
    hash   text not null,
    vec    blob not null,
    at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,
  `create table if not exists embedding_index (
    id    integer primary key check (id = 1),
    dirty integer not null
  )`,
  `insert into embedding_index (id, dirty) values (1, 0)`,
  `create trigger if not exists embedding_index_ai after insert on embedding
  begin update embedding_index set dirty = 1 where id = 1; end`,
  `create trigger if not exists embedding_index_au after update on embedding
  begin update embedding_index set dirty = 1 where id = 1; end`,
  `create trigger if not exists embedding_index_ad after delete on embedding
  begin update embedding_index set dirty = 1 where id = 1; end`,
]

Deno.test('install adopts prior tables unchanged, adding only its index', () => {
  let db = mem()
  for (let stmt of PRIOR) db.exec(stmt)
  let master = () =>
    db.query(`select type, name, sql from sqlite_master order by name`, [])
  let before = master()
  for (let stmt of schema()) db.exec(stmt)
  let after = master()
  let added = after.filter((r) => !before.some((b) => b.name == r.name))
  assertEquals(added.map((r) => [r.type, r.name]), [[
    'index',
    'embedding_model',
  ]])
  assertEquals(after.filter((r) => r.name != 'embedding_model'), before)
  assertEquals(dirty(db), false)
})
