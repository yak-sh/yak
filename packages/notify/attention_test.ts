/** Personal attention preserves the subscription and leaves its target alone. */
import { equal, test } from '@yaks/testing'
import { graph, mint } from '@yaks/graph'
import { kernelDoc } from '@yaks/kernel'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { notifyDoc } from './mod.ts'
import { markAttention } from './attention.ts'

const vocab = loadVocab([notifyDoc, kernelDoc])
const g = graph({ vocab, storage: ram(vocab) })
const reader = mint(), release = mint()
await g.apply([{
  entity: { eid: 'release-watch' },
  subscription: { actor: reader, target: release, mode: 'watch' },
}])

const patches = await markAttention(g, reader, release, 'opened')

test('attention reuses the watched subscription', async () => {
  const found = await markAttention(g, reader, release, 'opened')
  equal(found.map((patch) => patch.entity.eid), [
    'release-watch',
    'release-watch',
  ])
})

test('opening a watched target preserves its mode and leaves the target alone', async () => {
  await g.apply(patches)
  const [attention] = await g.get(['release-watch'])
  equal(attention.subscription, {
    actor: reader,
    target: release,
    mode: 'watch',
  })
  equal(!!attention.opened, true)
  equal((await g.get([release]))[0]?.opened, undefined)
})
