// An addressed item reaches a native transcript as input, and an outside
// caller as a reply, through the graph interfaces both use.

import { assertEquals } from '@std/assert'
import { graph, type Storage } from '@yaks/graph'
import { kernelDoc } from '@yaks/kernel/vocab'
import { docDoc } from '@yaks/doc'
import { effects } from '@yaks/effects'
import { mailDoc } from '@yaks/mail/vocab'
import { notifyDoc } from '@yaks/notify/vocab'
import { ram } from '@yaks/ram'
import { storage } from '@yaks/sqlite'
import { toolsDoc } from '@yaks/tools/vocab'
import { loadVocab } from '@yaks/vocab'
import { until } from '@yaks/testing'
import { feed, reply } from './bus.ts'
import { sessionDoc } from './comp.ts'
import { sessions } from './plugin.ts'
import { service } from './service.ts'
import { mem } from '../sqlite/testing.ts'

let vocab = loadVocab([
  kernelDoc,
  docDoc,
  mailDoc,
  notifyDoc,
  sessionDoc,
  toolsDoc,
])
let fresh = async (
  store: Storage = ram(vocab),
  woke?: (eid: string) => void,
) => {
  let fx = effects(vocab)
  fx.handle({ session_run: (e) => woke?.(e.entity.eid) })
  let g = graph({ vocab, storage: store, plugins: [sessions(), fx] })
  await g.apply([
    { entity: { eid: 'native' }, session: { id: 'native' } },
    { entity: { eid: 'outside' }, session: { id: 'outside' } },
    {
      entity: { eid: 'start' },
      entry: { session: 'native' },
      content: { body: 'start' },
      using: {},
    },
    {
      entity: { eid: 'page' },
      doc: { title: 'Page' },
      claim: { session: 'native' },
    },
    {
      entity: { eid: 'note' },
      comment: { target: 'page' },
      doc: { body: 'please check' },
    },
    {
      entity: { eid: 'knock' },
      knock: { target: 'native' },
      doc: { body: 'child finished' },
    },
    {
      entity: { eid: 'letter' },
      mail: { from: 'a@example.com', to: 'b@example.com' },
      deliver: { to: 'outside' },
      doc: { title: 'A letter' },
    },
  ], { trusted: true })
  return g
}

Deno.test('native bus delivery appends input and marks the item once', async () => {
  let wakes: string[] = []
  let g = await fresh(undefined, (eid) => wakes.push(eid))
  wakes.length = 0
  assertEquals(await feed(g), 2)
  let entries = await g.read('.entry.session=native&*')
  assertEquals(entries.length, 3)
  assertEquals(
    (entries[1].content as { body: string }).body.includes('please check'),
    true,
  )
  assertEquals(
    (entries[2].content as { body: string }).body.includes('child finished'),
    true,
  )
  assertEquals(entries.slice(1).every((e) => !!e.attention), true)
  assertEquals(
    entries.slice(1).every((e) => wakes.includes(e.entity.eid)),
    true,
  )
  assertEquals((await g.get(['note']))[0].notified != null, true)
  assertEquals((await g.get(['knock']))[0].notified != null, true)
  assertEquals(await feed(g), 0)
  assertEquals((await g.read('.entry.session=native')).length, 3)
})

Deno.test('SQLite finds the same addressed comment and knock', async () => {
  let store = storage(mem(), vocab)
  store.install()
  let g = await fresh(store)
  assertEquals(await feed(g), 2)
  assertEquals(
    (await g.get(['note', 'knock'])).every((b) => !!b.notified),
    true,
  )
})

Deno.test('an outside caller receives what was addressed to its session once', async () => {
  let g = await fresh()
  let call = { entity: { eid: 'call' }, created: { via: 'outside' } }
  let first = await reply(g, call)
  assertEquals(first.length, 1)
  assertEquals(
    (first[0].content as { body: string }).body.includes('A letter'),
    true,
  )
  assertEquals((await g.get(['letter']))[0].notified != null, true)
  assertEquals(await reply(g, call), [])
})

Deno.test('the session duty delivers without a Claude transcript directory', async () => {
  let g = await fresh()
  let stop = new AbortController()
  let run = service({ graph: g }, { transcripts: '' }, stop.signal)
  try {
    await until(async () => (await g.get(['note']))[0].notified)
    assertEquals((await g.read('.entry.session=native')).length, 3)
  } finally {
    stop.abort()
    await run
  }
})
