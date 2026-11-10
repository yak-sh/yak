import { equal, ok, test } from '@yaks/testing'
import { storage } from '@yaks/sqlite'
import { stepping } from '../../packages/sqlite/testing.ts'
import { options, store, vocab } from './core.ts'

let meter = stepping(), saved = storage(meter.driver, vocab, options)
saved.install()
let tracker = store(saved, { sink: () => {} })
saved.tx((tx) =>
  tx.patch(Array.from({ length: 512 }, (_, i) => ({
    entity: { eid: `kept${i}` },
    request: { route: 'kept' },
  })))
)
let total = Number((await tracker.graph.rows('.count'))[0].n)
for (
  let [q, n] of [['.entity.archetype', total], ['!entity.archetype', 0], [
    '.entity',
    total,
  ]] as const
) {
  let line = `${q} .count`
  await tracker.graph.rows(line)
  test(`the composed tracker counts ${q} without reading its occurrences`, async () => {
    let start = meter.steps()
    equal(await tracker.graph.rows(line), [{ value: '', n }])
    let steps = meter.steps() - start
    ok(steps < 1000, `${steps} VM steps`)
  })
}
