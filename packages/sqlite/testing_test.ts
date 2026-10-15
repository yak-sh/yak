// A prepared schema is ready to use, and each store owns its writes.
import { equal, test } from '@yaks/testing'
import { assertIsError, assertStringIncludes } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { col, insert, select, table } from '@yaks/sql'
import { schema } from './mod.ts'
import { preparedDriver, preparedStore, snapshot } from './testing.ts'

let vocab = loadVocab({
  $defs: {
    item: {
      component: true,
      properties: {
        name: { type: 'string', unique: true },
        to: { type: 'string', ref: 'item', death: 'cascade' },
      },
    },
  },
})
let names = schema(vocab).flatMap((s) => 'name' in s ? [s.name] : []).sort()
let empty = snapshot(vocab)
let extra = [insert('entity', { eid: 'fixture' })]
let seeded = snapshot(vocab, {}, extra)
extra[0] = insert('entity', { eid: 'changed' })
let changed = snapshot(vocab, {}, extra)
let stores = [preparedStore(vocab, {}, empty), preparedStore(vocab, {}, empty)]
let entities = select({ cols: [col('eid')], from: table('entity') })
let objects = select({
  cols: [col('name')],
  from: table('sqlite_schema'),
  order: [col('name')],
})

test('prepared stores keep writes private', () => {
  using one = stores[0]
  using two = stores[1]
  one.statements.query(insert('entity', { eid: 'a' }))
  equal(one.statements.query(entities), [{ eid: 'a' }])
  equal(two.statements.query(entities), [])
})

let copy = preparedStore(vocab, {}, empty)
test('prepared stores retain their complete schema', () => {
  using store = copy
  equal(
    store.statements.query(objects).map((r) => r.name).filter((name) =>
      names.includes(String(name))
    ),
    names,
  )
})

let privateRows: unknown[], otherRows: unknown[], refused: unknown
{
  using one = preparedDriver(seeded)
  using two = preparedDriver(seeded)
  privateRows = one.query(entities)
  one.query(insert('entity', { eid: 'private' }))
  otherRows = two.query(entities)
  try {
    two.query(insert('item', { entity: 99, name: 'orphan' }))
  } catch (error) {
    refused = error
  }
}
test('prepared drivers retain fixture rows, isolate writes and enforce keys', () => {
  equal(privateRows, [{ eid: 'fixture' }])
  equal(otherRows, [{ eid: 'fixture' }])
  assertIsError(refused)
  assertStringIncludes(refused.message, 'FOREIGN KEY')
})

let retained = [preparedDriver(seeded), preparedDriver(changed)]
test('snapshots retain the fixture rows their extra statements request', () => {
  using one = retained[0]
  using two = retained[1]
  equal(one.query(entities), [{ eid: 'fixture' }])
  equal(two.query(entities), [{ eid: 'changed' }])
})
