// The canonical platform move preserves serving pointers and billable usage,
// and refuses a patch whose source changed after it was read.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { graph, Stale } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { platformDoc } from '@yaks/platform/vocab'
import { platformRule } from './platform-move.ts'

let vocab = loadVocab(platformDoc)

let releases = async () => {
  let g = graph({ vocab, storage: ram(vocab) })
  await g.apply([
    { entity: { eid: 'space' }, space: { slug: 'team' } },
    {
      entity: { eid: 'app' },
      app: {
        space: 'space',
        slug: 'notes',
        store: 'team/notes.abcdef',
        source: 'team/.releases/app/kept',
        draft: 'team/.drafts/app/editing',
        version: 7,
      },
      meter: { month: '2026-10', ws_messages: 8, files: 4096, realtime: 0.25 },
    },
  ], { trusted: true, stamp: false })
  let before = await g.read('.entity.eid=app')
  return { g, before }
}
let release = await releases()
let spend = graph({ vocab, storage: ram(vocab) })
await spend.apply([{
  entity: { eid: 'space' },
  meter: { month: '2026-10', realtime: 0.25 },
}])

test('platform rows keep releases and usage', async () => {
  let { g, before } = release
  let patch = platformRule.move(before[0])
  await g.apply(patch, { trusted: true, stamp: false })
  assertEquals(await g.read('.entity.eid=app'), before)
})

test('a platform move refuses a concurrent spend', async () => {
  let g = spend
  let [before] = await g.read('.meter')
  let patch = platformRule.move(before)
  await g.apply([{ entity: { eid: 'space' }, meter: { realtime: 0.5 } }])
  await assertRejects(
    async () => await g.apply(patch, { trusted: true }),
    Stale,
  )
  let [now] = await g.read('.meter')
  assertEquals(now.meter, { month: '2026-10', realtime: 0.5 })
})
