// Repairs use the same graph door over a deferred transaction, with guarded
// physical writes so a reference arriving after a read cannot be discarded.
import { equal, test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import { graph, Refused } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { and, eq, list } from '@yaks/query'
import { storage } from './store.ts'
import { d1 } from './testing.ts'

let vocab = loadVocab({
  $defs: {
    mark: {
      component: true,
      properties: { by: { type: 'string', ref: 'entity', death: 'keep' } },
    },
  },
})
let store = storage(d1(), vocab)
await store.install()
await store.tx((tx) =>
  tx.patch([
    { entity: { eid: '' } },
    { entity: { eid: 'server' } },
    { entity: { eid: 'checked' } },
    { entity: { eid: 'pointed' } },
    { entity: { eid: 'owner' }, mark: { by: 'pointed' } },
  ])
)
let g = graph({ storage: store, vocab })

for (let i = 0; i < 3; i++) {
  await store.tx((tx) => tx.patch([{ entity: { eid: 'warming' } }]))
  await g.apply([{ entity: { eid: 'warming' }, $prune: true }], { check: true })
  await g.apply([{ entity: { eid: 'warming' }, $prune: true }])
  await g.rows(and(eq('entity.eid', list('warming'))))
}

for (let eid of ['', 'server']) {
  test(`d1: pruning removes the malformed orphan ${JSON.stringify(eid)}`, async () => {
    equal(await g.apply([{ entity: { eid }, $prune: true }]), [
      { entity: { eid }, tombstone: {} },
    ])
    equal(await g.rows(and(eq('entity.eid', list(eid)))), [])
  })
}

test('d1: a pruning check rolls back the deferred erase', async () => {
  equal(
    await g.apply([{ entity: { eid: 'checked' }, $prune: true }], {
      check: true,
    }),
    [{ entity: { eid: 'checked' }, tombstone: {} }],
  )
  equal(await g.get(['checked']), [{ entity: { eid: 'checked' } }])
})

test('d1: pruning refuses retained history references', async () => {
  await assertRejects(
    async () => await g.apply([{ entity: { eid: 'pointed' }, $prune: true }]),
    Refused,
  )
  equal(await g.get(['pointed']), [{ entity: { eid: 'pointed' } }])
})
