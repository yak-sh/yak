import { equal, ok, test } from '@yaks/testing'
import { val } from '@yaks/sql'
import { loadVocab } from '@yaks/vocab'
import { backfill, storage } from './mod.ts'
import { stepping } from './testing.ts'

let vocab = loadVocab([{
  $defs: { doc: { component: true, type: 'object' } },
}])
let world = (n: number) => {
  let { driver, steps } = stepping()
  let s = storage(driver, vocab)
  s.install()
  s.raise(['doc'])
  driver.query({
    t: 'insert',
    into: 'entity',
    cols: ['eid'],
    rows: Array.from({ length: n }, (_, i) => [val(`bare${i}`)]),
  })
  let query = driver.query.bind(driver), work = 0
  driver.query = (s) => {
    let at = steps(), rows = query(s)
    if (
      s.t == 'select' && !Array.isArray(s.from) &&
      s.from?.t == 'table' && s.from.name == 'doc'
    ) {
      work += steps() - at
    }
    return rows
  }
  return () => ({ result: backfill(driver), work })
}
let [small, large] = [64, 512].map(world)

test('a backfill asks an empty component without walking every missing spine', () => {
  let a = small(), b = large()
  equal(a.result.entities, 64)
  equal(b.result.entities, 512)
  ok(b.work <= a.work + 10, `${a.work} then ${b.work} VM steps`)
})
