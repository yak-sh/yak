// Deferred transaction projections include pending rows in the same shape.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { store } from './testing.ts'

let s = await store()
await s.tx((tx) =>
  tx.patch([{
    entity: { eid: 'one' },
    doc: { title: 'One' },
    product: { price: 7 },
  }, {
    entity: { eid: 'pending' },
    doc: { title: 'Seed' },
    product: { price: 7 },
  }])
)

let projected = await s.tx((tx) =>
  tx.read('.doc.title=One', undefined, ['product'])
)
let identity = await s.tx((tx) => tx.read('.doc', undefined, []))
let whole = await s.tx((tx) => tx.read('.doc.title=One'))

test('D1 transaction read projections match full rows before selecting components', () => {
  assertEquals(projected[0].product, { price: 7 })
  assertEquals(projected[0].doc, undefined)
})

test('D1 transaction reads can select identity alone', () => {
  assertEquals(identity[0].doc, undefined)
})

test('D1 transaction reads retain whole bundles by default', () => {
  assertEquals(whole[0].doc, { title: 'One' })
})

let pendingRows = await s.tx(async (tx) => {
  await tx.patch([{
    entity: { eid: 'pending' },
    doc: { title: 'Pending' },
  }])
  return tx.read('.doc.title=Pending', undefined, ['product'])
})

test('D1 transaction read projections shape pending matches after overlay', () => {
  assertEquals(pendingRows[0].product, { price: 7 })
  assertEquals(pendingRows[0].doc, undefined)
})
