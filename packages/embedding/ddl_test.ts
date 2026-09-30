// The tables: they hold a vector per entity, installing them again keeps them,
// a store made while their key was named `entity` is healed, and no reader of
// component tables takes a vector for a component.

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { graph } from '@yaks/graph'
import { col, insert, scan, tally } from '@yaks/sql'
import { componentTables, drift, storage } from '@yaks/sqlite'
import { loadVocab } from '@yaks/vocab'
import { entity, raised, SPINE, text } from '../sqlite/testing.ts'
import { DIRTY, OWED, rekey, schema, TABLE } from './ddl.ts'
import { fields } from './fields.ts'
import { vectorOf } from './near.ts'
import { pack } from './vector.ts'
import { due } from './owed.ts'
import { put, sweep } from './sweep.ts'
import { embedder, mem, stocked } from './testing.ts'

let owners = (db: ReturnType<typeof mem>, name: string) =>
  scan(db, name, undefined, ['owner']).map((r) => r.owner)

test('the schema is idempotent — installing twice is a no-op', async () => {
  let db = await stocked()
  for (let stmt of schema()) db.query(stmt)
  assertEquals(tally(db, TABLE), 4)
})

test('a vector is no component: classification and its audit pass it by', async () => {
  let sql = mem()
  let vocab = loadVocab([archetypeDoc, {
    $defs: {
      doc: {
        component: true,
        type: 'object',
        properties: { title: { type: 'string', search: true } },
      },
    },
  }])
  let store = storage(sql, vocab)
  store.install()
  for (let stmt of schema()) sql.query(stmt)
  let g = graph({ storage: store, vocab, plugins: [archetypes()] })
  await g.apply([{ entity: { eid: 'a' }, doc: { title: 'The Hobbit' } }])
  await sweep(sql, fields(vocab), embedder)
  assert(vectorOf(sql, 'a', embedder.model))
  assertEquals(tally(sql, DIRTY), 1)
  let found = componentTables(sql)
  assertEquals([TABLE, DIRTY, OWED].filter((t) => found.includes(t)), [])
  assertEquals(drift(sql).drifted, 0)
})

test('a store keyed by entity before the rename is healed, rows and all', () => {
  let db = mem()
  let key = { name: 'entity', type: 'integer', pk: true }
  let blob = { name: 'vec', type: 'blob' }
  for (
    let stmt of [
      SPINE,
      raised(TABLE, key, text('model'), text('hash'), blob, text('at')),
      raised(DIRTY, key),
      raised(OWED, key, { name: 'n', type: 'integer' }),
    ]
  ) db.query(stmt)
  // A dirty-set trigger as it stood: the old key on both sides.
  db.query({
    t: 'create trigger',
    name: `${DIRTY}_ai`,
    timing: 'after',
    event: 'insert',
    on: TABLE,
    body: [{
      t: 'insert',
      into: DIRTY,
      cols: ['entity'],
      rows: [[col('entity', 'new')]],
      upsert: [{ on: [col('entity')] }],
    }],
  })
  entity(db, 1, 'e-1')
  entity(db, 2, 'e-2')
  let vec = new Float32Array([1, 0])
  db.query(insert(TABLE, { entity: 1, model: 'm', hash: 'h', vec: pack(vec) }))
  db.query(insert(OWED, { entity: 2, n: 3 }))
  rekey(db)
  for (let stmt of schema()) db.query(stmt)
  assert(vectorOf(db, 'e-1', 'm'))
  assertEquals(due(db, 10), [{ owner: 2, n: 3 }])
  put(db, 2, 'm', 'new', vec)
  assertEquals(owners(db, DIRTY), [1, 2])
  rekey(db) // healed once, it has nothing left to do
  assertEquals(owners(db, TABLE), [1, 2])
})
