// Identity pages take the shorter road to their owners, as the store's counted
// populations size them: a walk of the entity's EID index when the component
// is dense, its own rows when it is sparse or when the store keeps no counts.
import { equal, ok, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { storage } from './mod.ts'
import { stepping } from './testing.ts'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { archetypeDoc } from '@yaks/archetype'

let vocab = loadVocab([kernelDoc, archetypeDoc, {
  $defs: {
    session: { component: true, type: 'object', properties: {} },
    hidden: { component: true, type: 'object', properties: {} },
  },
}], [kernelKeywords])

let eid = (i: number) =>
  `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
// A store of `n` entities, every `every`th wearing session and every other
// session hidden too, and what a query costs it in VM steps.
let fixture = (
  n: number,
  every: number,
  counts: 'eager' | 'lazy' = 'eager',
) => {
  let { driver, steps } = stepping()
  let store = storage(driver, vocab, { counts })
  store.install()
  store.tx((tx) =>
    tx.patch(
      Array.from({ length: n }, (_, i) => ({
        entity: { eid: eid(i) },
        ...i % every ? {} : { session: {} },
        ...i % every == 0 && (i / every) % 2 ? { hidden: {} } : {},
      })),
    )
  )
  let page = (q: string) => store.rows(`.session ${q} .fields=entity.eid`)
  let cost = (q: string) => {
    page(q)
    let before = steps()
    let rows = page(q)
    return { eids: rows.map((r) => r.eid), steps: steps() - before }
  }
  return { page, cost }
}

let dense = fixture(5000, 1)
let first = dense.cost(`.order=entity.eid .limit=2 .after=${eid(4000)}`)

test('EID cursor pages over a dense component walk its owners without sorting them', () => {
  equal(first.eids, [eid(4001), eid(4002)])
  ok(
    first.steps < 3000,
    `${first.steps} VM instructions for two EID cursor rows`,
  )
})
let eids = (f: typeof dense, q: string) => f.page(q).map((r) => r.eid)
let visible = eids(
  dense,
  `!hidden .order=entity.eid .limit=2 .after=${eid(4000)}`,
)
let reverse = eids(dense, `.order=-entity.eid .limit=2 .after=${eid(4000)}`)
let uncounted = fixture(5000, 1, 'lazy')
let driven = [
  `.order=entity.eid .limit=2 .after=${eid(4000)}`,
  `!hidden .order=entity.eid .limit=2 .after=${eid(4000)}`,
  `.order=-entity.eid .limit=2 .after=${eid(4000)}`,
].map((q) => eids(uncounted, q))

test('EID cursor pages retain absence and reverse ordering, on either road', () => {
  equal(visible, [eid(4002), eid(4004)])
  equal(reverse, [eid(3999), eid(3998)])
  equal(driven, [first.eids, visible, reverse])
})

// 40 sessions among 20,000 entities: a page that never fills walked the whole
// index, and a sparse page reads its 40 owners instead.
let sparse = fixture(20_000, 500)
let all = sparse.cost('.order=entity.eid .limit=100')
let after = sparse.cost(`.order=entity.eid .limit=3 .after=${eid(9500)}`)

test('EID cursor pages over a sparse component read its owners, not every entity', () => {
  equal(all.eids.length, 40)
  equal(after.eids, [eid(10_000), eid(10_500), eid(11_000)])
  ok(all.steps < 8000, `${all.steps} VM instructions for 40 sparse owners`)
  ok(after.steps < 8000, `${after.steps} VM instructions for a sparse page`)
})
let sparseVisible = eids(
  sparse,
  `!hidden .order=entity.eid .limit=2 .after=${eid(9500)}`,
)
let sparseReverse = eids(
  sparse,
  `.order=-entity.eid .limit=2 .after=${eid(10_000)}`,
)

test('sparse EID cursor pages retain absence and reverse ordering', () => {
  equal(sparseVisible, [eid(10_000), eid(11_000)])
  equal(sparseReverse, [eid(9500), eid(9000)])
})
