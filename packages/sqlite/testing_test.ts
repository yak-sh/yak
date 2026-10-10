// A prepared schema is ready to use, and each store owns its writes.
import { equal, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { col, insert, select, table } from '@yaks/sql'
import { schema } from './mod.ts'
import { preparedStore, snapshot } from './testing.ts'

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
let entities = select({ cols: [col('eid')], from: table('entity') })

test('prepared stores keep writes private and retain their complete schema', () => {
  using one = preparedStore(vocab, {}, empty)
  one.statements.query(insert('entity', { eid: 'a' }))
  equal(one.statements.query(entities), [{ eid: 'a' }])
  using two = preparedStore(vocab, {}, empty)
  equal(two.statements.query(entities), [])
  equal(
    two.statements.query(select({
      cols: [col('name')],
      from: table('sqlite_schema'),
      order: [col('name')],
    })).map((r) => r.name).filter((name) => names.includes(String(name))),
    names,
  )
})
