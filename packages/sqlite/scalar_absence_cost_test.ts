// A scalar predicate implies presence when an absence selects the few owners
// left from that component's history, even before the catalog is loaded.
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { graph } from '@yaks/graph'
import { equal, ok, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { storage } from './mod.ts'
import { stepping } from './testing.ts'

let vocab = loadVocab([archetypeDoc, {
  $defs: {
    product: {
      component: true,
      properties: { price: { type: 'number' } },
    },
    marker: { component: true },
    doc: { component: true },
  },
}])
let { driver, steps } = stepping(), store = storage(driver, vocab)
store.install()
let g = graph({ storage: store, vocab, plugins: [archetypes()] })
g.apply([
  { entity: { eid: 'kept' }, product: { price: 5 } },
  { entity: { eid: 'cheap' }, product: { price: 1 } },
  ...Array.from({ length: 1024 }, (_, i) => ({
    entity: { eid: `marked-${i}` },
    product: { price: 9 },
    marker: {},
  })),
  ...Array.from({ length: 1024 }, (_, i) => ({
    entity: { eid: `other-${i}` },
    doc: {},
  })),
])
for (let page of ['', ' .limit=50']) {
  let cold = storage({ ...driver }, vocab, { schemaReady: () => true })
  test(`a scalar test beside an absence skips historical owners${page}`, () => {
    let start = steps()
    equal(cold.rows(`!marker .product.price>=2${page}`).map((r) => r.eid), [
      'kept',
    ])
    let cost = steps() - start
    ok(cost < 1500, `${cost} VM steps for one remaining owner`)
  })
}
