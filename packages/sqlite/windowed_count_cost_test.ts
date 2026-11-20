// A count of a few owners created since a moment reads those owners, not every
// stamp since the moment: the platform store counted 10 of some archetypes
// created in a window by walking `created_at` from an early bound, 274,559
// rows (bug 98bb25c886). A window narrower than the owners still drives.
import { graph } from '@yaks/graph'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { kernelDoc } from '@yaks/kernel'
import { provenanceDoc } from '@yaks/provenance'
import { loadVocab } from '@yaks/vocab'
import { equal, ok, test } from '@yaks/testing'
import { storage } from './mod.ts'
import { stepping } from './testing.ts'

let vocab = loadVocab([kernelDoc, provenanceDoc, archetypeDoc, {
  $defs: Object.fromEntries(
    ['ask', 'note', 'done'].map((
      c,
    ) => [c, { component: true, type: 'object' }]),
  ),
}])
let meter = stepping()
let store = storage(meter.driver, vocab)
store.install()
let g = graph({ storage: store, vocab, plugins: [archetypes()] })
let hour = (h: number) => new Date(Date.UTC(2026, 0, 1, h)).toISOString()
for (let h = 0; h < 50; h++) {
  g.apply(
    Array.from({ length: 100 }, (_, i) => ({
      entity: { eid: `note${h}-${i}` },
      note: {},
    })),
    { now: hour(h) },
  )
}
for (let i = 0; i < 10; i++) {
  g.apply([{
    entity: { eid: `ask${i}` },
    ask: {},
    ...i % 2 ? { done: {} } : {},
  }], { now: hour(i * 5) })
}
while (store.analyze(1));

let cases: [string, number, number][] = [
  [`.ask .created.at>=${hour(1)} .count`, 9, 2_000],
  [`.ask !done .created.at>=${hour(1)} .count`, 4, 2_000],
  [`.note .created.at>=${hour(47)} .count`, 300, 20_000],
]
for (let [line, n, most] of cases) {
  store.rows(line)
  test(`${line} reads the narrower of its owners and its window`, () => {
    let start = meter.steps()
    equal(store.rows(line), [{ value: '', n }])
    let steps = meter.steps() - start
    ok(steps < most, `${steps} VM steps`)
  })
}
