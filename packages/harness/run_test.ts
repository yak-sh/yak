import { assert, assertEquals, assertRejects } from '@std/assert'
import type { Comp } from '@yaks/graph'
import type { Model } from '@yaks/model'
import { react, statusOf, transcript, UnknownSession } from '@yaks/session'
import { agent, idOf, seed, titleOf } from './run.ts'
import { open } from './store.ts'

// A model that answers with whatever it was last told, so a test can see the
// transcript go round.
let echo: Model = (req) =>
  Promise.resolve({
    id: 'r1',
    model: req.model,
    items: [{
      kind: 'assistant',
      text: req.items.at(-1)?.kind == 'user'
        ? `heard: ${(req.items.at(-1) as { text: string }).text}`
        : 'nothing said',
    }],
  })

let started = (model: Model = echo) =>
  agent({ h: open(':memory:'), model, tools: [] })

Deno.test('the seed is the same rows however many times it is applied', async () => {
  let h = open(':memory:')
  h.g.apply(seed(), { trusted: true })
  h.g.apply(seed(), { trusted: true })
  assertEquals((await h.g.read('.provider')).length, 1)
  let models = await h.g.read('.model')
  assertEquals(models.map((b) => b.entity.eid), [idOf('model', 'gpt-6-astra')])
  h.close()
})

Deno.test('a started transcript runs to settled and reads back', async () => {
  let a = started()
  let s = await a.start('ping')
  await a.idle(s)
  let entries = await a.transcript(s)
  assertEquals(statusOf(entries), 'settled')
  assertEquals(titleOf(entries), 'ping')
  assertEquals((entries.at(-1)!.content as Comp).body, 'heard: ping')
  a.close()
})

Deno.test('send appends to a transcript and the daemon answers it', async () => {
  let a = started()
  let s = await a.start('one')
  await a.idle(s)
  await a.send(s, 'two')
  await a.idle(s)
  let said = (await a.transcript(s))
    .map((b) => (b.content as Comp)?.body).filter(Boolean)
  assertEquals(said, ['one', 'heard: one', 'two', 'heard: two'])
  a.close()
})

Deno.test('a session lists with its derived status, and renders as a line', async () => {
  let a = started()
  let s = await a.start('ping')
  await a.idle(s)
  let [row] = await a.sessions()
  assertEquals(row.entity.eid, s)
  assertEquals((row.session as Comp).status, 'settled')
  let entries = await a.transcript(s)
  assert(a.line(entries[0]).includes('ping'))
  assert(a.line(row, 'Status', { entries }).includes('settled'))
  a.close()
})

Deno.test('the agent reads bare and filed open work, including claims and blocked facets', async () => {
  let a = started()
  await a.h.g.apply([
    { entity: { eid: 't1' }, doc: { title: 'first' }, task: {} },
    { entity: { eid: 'holder' }, session: {} },
    {
      entity: { eid: 't2' },
      doc: { title: 'done already' },
      task: {},
      completed: {},
      claim: { session: 'holder' },
    },
    {
      entity: { eid: 't3' },
      doc: { title: 'claimed microtask' },
      task: {},
      claim: { session: 'holder' },
    },
    {
      entity: { eid: 't4' },
      doc: { title: 'filed work' },
      task: {},
      filed: { priority: 2, domain: 'Eng' },
      blocked: { on: 'a reply' },
    },
    { entity: { eid: 't5' }, task: {}, cancelled: {} },
    { entity: { eid: 'not-work' }, filed: { priority: 1 } },
  ])
  let work = await a.tasks()
  assertEquals(
    work.map((b) => (b.doc as Comp).title),
    ['first', 'claimed microtask', 'filed work'],
  )
  assertEquals(work.map((b) => (b.task as Comp).status), [
    'open',
    'wip',
    'open',
  ])
  assertEquals(work.slice(0, 2).map((b) => b.filed), [undefined, undefined])
  a.close()
})

Deno.test('resume wakes what a restart left owed a turn', async () => {
  let h = open(':memory:')
  // A transcript with an input nobody answered — what a killed harness leaves.
  let quiet = agent({ h, model: echo, tools: [] })
  let s = await quiet.start('ping')
  await quiet.idle(s)
  // Straight through storage, so no effect observes it — the entry a harness
  // committed a moment before it was killed.
  h.store.tx((tx) =>
    tx.patch([{
      entity: { eid: 'in2' },
      entry: { session: s, seq: 99 },
      content: { body: 'unanswered' },
    }])
  )
  assertEquals(statusOf(await quiet.transcript(s)), 'pending')
  assertEquals(await quiet.resume(), [s])
  await quiet.idle(s)
  assertEquals(statusOf(await quiet.transcript(s)), 'settled')
  quiet.close()
})

Deno.test('transcript doors refuse unknown sessions before doing work', async () => {
  let asked = 0
  let model: Model = (req) => {
    asked++
    return echo(req)
  }
  let a = started(model)
  try {
    for (let session of ['unknown-prefix', a.model]) {
      for (
        let read of [
          () => transcript(a.h.g, session),
          () => react(a.h.g, session, { model, tools: [] }),
          () => a.transcript(session),
          () => a.send(session, 'no orphan input'),
        ]
      ) {
        let err = await assertRejects(read, UnknownSession)
        assertEquals(err.name, 'UnknownSession')
        assertEquals(err.message, `unknown session ${session}`)
        assertEquals(err.session, session)
      }
    }
    assertEquals(asked, 0)
    assertEquals(await a.h.g.read('.entry'), [])
    await a.h.g.apply([{ entity: { eid: 'empty' }, session: {} }])
    assertEquals(await a.transcript('empty'), [])
    assertEquals(
      await react(a.h.g, 'empty', { model, tools: [] }),
      { did: 'nothing', status: 'empty', added: [] },
    )
  } finally {
    a.close()
  }
})
