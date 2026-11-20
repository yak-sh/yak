import { equal, ok, test } from '@yaks/testing'
import { storage } from '@yaks/sqlite'
import { seed, stepping } from '@yaks/sqlite/testing'
import { loadVocab, pick } from '@yaks/vocab'
import { useDoc } from './directory-vocab.ts'

let vocab = loadVocab([pick(useDoc, ['used']), {
  $defs: {
    entity: { component: true, properties: { num: { type: 'number' } } },
  },
}])
let { driver, steps } = stepping()
let store = storage(driver, vocab, { number: true, counts: 'lazy' })
store.install()
let at = (i: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()
let uses = Array.from({ length: 2400 }, (_, i) => ({
  entity: { eid: `used-${i}`, num: i + 1 },
  used: { at: at(i) },
}))
seed(store, uses)

for (
  let [range, expected] of [
    [`.used.at>=${at(2390)}`, uses.slice(-10)],
    [`.used.at>=${at(1200)}&.used.at<${at(1210)}`, uses.slice(1200, 1210)],
  ] as const
) {
  test(`${range} reads only the matching activity history`, async () => {
    let start = steps()
    let rows = await store.rows(`.used&${range}&.limit=20000`)
    let cost = steps() - start
    equal(
      rows.map((row) => row.eid),
      expected.toReversed().map((row) => row.entity.eid),
    )
    ok(cost < 2000, `${cost} VM steps for ${rows.length} uses`)
  })
}
