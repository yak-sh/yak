import { assert, assertEquals, assertRejects } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import {
  daemon,
  deliverChild,
  sessionTools,
  textOf,
  transcript,
} from '@yaks/session'
import { harnessTools } from './tools.ts'
import { open } from './store.ts'
import { agent } from './run.ts'

let setup = () => {
  let h = open(':memory:')
  h.g.apply([
    { entity: { eid: 'p' }, session: {} },
    {
      entity: { eid: 'input' },
      entry: { session: 'p', seq: 1 },
      content: { body: 'Start' },
    },
    {
      entity: { eid: 'ask' },
      entry: { session: 'p', seq: 2 },
      ask: { through: 'input' },
    },
    ...['other-call', 'call-0', 'call-1'].map((eid, n) => ({
      entity: { eid },
      entry: { session: 'p', seq: n + 4 },
      call: {},
    })),
    {
      entity: { eid: 'call' },
      entry: { session: 'p', seq: 3 },
      call: { source: 'ask' },
    },
    {
      entity: { eid: 'work' },
      task: {},
      doc: { title: 'Title', body: 'Body' },
    },
  ])
  let ctx = { session: 'p', call: { entity: { eid: 'call' } }, entries: [] }
  let tools = sessionTools(h.g)
  return {
    h,
    ctx,
    spawn: tools.find((t) => t.name == 'spawn')!,
    wait: tools.find((t) => t.name == 'wait')!,
  }
}

Deno.test('task spawn snapshots doc and commits claim before first entry effect; replay and lease collision', async () => {
  let { h, ctx, spawn } = setup()
  let observations: string[] = []
  h.fx.created('entry', async (e) => {
    if (e.comp?.session != 'child:call') return
    let [task] = await h.g.read('.task')
    observations.push(String((task.claim as Comp).session))
  })
  let [work] = await h.g.read('.task')
  assertEquals(work.entity.num, undefined)
  let child = await spawn.run({ task: work.entity.eid }, ctx)
  assertEquals((await h.g.read('.spawned'))[0].entity.num, undefined)
  assertEquals(child, 'child:call')
  assertEquals(observations, [child])
  assertEquals((await h.g.read('.task.status=wip')).map((b) => b.entity.eid), [
    'work',
  ])
  assertEquals(
    textOf((await transcript(h.g, String(child)))[0]),
    'Title\n\nBody',
  )
  await h.g.apply([{ entity: { eid: 'work' }, doc: { title: 'Edited' } }])
  assertEquals(await spawn.run({ task: 'work' }, ctx), child)
  assertEquals(
    textOf((await transcript(h.g, String(child)))[0]),
    'Title\n\nBody',
  )
  await assertRejects(() =>
    Promise.resolve(spawn.run({ task: 'work', model: 'orphan' }, {
      ...ctx,
      call: { entity: { eid: 'other-call' } },
    }))
  )
  assertEquals((await h.g.read('.spawned')).length, 1)
  assertEquals((await h.g.read('.model.name=orphan')).length, 0)
  for (
    let args of [{ task: 'missing' }, { task: 'p' }, { task: '' }, {
      task: 'work',
      prompt: 'both',
    }, {}]
  ) {
    await assertRejects(() =>
      Promise.resolve(
        spawn.run(args, { ...ctx, call: { entity: { eid: 'bad' } } }),
      )
    )
  }
  h.close()
})

Deno.test('independent tasks spawn concurrently with ordinary child caps', async () => {
  let { h, ctx } = setup()
  await h.g.apply([{
    entity: { eid: 'second' },
    task: {},
    doc: { title: 'Two' },
  }])
  let spawn = sessionTools(h.g, { maxChildren: 2 }).find((t) =>
    t.name == 'spawn'
  )!
  let out = await Promise.all(
    ['work', 'second'].map((task, n) =>
      spawn.run({ task }, { ...ctx, call: { entity: { eid: `call-${n}` } } })
    ),
  )
  assertEquals(new Set(out).size, 2)
  assertEquals((await h.g.read('.task .claim.session!')).length, 2)
  await assertRejects(() => Promise.resolve(spawn.run({ task: 'work' }, ctx)))
  h.close()
})

