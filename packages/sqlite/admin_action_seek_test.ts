import { archetypeDoc } from '@yaks/archetype'
import { adminDoc } from '@yaks/admin/vocab'
import { provenanceDoc } from '@yaks/provenance/vocab'
import { equal, ok, test } from '@yaks/testing'
import { loadVocab, pick } from '@yaks/vocab'
import { storage } from './mod.ts'
import { seed, stepping } from './testing.ts'

// The platform's 120k admin actions were nearly all one operation, under
// 700k newer records; a page of a rare operation walked them all (bug
// 9695e7b9fd). The declared index seeks it, in a store that held the rows
// before the index was declared.
let words = pick(adminDoc, ['admin_action'])
let before = structuredClone(words)
delete before.$defs!.admin_action.properties!.operation.index
let vocab = (action: typeof words) =>
  loadVocab([archetypeDoc, pick(provenanceDoc, ['created']), action])
let { driver, steps } = stepping()
let previous = storage(driver, vocab(before), { counts: 'lazy' })
previous.install()

let at = (i: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()
seed(previous, [
  ...Array.from({ length: 4 }, (_, i) => ({
    entity: { eid: `graves-${i}` },
    created: { at: at(i) },
    admin_action: { operation: 'graves' },
  })),
  ...Array.from({ length: 1024 }, (_, i) => ({
    entity: { eid: `history-${i}` },
    created: { at: at(i + 4) },
    ...i % 4 ? {} : { admin_action: { operation: 'operator_copy' } },
  })),
])

let store = storage(driver, vocab(words), { counts: 'lazy' })
store.install()

for (
  let [operation, expected] of [
    ['move', []],
    ['graves', ['graves-3']],
  ] as const
) {
  test(`the newest ${operation} action is sought by its operation`, async () => {
    let start = steps()
    let rows = await store.rows(
      `.admin_action.operation=${operation} .order=-created.at .limit=1`,
    )
    let cost = steps() - start
    equal(rows.map((row) => row.eid), [...expected])
    ok(cost < 600, `${cost} VM steps for ${rows.length} actions`)
  })
}
