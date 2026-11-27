// The application composes the two packages. SQLite builds no hidden index;
// FTS owns the schema and the text predicate, including reads inside a tx.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertThrows } from '@std/assert'
import { render } from '@yaks/sql'
import { loadVocab } from '@yaks/vocab'
import { objects, storage } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'
import { adopt, fields, find, indexed, schema, search } from './mod.ts'

test('storage composes FTS explicitly for document and non-document prose', () => {
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
  let indexes = schema(text)
  let store = storage(db, vocab, {
    extend: [search(text)],
    over: () => indexes,
  })
  store.install()
  let fts = () => objects(db).filter((o) => /fts/i.test(String(o.name)))
  // An index is made with its table, by the write that first names it.
  assertEquals(fts(), [])
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

test('.order=search puts the closest match first', () => {
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
  let indexes = schema(text)
  let store = storage(db, vocab, {
    extend: [search(text, db)],
    over: () => indexes,
  })
  store.install()
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

test('a component marked found: false keeps its wearers out of every word search', () => {
  let vocab = loadVocab({
    $defs: {
      doc: {
        component: true,
        type: 'object',
        properties: { title: { type: 'string', search: true } },
      },
      set: { component: true, type: 'object', found: false },
    },
  })
  let db = open(':memory:')
  using _close = { [Symbol.dispose]: () => db.close() }
  let text = fields(vocab)
  let indexes = schema(text)
  let store = storage(db, vocab, {
    extend: [search(text, db)],
    over: () => indexes,
  })
  store.install()
  store.tx((tx) =>
    tx.patch([
      { entity: { eid: 'kept' }, doc: { title: 'use grams' } },
      { entity: { eid: 'gone' }, doc: { title: 'use grams, gate it' } },
    ])
  )
  let read = (line: string) => store.read(line).map((b) => b.entity.eid).sort()
  let hits = () => find(db, text, 'grams').map((h) => h.entity).sort()
  // Before anything wears it, no table stands for it to be asked.
  assertEquals(read('grams'), ['gone', 'kept'])
  assertEquals(hits(), ['gone', 'kept'])
  store.tx((tx) => tx.patch([{ entity: { eid: 'gone' }, set: {} }]))
  assertEquals(read('grams'), ['kept'])
  assertEquals(read('grams .limit=5'), ['kept'])
  assertEquals(read('grams .order=search'), ['kept'])
  assertEquals(hits(), ['kept'])
  // Only words leave it out: a read that names it still answers it.
  assertEquals(read('.set'), ['gone'])
  // Its text stayed indexed, so the mark coming off finds it at once.
  store.tx((tx) => tx.patch([{ entity: { eid: 'gone' }, set: null }]))
  assertEquals(read('grams'), ['gone', 'kept'])
})

test('UUID search indexes keep membership, snippets and substring matches after a rename', () => {
  let word = () => `urn:uuid:${crypto.randomUUID()}`
  let id = word(), property = word()
  let vocab = (comp: string, prop: string) =>
    loadVocab({
      $defs: {
        [comp]: {
          $id: id,
          component: true,
          properties: {
            [prop]: {
              $id: property,
              type: 'string',
              search: true,
              contains: true,
            },
          },
        },
      },
    })
  let db = open(':memory:')
  using _close = { [Symbol.dispose]: () => db.close() }
  let bind = (v: ReturnType<typeof vocab>) => {
    let text = indexed(v)
    return storage(db, v, {
      extend: [search(text, db)],
      over: (layout) => schema(text, {}, layout),
    })
  }
  let v = vocab('doc', 'title'), s = bind(v)
  s.tx((tx) =>
    tx.patch([{ entity: { eid: 'b' }, doc: { title: 'Kettle of copper' } }])
  )
  assertEquals(s.read('copper').map((b) => b.entity.eid), ['b'])
  let renamed = vocab('note', 'heading'), next = bind(renamed)
  assertEquals(next.read('copper .order=search .limit=1')[0].note, {
    heading: 'Kettle of copper',
  })
  assertEquals(next.read('.note.heading~=kett').map((b) => b.entity.eid), ['b'])
  assert(find(db, fields(renamed), 'copper')[0].snippet.includes('copper'))
  assertEquals(adopt(db, indexed(renamed), {}, { heal: false }), {
    recut: [],
    dropped: [],
    healed: [],
  })
  next.tx((tx) =>
    tx.patch([{ entity: { eid: 'b' }, note: { heading: 'Tin cup' } }])
  )
  assertEquals(next.read('copper'), [])
  assertEquals(next.read('tin').map((b) => b.entity.eid), ['b'])
})