Deno.test('task wait uses done including contains/requires and cancellation; merged wait validates alternatives', async () => {
  let { h, ctx, spawn } = setup()
  await spawn.run({ task: 'work' }, ctx)
  let wait = harnessTools(h.g).find((t) => t.name == 'wait')!
  let read = async (timeout = 0) =>
    JSON.parse(String(await wait.run({ tasks: ['work'], timeout }, ctx)))
  assertEquals(await read(), [{ task: 'work', status: 'wip', done: false }])
  await h.g.apply([
    { entity: { eid: 'work' }, completed: {} },
    { entity: { eid: 'dep' }, task: {} },
    { entity: { eid: 'part' }, task: {}, cancelled: {} },
    {
      entity: { eid: 'requires-edge' },
      edge: { from: 'work', to: 'dep' },
      requires: {},
    },
    {
      entity: { eid: 'contains-edge' },
      edge: { from: 'work', to: 'part' },
      contains: {},
    },
  ])
  assertEquals(await read(), [{ task: 'work', status: 'done', done: false }])
  let waiting = read(1000)
  await h.g.apply([{ entity: { eid: 'dep' }, cancelled: {} }])
  assertEquals(await waiting, [{ task: 'work', status: 'done', done: true }])
  for (
    let args of [
      { tasks: [] },
      { tasks: ['missing'] },
      { tasks: ['work'], timeout: -1 },
      { tasks: ['work'], children: ['child:call'] },
      { tasks: ['work'], process: 'x' },
      { children: ['child:call'], process: 'x' },
      { tasks: ['work'], children: ['child:call'], process: 'x' },
      {},
    ]
  ) {
    await assertRejects(async () => {
      await wait.run(args, ctx)
    })
  }
  h.close()
})

Deno.test('task completion receipt is idempotent, keeps final message, and incomplete children still report', async () => {
  let { h, ctx, spawn } = setup()
  let child = String(await spawn.run({ task: 'work' }, ctx))
  await h.g.apply([
    { entity: { eid: 'work' }, completed: {} },
    {
      entity: { eid: 'final' },
      entry: { session: child, seq: 2 },
      content: { body: 'Final answer', source: 'call' },
    },
  ])
  await deliverChild(h.g, child)
  await deliverChild(h.g, child)
  let entries = await transcript(h.g, 'p')
  let receipt = entries.at(-1)!
  assertEquals(receipt.entity.eid, `delivery:${child}:task:work:done`)
  assertEquals((receipt.result as Comp).call, 'call')
  assertEquals(textOf(receipt), 'task work done\nFinal answer')
  await h.g.apply([{ entity: { eid: 'work' }, completed: null }])
  await deliverChild(h.g, child)
  assertEquals(
    textOf((await transcript(h.g, 'p')).at(-1)!),
    `child ${child} settled\nFinal answer`,
  )
  h.close()
})

for (let finish of ['complete', 'unlink']) {
  Deno.test(`task effect returns a quiet child when dependency ${finish}s`, async () => {
    let { h, ctx, spawn } = setup()
    let child = String(await spawn.run({ task: 'work' }, ctx))
    await h.g.apply([
      { entity: { eid: 'work' }, completed: {} },
      { entity: { eid: 'dep' }, task: {} },
      {
        entity: { eid: 'edge' },
        edge: { from: 'work', to: 'dep' },
        contains: {},
      },
      {
        entity: { eid: 'final' },
        entry: { session: child, seq: 2 },
        content: { body: 'Finished my part', source: 'call' },
      },
    ])
    await deliverChild(h.g, child) // incomplete task still reports the child settling
    let errors: unknown[] = []
    let d = daemon(
      h.g,
      h.fx,
      {
        model: () =>
          Promise.resolve({
            id: 'r',
            model: 'fake',
            items: [{ kind: 'assistant', text: 'Received' }],
          }),
        tools: [],
      },
      undefined,
      (e) => errors.push(e),
    )
    await h.g.apply(
      finish == 'complete'
        ? [{ entity: { eid: 'dep' }, completed: {} }]
        : [{ entity: { eid: 'edge' }, tombstone: {} }] as Bundle[],
    )
    await d.idle('p')
    let receipt = (await transcript(h.g, 'p')).find((b) =>
      b.entity.eid == `delivery:${child}:task:work:done`
    )
    assert(receipt)
    assert(textOf(receipt).endsWith('\nFinished my part'))
    assertEquals(errors, [])
    await d.stop()
    h.close()
  })
}

