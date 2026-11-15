import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { graph } from '@yaks/graph'
import { storage } from '@yaks/sqlite'
import { mem } from '../sqlite/testing.ts'
import { loadVocab } from '@yaks/vocab'
import { toolsDoc } from '@yaks/tools/vocab'
import { sessionDoc } from './comp.ts'
import { sessionDerived } from './status.ts'
import { stopAll, topOf } from './children.ts'

let vocab = loadVocab([sessionDoc, toolsDoc])
// A conversation whose helper started a helper of its own, each at work.
let tree = async () => {
  let s = storage(mem(), vocab, { derived: sessionDerived(vocab) })
  s.install()
  let g = graph({ storage: s, vocab })
  await g.apply([
    // Who stops it: anyone the graph knows.
    { entity: { eid: 'ann' }, hooked: {} },
    { entity: { eid: 'top' }, session: { id: 'top' } },
    {
      entity: { eid: 'mid' },
      session: { id: 'mid' },
      spawned: { parent: 'top' },
    },
    {
      entity: { eid: 'low' },
      session: { id: 'low' },
      spawned: { parent: 'mid' },
    },
    ...['top', 'mid', 'low'].map((session) => ({
      entity: { eid: `${session}:in` },
      entry: { session },
      content: { body: 'Check the draft.' },
    })),
  ], { trusted: true })
  return g
}
let stops = async (g: Awaited<ReturnType<typeof tree>>) =>
  (await g.read('.stop&.entry')).map((b) =>
    String((b.entry as { session: string }).session)
  ).sort()

let all = await tree()
let stoppedAll = await stopAll(all, 'top', 'ann')
test('a stop reaches every helper under the session, however deep, in one write', async () => {
  assertEquals([stoppedAll, await stops(all)], [true, ['low', 'mid', 'top']])
  assertEquals(await stopAll(all, 'top', 'ann'), false)
})

let low = await tree()
await stopAll(low, 'low', 'ann')
test('a helper stopped alone says who stopped it, and the conversation above is told in a notice', async () => {
  assertEquals(await stops(low), ['low'])
  let [told] = await low.read('.notice&.delivery&.entry ?content')
  assertEquals((told.entry as { session: string }).session, 'top')
  assertEquals(told.delivery, { child: 'low', outcome: 'stopped' })
  assertEquals(await topOf(low, 'low'), 'top')
})
