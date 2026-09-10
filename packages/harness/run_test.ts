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
  await a.close()
})

Deno.test('send appends to a transcript and the daemon answers it', async () => {
  let a = started()
  let s = await a.start('one')
  await a.idle(s)
  await a.send(s, 'two')
  await a.idle(s)
  let said = (await a.transcript(s))
    .filter((b) => !b.prompt)
    .map((b) => (b.content as Comp)?.body).filter(Boolean)
  assertEquals(said, ['one', 'heard: one', 'two', 'heard: two'])
  await a.close()
})

Deno.test('a session lists with its derived status, and renders as a line', async () => {
  let a = started()
  let s = await a.start('ping')
  await a.idle(s)
  let [row] = await a.sessions()
  assertEquals(row.entity.eid, s)
  assertEquals((row.session as Comp).status, 'settled')
  let entries = await a.transcript(s)
  assert(a.line(entries.find((b) => !b.prompt && b.content)!).includes('ping'))
  assert(a.line(row, 'Status', { entries }).includes('settled'))
  await a.close()
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
  await a.close()
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
    await a.close()
  }
})

Deno.test('transcript titles ignore instruction snapshots and lazy notices', () => {
  assertEquals(
    titleOf([
      {
        entity: { eid: 'p' },
        prompt: { scope: 'shared' },
        content: { body: 'rules' },
      },
      { entity: { eid: 'n' }, notice: {}, content: { body: 'task started' } },
      { entity: { eid: 'u' }, content: { body: 'actual request\nmore' } },
    ]),
    'actual request',
  )
  assertEquals(
    titleOf([
      { entity: { eid: 'p' }, prompt: {}, content: { body: 'rules' } },
    ]),
    '',
  )
})

Deno.test('archiving is a persistent visibility mark, not an execution transition', async () => {
  let a = started()
  try {
    let root = await a.start('Archive me')
    await a.idle(root)
    let before = await a.transcript(root)
    await a.archive(root, true)
    assertEquals(
      Boolean((await a.sessions()).find((b) => b.entity.eid == root)?.archived),
      true,
    )
    assertEquals(await a.transcript(root), before)
    await a.archive(root, false)
    assertEquals(
      Boolean((await a.sessions()).find((b) => b.entity.eid == root)?.archived),
      false,
    )
  } finally {
    await a.close()
  }
})

Deno.test('session titles use local assignment, not inherited parent context', async () => {
  let h = open(':memory:')
  await h.g.apply([
    { entity: { eid: 'parent' }, session: { id: 'parent' } },
    {
      entity: { eid: 'parent-input' },
      entry: { session: 'parent', seq: 1 },
      content: { body: 'Parent discussion' },
    },
    {
      entity: { eid: 'parent-stop' },
      entry: { session: 'parent', seq: 2 },
      stop: {},
    },
    {
      entity: { eid: 'worker' },
      session: { id: 'worker' },
      fork: { from: 'parent-input' },
      spawned: { parent: 'parent' },
    },
    {
      entity: { eid: 'assignment' },
      entry: { session: 'worker', seq: 2 },
      content: { body: 'Research mushrooms' },
    },
    {
      entity: { eid: 'worker-stop' },
      entry: { session: 'worker', seq: 3 },
      stop: {},
    },
  ])
  let a = agent({ h, model: echo, tools: [] })
  try {
    assertEquals(
      ((await a.sessions()).find((b) => b.entity.eid == 'worker')
        ?.session as Comp)?.title,
      'Research mushrooms',
    )
    await a.archive('worker', true)
    assertEquals(
      Boolean(
        (await a.sessions()).find((b) => b.entity.eid == 'parent')?.archived,
      ),
      true,
    )
    assertEquals(
      (await a.sessions()).find((b) => b.entity.eid == 'worker')?.archived,
      undefined,
    )
  } finally {
    await a.close()
  }
})

Deno.test('Agent close stops admission and drains an active model before SQLite closes', async () => {
  let entered = Promise.withResolvers<void>()
  let release = Promise.withResolvers<void>()
  let a = started(async (req) => {
    entered.resolve()
    await release.promise
    return echo(req)
  })
  await a.start('active')
  await entered.promise
  let closed = false
  let shutdown = a.close()
  shutdown.then(() => closed = true)
  assertEquals(a.close(), shutdown)
  await new Promise((r) => setTimeout(r, 20))
  assertEquals(closed, false)
  // The native connection is still usable under the admitted callback.
  assertEquals((await a.h.g.read('.session')).length, 1)
  let refused = false
  try {
    await a.start('too late')
  } catch {
    refused = true
  }
  assertEquals(refused, true)
  release.resolve()
  await shutdown
  assertEquals(closed, true)
})

Deno.test('close drains a held storage callback without stopping an independent process', async () => {
  let a = started()
  let entered = Promise.withResolvers<void>()
  let release = Promise.withResolvers<void>()
  let process = new Deno.Command('/bin/sleep', { args: ['10'] }).spawn()
  try {
    let s = await a.start('callback')
    await a.idle(s)
    let callback = a.d.enqueue(s, async () => {
      entered.resolve()
      await release.promise
      await a.h.g.apply([{ entity: { eid: crypto.randomUUID() }, task: {} }])
    })
    await entered.promise
    let close = a.close()
    release.resolve()
    await callback
    await close
    // Independent process ownership is not transferred to Agent.close().
    Deno.kill(process.pid, 'SIGCONT')
  } finally {
    process.kill('SIGTERM')
    await process.status
    await a.close()
  }
})

Deno.test('send commits during a provider turn and unserved input reaches the next anchored request', async () => {
  let release!: (value: Awaited<ReturnType<Model>>) => void
  let began!: () => void
  let first = new Promise<Awaited<ReturnType<Model>>>((resolve) =>
    release = resolve
  )
  let called = new Promise<void>((resolve) => began = resolve)
  let requests: Parameters<Model>[0][] = []
  let model: Model = (req) => {
    requests.push(req)
    if (requests.length == 1) {
      began()
      return first
    }
    return echo(req)
  }
  model.mark = (reply) => ({ openai: { response_id: reply.id } })
  model.anchor = (b) =>
    (b.openai as Comp | undefined)?.response_id as string | undefined
  let a = started(model)
  let s = await a.start('first')
  try {
    await called
    await a.send(s, 'while waiting')
    let committed = await a.transcript(s)
    assert(
      committed.some((b) =>
        (b.content as Comp | undefined)?.body == 'while waiting'
      ),
    )
    assertEquals(requests.length, 1)
    assert(!committed.some((b) => b.ask), 'first provider has not returned')
    release({
      id: 'r-first',
      model: 'fake',
      items: [{ kind: 'assistant', text: 'first reply' }],
    })
    await a.idle(s)
    assertEquals(requests.length, 2)
    assertEquals(requests[1].anchor, 'r-first')
    assert(
      requests[1].items.some((i) =>
        i.kind == 'user' && i.text == 'while waiting'
      ),
    )
    let entries = await a.transcript(s)
    let seqs = entries.map((b) => Number((b.entry as Comp).seq))
    assertEquals(new Set(seqs).size, seqs.length)
    assertEquals(statusOf(entries), 'settled')
  } finally {
    release({
      id: 'cleanup',
      model: 'fake',
      items: [{ kind: 'assistant', text: 'done' }],
    })
    await a.idle(s)
    a.close()
  }
})
