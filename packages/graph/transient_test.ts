import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { graph, transient } from './mod.ts'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
const vocab = loadVocab([{
  $defs: { doc: { properties: { body: { type: 'string' } } } },
}])
const make = () => graph({ vocab, storage: ram(vocab) })
Deno.test('transient ordered text is projected but not stored, commit/discard and late frames', async () => {
  const g = make()
  await g.apply([{ entity: { eid: 'd' }, doc: { body: 'base' } }])
  const live = transient(g)
  let commits = 0
  g.use({
    name: 'counter',
    hooks: {
      effect: (b) => {
        commits++
        return b
      },
    },
  })
  const w = await live.begin('d', 'doc', 'body', 'stream')
  for (let i = 0; i < 1000; i++) w.append('!')
  assertEquals(commits, 0)
  assertEquals((await g.read('.doc'))[0].doc, {
    body: 'base' + '!'.repeat(1000),
  })
  assertEquals((await g.storage.tx((tx) => tx.get(['d'])))[0].doc, {
    body: 'base',
  })
  await w.commit()
  assertEquals(commits, 1)
  live.receive({
    id: 'stream',
    entity: 'd',
    component: 'doc',
    property: 'body',
    seq: 9999,
    op: 'append',
    text: 'late',
  })
  assertEquals(live.snapshots(), [])
  const another = await live.begin('d', 'doc', 'body', 'second')
  another.append('gone')
  another.discard()
  assertEquals((await g.read('.doc'))[0].doc, {
    body: 'base' + '!'.repeat(1000),
  })
})
Deno.test('transient rejects gaps and conflicting durable commit', async () => {
  const g = make()
  await g.apply([{ entity: { eid: 'd' }, doc: { body: 'a' } }])
  const live = transient(g), w = await live.begin('d', 'doc', 'body', 'one')
  const frame = {
    id: 'one',
    entity: 'd',
    component: 'doc',
    property: 'body',
    seq: 2,
    op: 'append' as const,
    text: 'b',
  }
  assertThrows(() => live.receive(frame), Error, 'gap')
  w.append('b')
  live.receive({ ...frame, seq: 1 }) // duplicate
  assertEquals((await g.read('.doc'))[0].doc, { body: 'ab' })
  await g.apply([{ entity: { eid: 'd' }, doc: { body: 'other writer' } }])
  await assertRejects(() => w.commit())
  w.discard()
  assertEquals((await g.read('.doc'))[0].doc, { body: 'other writer' })
})
