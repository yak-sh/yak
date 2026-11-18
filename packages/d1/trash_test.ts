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
