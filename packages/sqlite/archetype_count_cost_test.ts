import { graph } from '@yaks/graph'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { kernelDoc } from '@yaks/kernel'
import { loadVocab } from '@yaks/vocab'
import { equal, ok, test } from '@yaks/testing'
import { bind } from '@yaks/sql'
import { parse } from '@yaks/query'
import { storage } from './mod.ts'
import { stepping } from './testing.ts'

let vocab = loadVocab([kernelDoc, archetypeDoc, {
  $defs: {
    note: { component: true, properties: { text: { type: 'string' } } },
  },
}])
let meter = stepping(), d = meter.driver
let store = storage(d, vocab)
store.install()
let g = graph({ storage: store, vocab, plugins: [archetypes()] })
g.apply(Array.from({ length: 512 }, (_, i) => ({
  entity: { eid: `note${i}` },
  note: { text: 'kept' },
})))
g.apply([{ entity: { eid: 'note0' }, $delete: true }])
store.rows('.count')

for (
  let q of ['.entity.archetype', '!entity.archetype', '.entity.archetype!=""']
) {
  let line = `${q} .count`
  let expected = d.query(bind(parse(line), vocab))
  store.rows(line)
  test(`archetype count ${q} reads buckets instead of owners`, () => {
    let start = meter.steps()
    equal(store.rows(line), expected)
    let steps = meter.steps() - start
    ok(steps < 500, `${steps} VM steps`)
  })
}

let scoped = { visibility: { entity: '.note' } }
let scopedExpected = d.query(
  bind(parse('.entity.archetype .count'), vocab, scoped),
)
store.rows('.entity.archetype .count', scoped)
test('archetype presence still screens the descriptor under entity visibility', () =>
  equal(store.rows('.entity.archetype .count', scoped), scopedExpected))

let pending = stepping(), unclassified = storage(pending.driver, vocab)
unclassified.install()
unclassified.tx((tx) => tx.patch([{ entity: { eid: 'pending' }, note: {} }]))
for (let q of ['.entity.archetype .count', '!entity.archetype .count']) {
  let expected = pending.driver.query(bind(parse(q), vocab))
  unclassified.rows(q)
  test(`pending classification retains physical counts for ${q}`, () =>
    equal(unclassified.rows(q), expected))
}
