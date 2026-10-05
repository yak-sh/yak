// Catalog snapshots must not reread persistent rows while their connection's
// catalog is unchanged; changes and rolled-back identities still become visible.
import { equal, test } from '@yaks/testing'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { catalog } from './catalog.ts'
import { storage } from './mod.ts'
import { mem, shop, spy } from './testing.ts'

let vocab = loadVocab([...shop.docs, archetypeDoc])
test('a warm catalog costs no storage calls until its rows change', () => {
  let calls = 0
  let driver = spy(mem(), () => {
    calls++
  })
  let store = storage(driver, vocab)
  store.install()
  let g = graph({ storage: store, vocab, plugins: [archetypes()] })
  g.apply([{ entity: { eid: 'one' }, doc: { title: 'One' } }])
  let match = () => catalog(driver)({ all: ['doc'], none: [] })
  let first = match()
  calls = 0
  for (let n = 0; n < 100; n++) equal(match(), first)
  equal(calls, 0)
  g.apply([{ entity: { eid: 'one' }, doc: { title: 'Changed' } }])
  first = match()
  calls = 0
  for (let n = 0; n < 100; n++) equal(match(), first)
  equal(calls, 0)
  g.apply([{ entity: { eid: 'two' }, doc: {}, product: {} }])
  first = match()
  equal(store.read('.doc').map((b) => b.entity.eid), ['one', 'two'])
  calls = 0
  for (let n = 0; n < 100; n++) equal(match(), first)
  equal(calls, 0)
})
