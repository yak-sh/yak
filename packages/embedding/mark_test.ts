// The mark: set by every write to the vectors, cleared only by a rebuild, and
// readable without any index in the process.

import { assertEquals } from '@std/assert'
import { by, col, eq, lit, NOW, type Stmt, val } from '@yaks/sql'
import { objects } from '@yaks/sqlite'
import { owner, raised, SPINE } from '../sqlite/testing.ts'
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
  db.query({ t: 'delete', from: 'embedding', where: by({ entity: 4 }) })
  assertEquals(dirty(db), true)
  clean(db)
  db.query({
    t: 'update',
    table: 'embedding',
    set: { hash: val('moved') },
    where: by({ entity: 1 }),
  })
  assertEquals(dirty(db), true)
  clean(db)
  // the vector deleted by hand is owed back, and making it is a write
  assertEquals((await sweep(db, fields(shop), embedder)).fresh, 1)
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
// emits, are adopted as they are: install changes nothing in the schema.
let dirtied = (name: string, event: 'insert' | 'update' | 'delete'): Stmt => ({
  t: 'create trigger',
  name,
  ifNot: true,
  timing: 'after',
  event,
  on: 'embedding',
  body: [{
    t: 'update',
    table: 'embedding_index',
    set: { dirty: lit(1) },
    where: eq(col('id'), lit(1)),
  }],
})
let PRIOR: Stmt[] = [
  SPINE,
  {
    ...raised(
      'embedding',
      owner,
      { name: 'model', type: 'text', notNull: true },
      { name: 'hash', type: 'text', notNull: true },
      { name: 'vec', type: 'blob', notNull: true },
      { name: 'at', type: 'text', notNull: true, default: NOW },
    ),
    ifNot: true,
  },
  {
    ...raised(
      'embedding_index',
      {
        name: 'id',
        type: 'integer',
        pk: true,
        check: eq(col('id'), lit(1)),
      },
      { name: 'dirty', type: 'integer', notNull: true },
    ),
    ifNot: true,
  },
  {
    t: 'insert',
    into: 'embedding_index',
    cols: ['id', 'dirty'],
    rows: [[lit(1), lit(0)]],
  },
  dirtied('embedding_index_ai', 'insert'),
  dirtied('embedding_index_au', 'update'),
  dirtied('embedding_index_ad', 'delete'),
]

Deno.test('install adopts prior tables unchanged, adding only its index and queue', () => {
  let db = mem()
  for (let stmt of PRIOR) db.query(stmt)
  let master = () => objects(db)
  let before = master()
  for (let stmt of schema()) db.query(stmt)
  let after = master()
  let added = after.filter((r) => !before.some((b) => b.name == r.name))
  assertEquals(added.map((r) => [r.type, r.name]), [
    ['index', 'embedding_model'],
    ['table', 'embedding_owed'],
  ])
  assertEquals(after.filter((r) => !added.includes(r)), before)
  assertEquals(dirty(db), false)
})
