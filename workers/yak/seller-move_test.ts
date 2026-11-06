// A space's old `stripe` row moves into `seller`, once, and a row a writer
// changed after it was read is left for the writer.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { graph, Stale } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel'
import { directoryDoc } from './facets/directory-vocab.ts'
import { sellerRule } from './seller-move.ts'

let vocab = loadVocab([kernelDoc, directoryDoc, sellerRule.source!])
let store = async (stripe: Record<string, unknown>[]) => {
  let g = graph({ vocab, storage: ram(vocab) })
  await g.apply(
    stripe.map((row, i) => ({ entity: { eid: `s${i}` }, stripe: row })),
    { trusted: true, stamp: false },
  )
  return g
}
let moving = async (g: ReturnType<typeof graph>) => {
  let rows = await g.read(sellerRule.find)
  await g.apply(rows.flatMap((row) => sellerRule.move(row)), { trusted: true })
  return rows.length
}

test('every old row moves into seller, and a second pass finds none', async () => {
  let g = await store([
    { account: 'acct_1', charges_enabled: true, details_submitted: true },
    { account: 'acct_2', details_submitted: true },
    { charges_enabled: false },
  ])
  assertEquals([await moving(g), await moving(g)], [3, 0])
  let rows = await g.read('.entity.eid=s0,s1,s2&?seller&?stripe')
  assertEquals(
    rows.map((r) => [r.entity.eid, r.seller ?? null, r.stripe ?? null]),
    [
      [
        's0',
        { via: 'stripe', account: 'acct_1', ready: true, submitted: true },
        null,
      ],
      [
        's1',
        { via: 'stripe', account: 'acct_2', ready: false, submitted: true },
        null,
      ],
      ['s2', null, null],
    ],
  )
})

test('a row written since it was read is not moved over', async () => {
  let g = await store([{ account: 'acct_1', charges_enabled: false }])
  let [row] = await g.read(sellerRule.find)
  await g.apply([{
    entity: { eid: 's0' },
    stripe: { charges_enabled: true },
  }], { trusted: true })
  await assertRejects(
    async () => await g.apply(sellerRule.move(row), { trusted: true }),
    Stale,
  )
})
