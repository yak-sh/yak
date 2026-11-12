import { equal, ok, test } from '@yaks/testing'
import { storage } from '@yaks/sqlite'
import { stepping } from '../../packages/sqlite/testing.ts'
import { capture } from '@yaks/tracker/report'
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

// Intake owes runs with no `next`, so a backlog is one long tie in `next`
// order. When the next run falls due is asked after every intake, and its
// answer stays one read that stops at the first run, however long the
// backlog.
let behind = async (reports: number) => {
  let meter = stepping(), saved = storage(meter.driver, vocab, options)
  saved.install()
  let tracker = store(saved, { sink: () => {} })
  for (let i = 0; i < reports; i++) {
    await tracker.ingest(capture(Error(`fault ${i}`), { sink: () => {} }))
  }
  await tracker.next(0)
  let start = meter.steps(), due = await tracker.next(0)
  return { due, steps: meter.steps() - start }
}
let [few, many] = [await behind(2), await behind(200)]

test('when the next run falls due is read the same behind any backlog', () => {
  equal([few.due, many.due], [1000, 1000])
  ok(many.steps <= few.steps * 1.5, `${few.steps} then ${many.steps} VM steps`)
})
