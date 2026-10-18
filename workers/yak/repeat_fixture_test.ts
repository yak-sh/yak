// The retained-fixture fast path leaves graph reads, references and presence
// identical to storage patches, including varying values.
import { equal, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import archetypes from '../../packages/archetype/vocab.json' with {
  type: 'json',
}
import { driver, storage } from '@yaks/durable-object'
import { durable, shop } from '../../packages/durable-object/testing.ts'
import { as, count, fn, lit, op, select, table } from '@yaks/sql'
import { index, repeatFixture } from './repeat_fixture.ts'

let db = durable()
addEventListener('unload', () => db[Symbol.dispose]())
let vocab = loadVocab([...shop.docs, archetypes])
let s = storage(db, vocab)
s.install()
let g = graph({ storage: s, vocab })
let maker = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
await g.storage.tx((tx) =>
  tx.patch([{ entity: { eid: maker }, doc: { title: 'Maker' } }])
)
let eid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
await repeatFixture(
  g,
  db,
  4,
  {
    entity: { eid: eid(0) },
    product: { sku: 'sku-0', maker, price: 1, available: true },
    doc: { title: 'Repeated', body: 'Retained body' },
  },
  fn('printf', lit('00000000-0000-4000-8000-%012d'), index),
  {
    product: {
      sku: op('||', lit('sku-'), index),
      price: op('+', index, lit(1)),
    },
  },
)
await repeatFixture(g, db, 0, {
  entity: { eid: eid(9) },
  doc: { title: 'Absent' },
}, lit(eid(9)))

// Prepare the graph's read doors once, as the platform prepares its schema.
await g.get([eid(3)], ['product', 'doc'])
let d = driver(db)
let cardinality = select({ cols: [as(count(), 'n')], from: table('product') })
d.query(cardinality)
s.get([eid(9)], ['doc'])

test('repeated retained rows preserve graph values and references', async () => {
  let rows = await g.get([eid(3)], ['product', 'doc'])
  equal(
    rows.map((r) => [r.entity?.eid, r.product, r.doc]),
    [3].map((n) => [
      eid(n),
      { sku: `sku-${n}`, maker, price: n + 1, available: true },
      { title: 'Repeated', body: 'Retained body' },
    ]),
  )
})

test('repeated retained rows keep exact cardinality', () => {
  equal(Number(d.query(cardinality)[0].n), 4)
})

test('an empty repetition writes no retained rows', () => {
  equal(s.get([eid(9)], ['doc']), [])
})
