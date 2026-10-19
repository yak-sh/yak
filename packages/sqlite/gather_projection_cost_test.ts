// A hook asking for one facet must not pay for an unrelated derived aggregate.
import { equal, ok, test } from '@yaks/testing'
import { gather, holding } from '@yaks/graph'
import { type BindOpts, cast, col, fn, select, sub, table } from '@yaks/sql'
import { storage } from './mod.ts'
import { seed, shop, stepping } from './testing.ts'

let { driver, steps } = stepping()
let opts: BindOpts = {
  derived: {
    'doc.body': {
      tag: 'text',
      expr: () =>
        sub(select({
          cols: [cast(fn('sum', col('stars')), 'text')],
          from: table('review'),
        })),
    },
  },
}
let s = storage(driver, shop, opts)
s.install()
seed(s, [
  { entity: { eid: 'p' }, product: { price: 2 }, doc: { title: 'Wide' } },
  ...Array.from({ length: 1000 }, (_, i) => ({
    entity: { eid: `r${i}` },
    review: { stars: 1, product: 'p' },
  })),
])

// A fresh storage keeps no seeded bundles. The gather may retain its answers
// inside this transaction, but cannot rely on values from a previous write.
let cold = storage(driver, shop, opts)
cold.install()
// Prepare both SQL shapes without retaining row values across transactions.
let rollback = Error('warm shapes')
await cold.tx(async (tx) => {
  await tx.get(['p'], ['product'])
  await tx.get(['p'], ['doc'])
  throw rollback
}).catch((error) => {
  if (error !== rollback) throw error
})

test('named gather misses avoid unrelated derived row work', async () => {
  await cold.tx(async (tx) => {
    let held = holding(tx, shop, await gather(tx, shop, []))
    let start = steps()
    let [before] = await held.get(['p'], ['product'])
    let narrow = steps() - start
    equal(before.product, { price: 2 })
    ok(narrow < 500, `${narrow} VM steps for a named cache miss`)
    let [wider] = await held.get(['p'], ['product', 'doc'])
    equal(wider === before, true)
    equal(wider.doc, { title: 'Wide', body: '1000.0' })
  })
})
