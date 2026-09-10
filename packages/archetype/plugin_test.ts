import { assertEquals } from '@std/assert'
import { graph, type Storage, type Tx } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { archetypeDoc, archetypes, eidOf } from './mod.ts'

for (let async of [false, true]) {
  Deno.test(`archetype: RAM plugin, async=${async}, transaction rollback`, async () => {
    let vocab = loadVocab([archetypeDoc, {
      $defs: { note: { type: 'object' } },
    }])
    let store = ram(vocab)
    let storage: Storage = async
      ? {
        ...store,
        tx: (body) =>
          store.tx((tx) => {
            let wrapped: Tx = {
              ...tx,
              get: (ids) => Promise.resolve().then(() => tx.get(ids)),
              patch: (b) => Promise.resolve().then(() => tx.patch(b)),
              remove: (e) => Promise.resolve().then(() => tx.remove(e)),
            }
            return body(wrapped)
          }),
      }
      : store
    let g = graph({ storage, vocab, plugins: [archetypes()] })
    await g.apply([{ entity: { eid: 'a' }, note: {} }], { check: true })
    assertEquals(store.tx((tx) => tx.get(['a'])), [])
    await g.apply([{ entity: { eid: 'a' }, note: {} }])
    assertEquals(
      store.tx((tx) => tx.get(['a']))[0].entity.archetype,
      eidOf(['note']),
    )
    await g.apply([{ entity: { eid: 'a' }, note: null }])
    assertEquals(store.tx((tx) => tx.get(['a']))[0].entity.archetype, eidOf([]))
    await g.apply([{ entity: { eid: 'a' }, $delete: true }])
    assertEquals(
      store.tx((tx) => tx.get(['a']))[0].entity.archetype,
      eidOf(['tombstone']),
    )
  })
}
