// A prepared schema is ready to use, and each store owns its writes.
import { equal, test, throws } from '@yaks/testing'
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
let one = preparedStore(vocab, {}, empty)
let entities = select({ cols: [col('eid')], from: table('entity') })
let objects = select({
  cols: [col('name')],
  from: table('sqlite_schema'),
  order: [col('name')],
})

test('prepared stores keep writes private and retain their complete schema', () => {
  one.statements.query(insert('entity', { eid: 'a' }))
  equal(one.statements.query(entities), [{ eid: 'a' }])
  using two = preparedStore(vocab, {}, empty)
  equal(two.statements.query(entities), [])
  equal(
    two.statements.query(objects).map((r) => r.name).filter((name) =>
      names.includes(String(name))
    ),
    names,
  )
})

test('prepared drivers retain fixture rows, isolate writes and enforce keys', async () => {
  using one = preparedDriver(seeded)
  using two = preparedDriver(seeded)
  equal(one.query(entities), [{ eid: 'fixture' }])
  one.query(insert('entity', { eid: 'private' }))
  equal(two.query(entities), [{ eid: 'fixture' }])
  await throws(
    () => two.query(insert('item', { entity: 99, name: 'orphan' })),
    'FOREIGN KEY',
  )
})

test('snapshots retain the fixture rows their extra statements request', () => {
  using one = preparedDriver(seeded)
  using two = preparedDriver(changed)
  equal(one.query(entities), [{ eid: 'fixture' }])
  equal(two.query(entities), [{ eid: 'changed' }])
})
