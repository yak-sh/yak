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
    let [input] = await h.g.read(`.entry.session=${first.child}`)
    assertEquals((input.using as Comp).model, 'm')
    assertEquals((input.using as Comp).effort, 'high')
    assertEquals(
      (input.content as Comp).body,
      'Title\n\nTitle\n\nComplete body',
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

Deno.test('taskEntry refuses empty/missing parent and concurrent caps without orphan tasks or edges', async () => {
  let h = open(':memory:')
  try {
    await h.g.apply([{ entity: { eid: 'p' }, session: { id: 'parent' } }])
    await assertRejects(() => taskEntry(h.g, 'p', ' \n '), Error, 'nonempty')
    await assertRejects(
      () => taskEntry(h.g, 'missing', 'work'),
      Error,
      'not a session',
    )
    await assertRejects(
      () => taskEntry(h.g, 'p', 'work', { maxSessions: 1 }),
      Error,
      'session cap',
    )
    assertEquals(await h.g.read('.task'), [])
    let results = await Promise.allSettled([
      taskEntry(h.g, 'p', 'one', { maxChildren: 1 }),
      taskEntry(h.g, 'p', 'two', { maxChildren: 1 }),
    ])
    assertEquals(results.map((r) => r.status), ['fulfilled', 'rejected'])
    assertEquals((await h.g.read('.task')).length, 1)
    assertEquals((await h.g.read('.contains')).length, 1)
    assertEquals((await h.g.read('.spawned')).length, 1)
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
    await assertRejects(() => a.taskEntry(parent, 'work'), Error, 'child cap')
    assertEquals(await a.tasks(), [])
  } finally {
    a.close()
  }
})
