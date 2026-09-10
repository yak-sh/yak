// The application composes the two packages. SQLite builds no hidden index;
// FTS owns the schema and the text predicate, including reads inside a tx.
import { assert, assertEquals } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { type Driver, storage } from '@yaks/sqlite'
import { Database } from '@yaks/sqlite/db'
import { fields, schema, search } from './mod.ts'

Deno.test('storage composes FTS explicitly for document and non-document prose', () => {
  let vocab = loadVocab({
    $defs: {
      doc: {
        type: 'object',
        properties: { title: { type: 'string' }, body: { type: 'string' } },
      },
      review: {
        type: 'object',
        properties: { prose: { type: 'string' } },
      },
    },
  })
  let sqlite = new Database(':memory:')
  using _close = { [Symbol.dispose]: () => sqlite.close() }
  let db: Driver = {
    query: (sql, params) => sqlite.prepare(sql).all(...params),
    exec: (sql) => sqlite.exec(sql),
  }
  let text = fields(vocab)
  let store = storage(db, vocab, { extend: [search(text)] })
  store.install()
  assertEquals(
    db.query("select name from sqlite_master where name like '%fts%'", []),
    [],
  )
  for (let stmt of schema(text)) db.exec(stmt)
  // Installing storage again must neither replace nor duplicate FTS objects.
  store.install()
  store.tx((tx) =>
    tx.patch([
      {
        entity: { eid: 'a' },
        doc: { title: 'Blue mug', body: 'glazed ceramic' },
      },
      { entity: { eid: 'b' }, review: { prose: 'ceramic craftsmanship' } },
    ])
  )
  let found = (line: string) => store.read(line).map((b) => b.entity.eid).sort()
  assertEquals(found('mug'), ['a'])
  assertEquals(found('ceramic'), ['a', 'b'])
  assertEquals(found('ceramic .review!'), ['b'])
  store.tx((tx) => {
    tx.patch([{ entity: { eid: 'a' }, doc: { body: 'smooth enamel' } }])
    assertEquals(tx.read('enamel').map((b) => b.entity.eid), ['a'])
    tx.patch([{ entity: { eid: 'b' }, review: null }])
  })
  assertEquals(found('ceramic'), [])
  assertEquals(found('enamel'), ['a'])
  assert(!store.ddl().some((s) => s.includes('fts5')))
})
