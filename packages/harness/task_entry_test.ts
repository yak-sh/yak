import { assert, assertEquals, assertRejects } from '@std/assert'
import type { Comp } from '@yaks/graph'
import { taskEntry } from '@yaks/session'
import { agent } from './run.ts'
import { open } from './store.ts'

Deno.test('taskEntry atomically mints bare work, contains it, and spawns with inherited settings', async () => {
  let h = open(':memory:')
  try {
    await h.g.apply([
      { entity: { eid: 'p' }, session: { id: 'parent' } },
      { entity: { eid: 'm' }, model: { name: 'fake' } },
      {
        entity: { eid: 'input' },
        entry: { session: 'p', seq: 1 },
        content: { body: 'parent' },
        using: { model: 'm', effort: 'high' },
      },
    ])
    let first = await taskEntry(h.g, 'p', 'Title\n\nComplete body')
    let [task] = await h.g.read(`.task .claim.session=${first.child}`)
    assertEquals(task.doc, { title: 'Title', body: 'Title\n\nComplete body' })
    assertEquals((task.task as Comp).status, 'wip') // derived, not written
    assert(
      Object.entries(task.task as Comp).every(([key, value]) =>
        key == 'status' || value == null
      ),
    )
    assert(!task.filed)
    let [edge] = await h.g.read(`.contains .edge.to=${first.task}`)
    assertEquals((edge.edge as Comp).from, 'p')
    let [child] = await h.g.read(`.spawned.parent=p`)
    assertEquals((child.spawned as Comp).parent, 'p')
    assert(!(child.spawned as Comp).call) // no invented tool call
    let input = (await h.g.read(`.entry.session=${first.child}`)).find((b) =>
      b.using
    )!
    assertEquals((input.using as Comp).model, 'm')
    assertEquals((input.using as Comp).effort, 'high')
    assertEquals(
      (input.content as Comp).body,
      'Title\n\nComplete body',
    )
    await h.g.apply([
      { entity: { eid: 'work1' }, task: {}, claim: { session: 'p' } },
      { entity: { eid: 'work2' }, task: {}, claim: { session: 'p' } },
    ])
    let second = await taskEntry(h.g, 'p', 'Nested')
    let edges = await h.g.read(`.contains .edge.to=${second.task}`)
    assertEquals(edges.map((b) => (b.edge as Comp).from).sort(), [
      'work1',
      'work2',
    ])
  } finally {
    h.close()
  }
})

Deno.test('taskEntry rejects invalid inputs and durably accepts concurrent queued tasks', async () => {
  let h = open(':memory:')
  try {
    await h.g.apply([{ entity: { eid: 'p' }, session: { id: 'parent' } }])
    await assertRejects(() => taskEntry(h.g, 'p', ' \n '), Error, 'nonempty')
    await assertRejects(
      () => taskEntry(h.g, 'missing', 'work'),
      Error,
      'not a session',
    )
    assertEquals(await h.g.read('.task'), [])
    let results = await Promise.allSettled([
      taskEntry(h.g, 'p', 'one', { maxChildren: 1 }),
      taskEntry(h.g, 'p', 'two', { maxChildren: 1 }),
    ])
    assertEquals(results.map((r) => r.status), ['fulfilled', 'fulfilled'])
    assertEquals((await h.g.read('.task')).length, 2)
    assertEquals((await h.g.read('.contains')).length, 2)
    assertEquals((await h.g.read('.spawned')).length, 2)
  } finally {
    h.close()
  }
})

Deno.test('Agent.taskEntry honors agent limits', async () => {
  let a = agent({
    h: open(':memory:'),
    tools: [],
    maxChildren: 0,
    model: () =>
      Promise.resolve({
        id: 'r',
        model: 'fake',
        items: [{ kind: 'assistant', text: 'ready' }],
      }),
  })
  try {
    let parent = await a.start('parent')
    await a.idle(parent)
    await a.taskEntry(parent, 'work')
    assertEquals((await a.tasks()).length, 1)
    assertEquals(
      (await a.children(parent)).filter((b) =>
        (b.dispatch as Comp)?.state == 'queued'
      ).length,
      1,
    )
  } finally {
    await a.close()
  }
})

