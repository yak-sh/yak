// An addressed item reaches a native transcript as input, and an outside
// caller as a reply, through the graph interfaces both use.

import { assertEquals } from '@std/assert'
import { graph, type Storage } from '@yaks/graph'
import { processDoc } from '@yaks/process'
import { kernelDoc } from '@yaks/kernel/vocab'
import { docDoc } from '@yaks/doc'
import { effects } from '@yaks/effects'
import { mailDoc } from '@yaks/mail/vocab'
import { notifyDoc } from '@yaks/notify/vocab'
import { ram } from '@yaks/ram'
import { storage } from '@yaks/sqlite'
import { toolsDoc } from '@yaks/tools/vocab'
import { loadVocab } from '@yaks/vocab'
import { test, until } from '@yaks/testing'
import { feed, reply } from './bus.ts'
import { sessionDoc } from './comp.ts'
import { sessions } from './plugin.ts'
import { service } from './service.ts'
import { mem } from '../sqlite/testing.ts'

let vocab = loadVocab([
  kernelDoc,
  processDoc,
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

test('native bus delivery appends input and marks the item once', async () => {
  let wakes: string[] = []
  let g = await fresh(undefined, (eid) => wakes.push(eid))
  wakes.length = 0
  assertEquals(await feed(g), 1)
  let entries = await g.read('.entry.session=native&*')
  assertEquals(entries.length, 2)
  assertEquals(
    (entries[1].content as { body: string }).body.includes('child finished'),
    true,
  )
  assertEquals(entries.slice(1).every((e) => !!e.attention), true)
  assertEquals(
    entries.slice(1).every((e) => wakes.includes(e.entity.eid)),
    true,
  )
  assertEquals((await g.get(['note']))[0].notified != null, false)
  assertEquals((await g.get(['knock']))[0].notified != null, true)
  assertEquals(await feed(g), 0)
  assertEquals((await g.read('.entry.session=native')).length, 2)
})

test('SQLite finds the same addressed comment and knock', async () => {
  let store = storage(mem(), vocab)
  store.install()
  let g = await fresh(store)
  assertEquals(await feed(g), 1)
  assertEquals(
    (await g.get(['note', 'knock'])).map((b) => !!b.notified),
    [false, true],
  )
})

test('an outside caller receives what was addressed to its session once', async () => {
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

test('the session duty delivers without a Claude transcript directory', async () => {
  let g = await fresh()
  let stop = new AbortController()
  let run = service({ graph: g }, { transcripts: '' }, stop.signal)
  try {
    await until(async () => (await g.get(['knock']))[0].notified)
    assertEquals((await g.read('.entry.session=native')).length, 2)
  } finally {
    stop.abort()
    await run
  }
})

test('native comments never feed through the bus; outside task claims retain their listener', async () => {
  let g = await fresh()
  await g.apply([
    {
      entity: { eid: 'direct' },
      comment: { target: 'outside' },
      doc: { body: 'direct words' },
    },
    {
      entity: { eid: 'task' },
      doc: { title: 'claimed' },
      claim: { session: 'outside' },
    },
    {
      entity: { eid: 'claimed-note' },
      comment: { target: 'task' },
      doc: { body: 'claimed words' },
    },
  ], { trusted: true })
  let first = await reply(g, {
    entity: { eid: 'call2' },
    created: { via: 'outside' },
  })
  assertEquals(first.length, 2) // letter and claimed comment, never direct comment
  assertEquals((await g.get(['direct']))[0].notified != null, false)
  assertEquals((await g.get(['claimed-note']))[0].notified != null, true)
  await feed(g)
  assertEquals((await g.get(['note']))[0].notified != null, false)
  assertEquals((await g.read('.entry.session=native')).length, 2)
})

test('a process-backed harness claim still hears comments with a using entry', async () => {
  let store = storage(mem(), vocab)
  store.install()
  let g = await fresh(store)
  // The spawned runner's using entry is a request to its outside process,
  // not permission for the native inbox router to inject it too.
  await g.apply([
    { entity: { eid: 'outside' }, process: { pid: 1234 } },
    {
      entity: { eid: 'outside-start' },
      entry: { session: 'outside' },
      content: { body: 'outside start' },
      using: {},
    },
    {
      entity: { eid: 'outside-task' },
      claim: { session: 'outside' },
      doc: { title: 'task' },
    },
    {
      entity: { eid: 'outside-note' },
      comment: { target: 'outside-task' },
      doc: { body: 'person reply' },
    },
  ], { trusted: true })
  let lines = await reply(g, {
    entity: { eid: 'outside-call' },
    created: { via: 'outside' },
  })
  assertEquals(lines.length, 2)
  assertEquals((await g.get(['outside-note']))[0].notified != null, true)
  assertEquals((await g.read('.entry.session=outside')).length, 1)
})
