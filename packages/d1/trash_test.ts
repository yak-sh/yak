/// <reference lib="deno.ns" />
import { equal, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { restoreTrash } from '@yaks/graph/trash'
import { loadVocab } from '@yaks/vocab'
import { store } from './testing.ts'

let vocab = loadVocab({
  $defs: {
    note: {
      component: true,
      journal: false,
      properties: {
        text: { type: 'string' },
        bytes: { type: 'string', contentEncoding: 'base64' },
      },
    },
  },
})
let s = await store(vocab), g = graph({ storage: s, vocab })
let bytes = Uint8Array.of(0, 255, 3)
await g.apply([{ entity: { eid: 'note' }, note: { text: 'Precious', bytes } }])
test('D1 saves destructive writes in their atomic batch and restores binary data', async () => {
  await g.apply([{ entity: { eid: 'note' }, $delete: true }])
  let [entry] = await s.trash(['note'])
  equal(entry.bundles[0].note, { text: 'Precious', bytes })
  await restoreTrash(g, entry)
  equal((await g.get(['note']))[0].note, { text: 'Precious', bytes })
  await s.purgeTrash(entry.id)
  equal(await s.trash(['note']), [])
})

let cleanupStore = await store(vocab),
  cleanup = graph({ storage: cleanupStore, vocab })
await cleanup.apply([{
  entity: { eid: 'cleanup' },
  note: { text: 'Recover me', bytes },
}])
test('D1 delete and prune housekeeping keep archived identities without refusing the write', async () => {
  await cleanup.apply([{ entity: { eid: 'cleanup' }, $delete: true }, {
    entity: { eid: 'cleanup' },
    $prune: true,
  }], { trusted: true })
  let during = await cleanupStore.tx(async (tx) => {
    await tx.prune!(['cleanup'])
    return await tx.get(['cleanup'])
  })
  equal(during[0].tombstone, {})
  let [entry] = await cleanupStore.trash(['cleanup'])
  await restoreTrash(cleanup, entry)
  equal((await cleanup.get(['cleanup']))[0].note, { text: 'Recover me', bytes })
})