Deno.test('child marks task done through a tool before its final answer: one final receipt', async () => {
  let h = open(':memory:')
  await h.g.apply([{
    entity: { eid: 'work' },
    task: {},
    doc: { title: 'Child work' },
  }])
  let parentTurns = 0
  let childTurns = 0
  let tools = sessionTools(h.g)
  tools.push({
    name: 'complete',
    description: '',
    parameters: {},
    run: async () => {
      await h.g.apply([{ entity: { eid: 'work' }, completed: {} }])
      return 'intermediate tool output'
    },
  })
  let a = agent({
    h,
    tools,
    model: (req) => {
      let child = req.items.some((i) =>
        i.kind == 'user' && i.text == 'Child work'
      )
      let tool = child
        ? childTurns++ == 0 ? 'complete' : null
        : parentTurns++ == 0
        ? 'spawn'
        : null
      return Promise.resolve({
        id: 'r',
        model: 'fake',
        items: tool
          ? [{
            kind: 'call',
            name: tool,
            id: tool,
            args: JSON.stringify(tool == 'spawn' ? { task: 'work' } : {}),
          }]
          : [{
            kind: 'assistant',
            text: child ? 'The final answer' : 'Parent answer',
          }],
      })
    },
  })
  let parent = await a.start('Parent work')
  await a.idle(parent)
  for (let child of await a.children(parent)) await a.idle(child.entity.eid)
  await a.idle(parent)
  let receipts = (await a.transcript(parent)).filter((b) =>
    b.entity.eid.startsWith('delivery:')
  )
  assertEquals(receipts.length, 1)
  assert(textOf(receipts[0]).endsWith('\nThe final answer'))
  await a.close()
})

Deno.test('cancelled task returns cancelled; stopped parents do not receive deliveries', async () => {
  let { h, ctx, spawn } = setup()
  let child = String(await spawn.run({ task: 'work' }, ctx))
  await h.g.apply([
    { entity: { eid: 'work' }, cancelled: {} },
    {
      entity: { eid: 'final' },
      entry: { session: child, seq: 2 },
      content: { body: 'Cancelled safely', source: 'call' },
    },
  ])
  await deliverChild(h.g, child)
  let receipt = (await transcript(h.g, 'p')).at(-1)!
  assertEquals(receipt.entity.eid, `delivery:${child}:task:work:cancelled`)
  assert(textOf(receipt).endsWith('cancelled\nCancelled safely'))
  let seq = Number((receipt.entry as Comp).seq)
  await h.g.apply([
    {
      entity: { eid: 'parent-stop' },
      entry: { session: 'p', seq: seq + 1 },
      stop: {},
    },
    { entity: { eid: 'work' }, cancelled: null, completed: {} },
  ])
  await deliverChild(h.g, child)
  assertEquals((await transcript(h.g, 'p')).at(-1)!.entity.eid, 'parent-stop')
  h.close()
})

