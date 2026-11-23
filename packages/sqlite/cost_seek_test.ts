import { archetypeDoc } from '@yaks/archetype'
import { modelDoc } from '@yaks/model/vocab'
import { provenanceDoc } from '@yaks/provenance/vocab'
import { equal, ok, test } from '@yaks/testing'
import { loadVocab, pick } from '@yaks/vocab'
import { storage } from './mod.ts'
import { seed, stepping } from './testing.ts'

let words = pick(modelDoc, ['cost'])
let before = structuredClone(words)
delete before.$defs!.cost.properties!.dollars.index
let vocab = (cost: typeof words) =>
  loadVocab([archetypeDoc, pick(provenanceDoc, ['created']), cost])
let { driver, steps } = stepping()
let previous = storage(driver, vocab(before), { counts: 'lazy' })
previous.install()

let at = (i: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()
seed(previous, [
  ...Array.from({ length: 512 }, (_, i) => ({
    entity: { eid: `history-${i}` },
    created: { at: at(i + 4) },
    ...i % 2 ? { cost: { dollars: 0.001, reported: false } } : {},
  })),
  ...Array.from({ length: 4 }, (_, i) => ({
    entity: { eid: `receipt-${i}` },
    created: { at: at(i) },
    cost: { dollars: 0.00103, reported: i % 2 == 0 },
  })),
])

let store = storage(driver, vocab(words), { counts: 'lazy' })
store.install()

for (
  let [dollars, expected] of [
    [0.00102, []],
    [0.00103, ['receipt-3', 'receipt-2', 'receipt-1']],
  ] as const
) {
  test(`an exact cost page seeks existing receipts for ${dollars}`, async () => {
    let start = steps()
    let rows = await store.rows(
      `.cost.dollars=${dollars} .order=-created.at .limit=3`,
    )
    let cost = steps() - start
    equal(rows.map((row) => row.eid), [...expected])
    ok(cost < 600, `${cost} VM steps for ${rows.length} receipts`)
  })
}
