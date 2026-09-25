// The application composes the two packages. SQLite builds no hidden index;
// FTS owns the schema and the text predicate, including reads inside a tx.
import { assert, assertEquals, assertThrows } from '@std/assert'
import { render } from '@yaks/sql'
import { loadVocab } from '@yaks/vocab'
import { objects, storage } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'
import { fields, schema, search } from './mod.ts'

Deno.test('storage composes FTS explicitly for document and non-document prose', () => {
  let vocab = loadVocab({
    $defs: {
      doc: {
        component: true,
        type: 'object',
        properties: {
          title: { type: 'string', search: true },
          body: { type: 'string', search: true },
        },
      },
      review: {
        component: true,
        type: 'object',
        properties: { prose: { type: 'string', search: true } },
      },
    },
  })
  let db = open(':memory:')
  using _close = { [Symbol.dispose]: () => db.close() }
  let text = fields(vocab)
  let store = storage(db, vocab, { extend: [search(text)] })
  store.install()
  let fts = () => objects(db).filter((o) => /fts/i.test(String(o.name)))
  assertEquals(fts(), [])
  for (let stmt of schema(text)) db.query(stmt)
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
  assertEquals(found('ceramic .review'), ['b'])
  store.tx((tx) => {
    tx.patch([{ entity: { eid: 'a' }, doc: { body: 'smooth enamel' } }])
    assertEquals(tx.read('enamel').map((b) => b.entity.eid), ['a'])
    tx.patch([{ entity: { eid: 'b' }, review: null }])
  })
  assertEquals(found('ceramic'), [])
  assertEquals(found('enamel'), ['a'])
  assert(!store.ddl().some((s) => render(s).sql.includes('fts5')))
})

Deno.test('.order=search puts the closest match first', () => {
  let vocab = loadVocab({
    $defs: {
      doc: {
        component: true,
        type: 'object',
        properties: {
          title: { type: 'string', search: true },
          body: { type: 'string', search: true },
        },
      },
    },
  })
  let db = open(':memory:')
  using _close = { [Symbol.dispose]: () => db.close() }
  let text = fields(vocab)
  let store = storage(db, vocab, { extend: [search(text, db)] })
  store.install()
  for (let stmt of schema(text)) db.query(stmt)
  store.tx((tx) =>
    tx.patch([
      {
        entity: { eid: 'far' },
        doc: { title: 'notes', body: 'a mug, among many other things kept' },
      },
      { entity: { eid: 'near' }, doc: { title: 'mug', body: "mug o'mug" } },
      { entity: { eid: 'none' }, doc: { title: 'plate', body: 'plate' } },
    ])
  )
  let found = (line: string) => store.read(line).map((b) => b.entity.eid)
  assertEquals(found('mug .order=search'), ['near', 'far'])
  assertEquals(found('mug .order=-search'), ['far', 'near'])
  assertEquals(found("o'mug .order=search"), ['near'])
  assertThrows(() => found('.doc .order=search'), Error, 'nothing to rank by')
})