for (let writer of ['p', 'child', 'other', 'external']) {
  Deno.test(
    'completion by ' + writer +
      ': durable provenance controls only the redundant receipt',
    async () => {
      let { h, ctx, spawn } = setup()
      let child = String(await spawn.run({ task: 'work' }, ctx))
      await h.g.apply([{
        entity: { eid: 'answer' },
        entry: { session: child, seq: 2 },
        content: { body: 'Finished', source: 'call' },
      }])
      await deliverChild(h.g, child)
      // Close the original tool call so any new receipt would wake the parent.
      let before = (await transcript(h.g, 'p')).length
      let asks = 0
      let errors: unknown[] = []
      let d = daemon(
        h.g,
        h.fx,
        {
          model: () => {
            asks++
            return Promise.resolve({
              id: 'r',
              model: 'fake',
              items: [{ kind: 'assistant', text: 'Received' }],
            })
          },
          tools: [],
        },
        undefined,
        (e) => errors.push(e),
      )
      let actor = writer == 'child' ? child : writer
      if (writer == 'external') {
        await h.g.apply([{ entity: { eid: 'work' }, completed: {} }])
      } else {
        let apply = harnessTools(h.g).find((t) => t.name == 'graph_apply')!
        await apply.run({
          change: [{
            entity: { eid: 'work' },
            completed: {},
            $actor: { by: 'spoof' },
          }],
        }, { ...ctx, session: actor })
      }
      await d.idle('p')
      let [work] = await h.g.read('.task')
      assertEquals(
        (work.completed as Comp).by ?? null,
        writer == 'external' ? null : actor,
      )
      let receiptId = 'delivery:' + child + ':task:work:done'
      assertEquals(
        (await transcript(h.g, 'p')).some((b) => b.entity.eid == receiptId),
        writer != 'p',
      )
      if (writer == 'p') {
        assertEquals(asks, 0)
        assertEquals((await transcript(h.g, 'p')).length, before)
      }
      let after = (await transcript(h.g, 'p')).length
      // Reconstruct delivery from durable state, with no remembered actor/event.
      await h.g.apply([{
        entity: { eid: 'work' },
        completed: { at: '2026-01-01T00:00:00Z' },
        $actor: { by: 'later-editor' },
      }])
      await deliverChild(h.g, child)
      await deliverChild(h.g, child)
      await d.idle('p')
      assertEquals((await transcript(h.g, 'p')).length, after)
      assertEquals(errors, [])
      await d.stop()
      h.close()
    },
  )
}

Deno.test('parent completion does not suppress a later child response', async () => {
  let { h, ctx, spawn } = setup()
  let child = String(await spawn.run({ task: 'work' }, ctx))
  let apply = harnessTools(h.g).find((t) => t.name == 'graph_apply')!
  await apply.run({ change: [{ entity: { eid: 'work' }, completed: {} }] }, ctx)
  await h.g.apply([{
    entity: { eid: 'later-answer' },
    entry: { session: child, seq: 2 },
    content: { body: 'New response', source: 'call' },
  }])
  await deliverChild(h.g, child)
  let entries = await transcript(h.g, 'p')
  assertEquals(
    entries.at(-1)!.entity.eid,
    'delivery:' + child + ':later-answer',
  )
  assert(textOf(entries.at(-1)!).endsWith('New response'))
  h.close()
})

Deno.test('completion author survives database reopen; another parent still receives the result', async () => {
  let dir = Deno.makeTempDirSync()
  let path = dir + '/receipt.db'
  let h = open(path)
  try {
    await h.g.apply([
      { entity: { eid: 'p' }, session: {} },
      { entity: { eid: 'q' }, session: {} },
      { entity: { eid: 'c' }, session: {}, spawned: { parent: 'p' } },
      { entity: { eid: 'work' }, task: {}, claim: { session: 'c' } },
      {
        entity: { eid: 'final' },
        entry: { session: 'c', seq: 1 },
        content: { body: 'Finished', source: 'source' },
      },
    ])
    await deliverChild(h.g, 'c')
    await h.g.apply([{
      entity: { eid: 'work' },
      completed: {},
      $actor: { by: 'p' },
    }])
    h.close()
    h = open(path)
    let before = (await transcript(h.g, 'p')).length
    await deliverChild(h.g, 'c')
    assertEquals((await transcript(h.g, 'p')).length, before)
    // Suppression compares the recipient, not merely the existence of an actor.
    await h.g.apply([{ entity: { eid: 'c' }, spawned: { parent: 'q' } }])
    await deliverChild(h.g, 'c')
    assertEquals(
      (await transcript(h.g, 'q')).at(-1)!.entity.eid,
      'delivery:c:task:work:done',
    )
  } finally {
    h.close()
    Deno.removeSync(dir, { recursive: true })
  }
})

