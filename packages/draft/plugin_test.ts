// Checking a draft or a peer value through a draft-enabled graph performs no
// lasting writer work, while returning the same merge and refusals as a write.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { graph, mint, Stale, token } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { draftDoc } from './vocab.ts'
import { drafts } from './plugin.ts'

let vocab = loadVocab([draftDoc, {
  $defs: {
    motion: {
      component: true,
      sync: 'peers',
      properties: { yaw: { type: 'number' } },
    },
  },
}])
let base = ram(vocab), writes = 0
let storage = {
  ...base,
  tx: <T>(body: Parameters<typeof base.tx<T>>[0]) =>
    base.tx((tx) =>
      body({
        ...tx,
        patch: (b) => {
          writes++
          return tx.patch(b)
        },
      })
    ),
}
let g = graph({ storage, vocab, plugins: [drafts()] })
await g.apply([{
  entity: { eid: 'd' },
  draft: { text: 'ship it now' },
  typed: { over: '' },
}])
let before = await g.get(['d'])
let stale = token('ship it')

test('draft admission returns the merge without writing the backing store', async () => {
  writes = 0
  let [checked] = await g.admit([{
    entity: { eid: 'd' },
    draft: { text: 'Ship it' },
    typed: { over: 'ship it' },
  }])
  assertEquals(checked.draft, { text: 'Ship it now', rev: 2 })
  assertEquals(await g.get(['d']), before)
  assertEquals(writes, 0)
})

test('draft admission preserves stale refusals without writing the backing store', async () => {
  writes = 0
  await assertRejects(
    async () =>
      await g.admit([{
        entity: { eid: 'd' },
        draft: { text: '' },
        $was: { draft: { text: stale } },
      }]),
    Stale,
  )
  assertEquals(await g.get(['d']), before)
  assertEquals(writes, 0)
})

test('peer admission through a draft-enabled graph writes nothing', async () => {
  writes = 0
  let peer = { entity: { eid: 'd' }, motion: { yaw: 2 } }
  assertEquals(await g.admit([peer]), [peer])
  assertEquals(await g.get(['d']), before)
  assertEquals(writes, 0)
})

test('a spend uses the saved words and keeps the other desk’s unsent addition', async () => {
  let entity = { eid: mint() }, writer = mint()
  let save = {
    entity,
    draft: { text: 'Save my seat' },
    typed: { over: '', writer, order: 1 },
  }
  await g.apply([save])
  await g.apply([{
    entity,
    draft: { text: 'Save my seat by the window' },
    typed: { over: 'Save my seat' },
  }])
  await g.apply([{
    entity,
    draft: { text: '' },
    typed: { over: '', writer, order: 2, confirmed: 0 },
  }])
  await g.apply([save])
  let [row] = await g.get([entity.eid])
  assertEquals(row.draft, { text: ' by the window', rev: 3 })
})
