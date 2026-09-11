/// <reference lib="deno.ns" />
import { assert, assertEquals } from '@std/assert'
import { graph, transient } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { subscriptions } from '@yaks/api'
import { land } from './inbound.ts'
import type { Frame } from './socket.ts'
const vocab = loadVocab([{
  $defs: { doc: { properties: { body: { type: 'string' } } } },
}])
Deno.test('subscriptions transfer ordered append frames and snapshot live values on resubscribe', async () => {
  const source = graph({ vocab, storage: ram(vocab) })
  const target = graph({ vocab, storage: ram(vocab) })
  await source.apply([{ entity: { eid: 'd' }, doc: { body: '' } }])
  const subs = subscriptions(source)
  const frames: Frame[] = []
  let pending = Promise.resolve()
  const sink = (f: Frame) => {
    frames.push(f)
    pending = pending.then(async () => {
      await land(target, f)
    })
  }
  await subs.open(sink, 'docs', '.doc')
  const w = await transient(source).begin('d', 'doc', 'body', 's')
  for (let i = 0; i < 100; i++) w.append('abc')
  await pending
  assertEquals((await target.read('.doc'))[0].doc, { body: 'abc'.repeat(100) })
  assertEquals((await target.storage.read('.doc'))[0].doc, { body: '' })
  assert(
    frames.filter((f) => f.transient?.[0]?.op == 'append').every((f) =>
      !f.bundles
    ),
  )
  subs.close(sink, 'docs')
  w.append('tail')
  await subs.open(sink, 'docs', '.doc')
  await pending
  assertEquals((await target.read('.doc'))[0].doc, {
    body: 'abc'.repeat(100) + 'tail',
  })
  await w.commit()
  await pending
  assertEquals(transient(target).snapshots(), [])
  assertEquals((await target.storage.read('.doc'))[0].doc, {
    body: 'abc'.repeat(100) + 'tail',
  })
})