Deno.test('reopening a task allows a new completion author', async () => {
  let { h } = setup()
  await h.g.apply([{
    entity: { eid: 'work' },
    completed: {},
    $actor: { by: 'p' },
  }])
  await h.g.apply([{ entity: { eid: 'work' }, completed: null }])
  await h.g.apply([{
    entity: { eid: 'work' },
    completed: {},
    $actor: { by: 'q' },
  }])
  let [work] = await h.g.read('.task')
  assertEquals((work.completed as Comp).by, 'q')
  h.close()
})

Deno.test('existing fork receipts do not read inherited transcript bodies on resume', async () => {
  let h = open(':memory:')
  await h.g.apply([
    { entity: { eid: 'parent' }, session: {} },
    {
      entity: { eid: 'source' },
      entry: { session: 'parent' },
      content: { body: 'request' },
    },
    {
      entity: { eid: 'answer' },
      entry: { session: 'parent' },
      content: { body: 'large history', source: 'source' },
    },
    {
      entity: { eid: 'child' },
      session: {},
      spawned: { parent: 'parent' },
      fork: { from: 'answer' },
      dispatch: { state: 'settled', order: 1 },
    },
    {
      entity: { eid: 'child-answer' },
      entry: { session: 'child' },
      content: { body: 'done', source: 'source' },
    },
    {
      entity: { eid: 'delivery:child:child-answer' },
      entry: { session: 'parent' },
      content: { body: 'delivered', source: 'source' },
    },
  ])
  let reads: string[] = []
  let read = h.g.read.bind(h.g)
  h.g.read = ((query: string, ...rest: unknown[]) => {
    reads.push(query)
    return read(query, ...rest as [])
  }) as typeof h.g.read
  let a = agent({
    h,
    name: 'fake',
    model: () => {
      throw new Error('settled children must not execute')
    },
  })
  try {
    assertEquals(await a.resume(), [])
    await a.d.idle('parent')
    assert(!reads.some((q) => q == '.entry.session=parent'), reads.join('\n'))
    assert(!reads.some((q) => q == '.entry.session=child'), reads.join('\n'))
    let [child] = await h.g.storage.tx((tx) => tx.get(['child']))
    assertEquals((child.dispatch as Comp).state, 'settled')
    assertEquals((await read('.entry.session=parent')).length, 3)
  } finally {
    await a.close()
  }
})

Deno.test('receipt fast-path refreshes its tail when a child finishes between reads', async () => {
  let h = open(':memory:')
  await h.g.apply([
    { entity: { eid: 'p' }, session: {} },
    {
      entity: { eid: 'p-input' },
      entry: { session: 'p' },
      content: { body: 'parent' },
    },
    { entity: { eid: 'c' }, session: {}, spawned: { parent: 'p' } },
    {
      entity: { eid: 'request' },
      entry: { session: 'c' },
      content: { body: 'work' },
    },
    {
      entity: { eid: 'attempt' },
      entry: { session: 'c' },
      ask: { through: 'request' },
      attempt: { state: 'inflight' },
    },
  ])
  let read = h.g.read.bind(h.g)
  let finished = false
  h.g.read = (async (query: string, ...rest: unknown[]) => {
    let rows = await read(query, ...rest as [])
    if (!finished && query.includes('.order=-entry.seq')) {
      finished = true
      await h.g.apply([
        { entity: { eid: 'attempt' }, attempt: { state: 'completed' } },
        {
          entity: { eid: 'final' },
          entry: { session: 'c' },
          content: { body: 'final answer', source: 'attempt' },
        },
      ])
    }
    return rows
  }) as typeof h.g.read
  try {
    await deliverChild(h.g, 'c')
    let rows = await read('.entry.session=p')
    assertEquals(rows.length, 2)
    assertEquals(rows[1].entity.eid, 'delivery:c:final')
    assert(textOf(rows[1]).includes('final answer'))
  } finally {
    h.close()
  }
})