Deno.test('auto-task notice is lazy, reaches next ask, and contextual completion is idempotent', async () => {
  let requests: string[] = []
  let release!: () => void
  let waiting = new Promise<void>((resolve) => release = resolve)
  let h = open(':memory:')
  let a = agent({
    h,
    tools: [],
    model: async (req) => {
      let text = JSON.stringify(req.items)
      requests.push(text)
      if (text.includes('Original task request') && !text.includes('Origin:')) {
        await waiting
        return {
          id: 'child-answer',
          model: 'fake',
          items: [{ kind: 'assistant', text: 'Child result' }],
        }
      }
      return {
        id: 'parent-answer',
        model: 'fake',
        items: [{ kind: 'assistant', text: 'ready' }],
      }
    },
  })
  try {
    let parent = await a.start('parent')
    await a.idle(parent)
    let { child } = await a.taskEntry(
      parent,
      'Original task request\nDetails to retain',
    )
    await a.idle(parent)
    assertEquals(
      requests.filter((r) => !r.includes('Original task request')).length,
      1,
    )
    assertEquals(
      (await a.sessions()).find((b) => b.entity.eid == parent)?.session &&
        ((await a.sessions()).find((b) => b.entity.eid == parent)!
          .session as Comp).status,
      'settled',
    )
    assertEquals((await a.transcript(parent)).filter((b) => b.notice).length, 1)
    assertEquals((await a.transcript(parent)).filter((b) => b.ask).length, 1)
    await a.send(parent, 'Continue naturally')
    await a.idle(parent)
    assert(
      requests.some((r) =>
        r.includes('Continue naturally') &&
        r.includes('Origin: user-created task') &&
        r.includes('Details to retain')
      ),
    )
    release()
    await a.idle(child)
    await a.idle(parent)
    let receipts = (await a.transcript(parent)).filter((b) =>
      b.entity.eid.startsWith('delivery:')
    )
    assertEquals(receipts.length, 1)
    let body = String((receipts[0].content as Comp).body)
    for (
      let part of [
        'Original task request',
        'Details to retain',
        'Origin: user-created task',
        'Outcome: child settled',
        'Child result',
      ]
    ) assert(body.includes(part), body)
    await a.resume()
    await a.idle(child)
    await a.idle(parent)
    assertEquals(
      (await a.transcript(parent)).filter((b) =>
        b.entity.eid.startsWith('delivery:')
      ).length,
      1,
    )
  } finally {
    release()
    await a.close()
  }
})

Deno.test('taskEntry records latest inputs beyond mutable output without replay or reload duplication', async () => {
  let h = open(':memory:')
  try {
    await h.g.apply([
      { entity: { eid: 'p' }, session: { id: 'parent' } },
      {
        entity: { eid: 'first' },
        entry: { session: 'p' },
        content: { body: 'first input' },
      },
      {
        entity: { eid: 'active' },
        entry: { session: 'p' },
        ask: { through: 'first' },
        attempt: { state: 'inflight' },
      },
      {
        entity: { eid: 'partial' },
        entry: { session: 'p' },
        content: { body: 'unfinished', source: 'active' },
      },
      {
        entity: { eid: 'latest' },
        entry: { session: 'p' },
        content: { body: 'latest essential instruction' },
      },
    ])
    let result = await taskEntry(h.g, 'p', 'tiny task')
    let { transcript } = await import('@yaks/session')
    let before = await transcript(h.g, result.child)
    assertEquals(
      before.filter((b) =>
        (b.content as Comp)?.body == 'latest essential instruction'
      ).length,
      1,
    )
    assertEquals(before.some((b) => b.entity.eid == 'partial'), false)
    assertEquals(before.some((b) => b.entity.eid == 'first'), true)
    await h.g.apply([{
      entity: { eid: 'partial' },
      content: { body: 'completed output' },
    }])
    assertEquals(await transcript(h.g, result.child), before)
    assertEquals(await transcript(h.g, result.child), before)
  } finally {
    h.close()
  }
})
