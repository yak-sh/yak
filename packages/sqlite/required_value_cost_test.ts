import { archetypeDoc } from '@yaks/archetype'
import { equal, ok, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { storage } from './mod.ts'
import { seed, stepping } from './testing.ts'

let vocab = loadVocab([archetypeDoc, {
  $defs: {
    recorded: { component: true },
    item: { component: true, properties: { label: { type: 'string' } } },
  },
}])
let { driver, steps } = stepping()
let store = storage(driver, vocab, { counts: 'eager' })
store.install()
seed(store, [
  ...Array.from({ length: 2000 }, (_, i) => ({
    entity: { eid: `record-${i}` },
    recorded: {},
  })),
  { entity: { eid: 'shared' }, recorded: {}, item: { label: 'blue' } },
  { entity: { eid: 'unrecorded' }, item: { label: 'blue' } },
  { entity: { eid: 'other' }, recorded: {}, item: { label: 'red' } },
])

test('an unindexed required value can drive a read from the smaller table', async () => {
  let start = steps()
  let rows = await store.rows('.recorded&.item.label=blue')
  let cost = steps() - start
  equal(rows.map((row) => row.eid), ['shared'])
  ok(cost < 1000, `${cost} VM steps for ${rows.length} matching items`)
})
