// A page in an indexed property's order reads the rows lacking the value by
// seeks, never by reading every owner, in a store that keeps no count.
import { equal, ok, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { storage } from './mod.ts'
import { seed, stepping } from './testing.ts'

let comp = (properties = {}, index?: string[][]) => ({
  component: true,
  type: 'object',
  properties,
  ...index ? { index } : {},
})
let vocab = loadVocab({
  $defs: {
    entity: comp(),
    review: comp({ stars: { type: 'number' } }),
    bookmark: comp(),
    created: comp({ at: { type: 'string', format: 'date-time' } }, [['at']]),
  },
})
let { driver, steps } = stepping()
let s = storage(driver, vocab)
s.install()
let at = (i: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()
seed(s, [
  ...Array.from({ length: 3000 }, (_, i) => ({
    entity: { eid: `r${i}` },
    review: { stars: 1 },
    created: { at: at(i) },
  })),
  // Entities beside the reviews, so the index the page walks holds others.
  ...Array.from({ length: 3000 }, (_, i) => ({
    entity: { eid: `b${i}` },
    bookmark: {},
    created: { at: at(i) },
  })),
])
let page = async (q: string) => {
  await s.rows(q)
  let start = steps(), rows = await s.rows(q)
  return { eids: rows.map((r) => r.eid), steps: steps() - start }
}

for (
  let [q, eids] of [
    ['.review .order=created.at .limit=2', ['r0', 'r1']],
    ['.review .order=-created.at .limit=2', ['r2999', 'r2998']],
    ['.review .order=created.at .limit=2 .fields=review.stars', ['r0', 'r1']],
  ] as const
) {
  test(`${q} reads its page, not every review`, async () => {
    let read = await page(q)
    equal(read.eids, [...eids])
    ok(read.steps < 3000, `${read.steps} VM steps`)
  })
}

test('the rows lacking the value lead an ascending page', async () => {
  seed(s, [
    { entity: { eid: 'bare' }, review: { stars: 2 } },
    { entity: { eid: 'blank' }, review: { stars: 2 }, created: { at: '' } },
  ])
  equal(
    (await page('.review .order=created.at .limit=3')).eids.sort(),
    ['bare', 'blank', 'r0'],
  )
  equal((await page('.review .order=-created.at .limit=1')).eids, ['r2999'])
})
