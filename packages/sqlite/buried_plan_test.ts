// A retention page bounds the graves it visits, including those too young to
// prune: an old grave after a long young run still comes on a later page.
import { equal, ok, test } from '@yaks/testing'
import { val } from '@yaks/sql'
import { loadVocab } from '@yaks/vocab'
import { burying } from './buried.ts'
import { stepping } from './testing.ts'

let vocab = loadVocab([])
let before = '2026-10-01'
let world = (n: number) => {
  let { driver, steps } = stepping()
  driver.query({
    t: 'create table',
    name: 'entity',
    cols: [{ name: 'id', type: 'integer', pk: true }, { name: 'eid' }],
  })
  driver.query({
    t: 'create table',
    name: 'tombstone',
    cols: [
      { name: 'entity', type: 'integer', pk: true },
      { name: 'deleted_at' },
    ],
  })
  driver.query({
    t: 'insert',
    into: 'entity',
    cols: ['id', 'eid'],
    rows: Array.from(
      { length: n + 1 },
      (_, i) => [val(i + 1), val(`g${i + 1}`)],
    ),
  })
  driver.query({
    t: 'insert',
    into: 'tombstone',
    cols: ['entity', 'deleted_at'],
    rows: Array.from({ length: n + 1 }, (_, i) => [
      val(i + 1),
      val(i == n ? '2026-09-01' : '2026-11-01'),
    ]),
  })
  let buried = burying(driver, vocab)
  buried(before, { limit: 2 })
  return {
    buried,
    page: () => {
      let at = steps()
      let page = buried(before, { limit: 2 })
      return { page, steps: steps() - at }
    },
  }
}
let [small, large] = [40, 160].map(world)

test('a burial page visits a bounded number of young graves', () => {
  let a = small.page(), b = large.page()
  equal(a.page, { eids: [], next: '2' })
  equal(b.page, a.page)
  ok(b.steps <= a.steps + 10, `${a.steps} then ${b.steps} VM steps`)
})

test('a burial walk reaches an old grave beyond young ones', () => {
  equal(large.buried(before, { after: '160', limit: 2 }), { eids: ['g161'] })
})
