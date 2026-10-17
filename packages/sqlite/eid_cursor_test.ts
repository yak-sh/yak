// Identity pages seek the entity's EID index instead of sorting every owner.
import { equal, ok, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { storage } from './mod.ts'
import { stepping } from './testing.ts'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'

let vocab = loadVocab([kernelDoc, {
  $defs: {
    session: { component: true, type: 'object', properties: {} },
    hidden: { component: true, type: 'object', properties: {} },
  },
}], [kernelKeywords])

let eid = (i: number) =>
  `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
let { driver, steps } = stepping()
let store = storage(driver, vocab)
store.install()
store.tx((tx) =>
  tx.patch(
    Array.from(
      { length: 5000 },
      (_, i) => ({
        entity: { eid: eid(i) },
        session: {},
        ...i % 2 ? { hidden: {} } : {},
      }),
    ),
  )
)
store.rows(
  `.session .fields=entity.eid .order=entity.eid .limit=2 .after=${eid(4000)}`,
)
let before = steps()
let first = store.rows(
  `.session .fields=entity.eid .order=entity.eid .limit=2 .after=${eid(4000)}`,
)
let taken = steps() - before
let visible = store.rows(
  `.session !hidden .fields=entity.eid .order=entity.eid .limit=2 .after=${
    eid(4000)
  }`,
)
let reverse = store.rows(
  `.session .fields=entity.eid .order=-entity.eid .limit=2 .after=${eid(4000)}`,
)

test('EID cursor pages seek their owners without sorting the component history', () => {
  equal(first.map((r) => r.eid), [eid(4001), eid(4002)])
  ok(taken < 3000, `${taken} VM instructions for two EID cursor rows`)
})
test('EID cursor pages retain absence and reverse ordering', () => {
  equal(visible.map((r) => r.eid), [eid(4002), eid(4004)])
  equal(reverse.map((r) => r.eid), [eid(3999), eid(3998)])
})
