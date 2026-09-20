import { assertEquals } from '@std/assert'
import type { Bundle, Comp, ToolCtx } from '@yaks/graph'
import { loadTools } from '@yaks/graph/tools'
import { edgeEid } from '@yaks/edge'
import { taskDoc } from './comp.ts'
import { statusOf } from './status.ts'
import { teamGraph } from './harness.ts'
import { listing, runs } from './tools.ts'

// The runs, built the way a host builds them: a facet is a factory.
let tools = runs()

let ctx = (args: Record<string, unknown>, at: Record<string, string> = {}) =>
  ({
    args,
    graph: {
      address: (ids: string[]) =>
        new Map(ids.filter((i) => at[i]).map((i) => [i, at[i]])),
    },
    read: (q: string) => [{ entity: { eid: q } }],
  }) as unknown as ToolCtx

let comp = (b: Bundle, name: string) => b[name] as Comp

Deno.test('every task tool is declared and implemented', () => {
  assertEquals(loadTools(taskDoc, tools).map((t) => t.name).sort(), [
    'task_list',
    'task_new',
    'task_tree',
    'task_update',
  ])
})

// A tree over a graph that holds the project: the root is read for its name,
// and what the tool answers is what the graph is asked to write.
let planted = async (args: Record<string, unknown>) => {
  let { g } = teamGraph()
  await g.apply([{ entity: { eid: 'p19' }, project: {}, doc: { title: 'TG' } }])
  let said = await tools.task_tree!([], {
    graph: g,
    actor: null,
    read: (q: string) => g.read(q),
    args,
    call: 'c1',
  } as unknown as ToolCtx) as Bundle[]
  return { g, said }
}

Deno.test('a tree lands as one batch, and the links derive their own ids', async () => {
  let { g, said } = await planted({
    project: 'p19',
    nodes: [
      { key: 'goal', title: 'The outcome', relation: 'contains' },
      { key: 'gate', title: 'First', parent: 'goal', relation: 'requires' },
    ],
  })
  await g.apply(said)
  let linked = await g.read('.edge')
  assertEquals(linked.length, 2)
  // The sentence names the entity: the same link stated twice is one row.
  let [goal] = await g.read('.doc.title="The outcome"')
  assertEquals(
    linked.some((b) =>
      b.entity.eid == edgeEid('p19', 'contains', goal.entity.eid)
    ),
    true,
  )
  assertEquals(
    comp(said[said.length - 1], 'content').body,
    [
      'P-1 TG',
      '└─ contains [goal] The outcome',
      '   └─ requires [gate] First',
    ].join('\n'),
  )
})

Deno.test('a dry run renders the tree and writes no task', async () => {
  let { g, said } = await planted({
    project: 'p19',
    dry_run: true,
    nodes: [{ key: 'a', title: 'Only a plan', relation: 'contains' }],
  })
  assertEquals(said.length, 1)
  assertEquals(
    String(comp(said[0], 'content').body).startsWith('dry run\nP-1 TG'),
    true,
  )
  await g.apply(said)
  assertEquals((await g.read('.task')).length, 0)
})

Deno.test('a new task is task{} plus the words, filed where the line said', async () => {
  let [said] = await tools.task_new!(
    [],
    ctx({ title: 'ship it', project: 'P-19', priority: 2 }, { 'P-19': 'p19' }),
  ) as Bundle[]
  assertEquals(comp(said, 'task'), {})
  assertEquals(comp(said, 'doc'), { title: 'ship it' })
  assertEquals(comp(said, 'filed'), { project: 'p19', priority: 2 })
})

Deno.test('a task nobody filed wears no filing', async () => {
  let [said] = await tools.task_new!(
    [],
    ctx({ title: 'a microtask' }),
  ) as Bundle[]
  assertEquals(Object.keys(said).sort(), ['doc', 'entity', 'task'])
})

Deno.test('a listing always says .task, and open unless told otherwise', () => {
  assertEquals(listing(), '.task&.task.status=open')
  assertEquals(listing('.filed.project=P-19'), '.task&.filed.project=P-19')
  assertEquals(listing('hobbit', 5), '.task&hobbit&.limit=5')
})

Deno.test('a status is the marks that mean it', async () => {
  let { g } = teamGraph()
  await g.apply([{ entity: { eid: 't' }, task: {}, doc: { title: 'a task' } }])
  let move = async (status: string) => {
    let said = await tools.task_update!(
      [],
      ctx({ task: 't', status }),
    ) as Bundle[]
    await g.apply(said)
    return statusOf((await g.read('.entity.eid="t"'))[0])
  }
  assertEquals(await move('done'), 'done')
  assertEquals(await move('cancelled'), 'cancelled')
  assertEquals(await move('open'), 'open')
})

Deno.test('what the line left out is left alone', async () => {
  let { g } = teamGraph()
  await g.apply([{
    entity: { eid: 't' },
    task: {},
    doc: { title: 'a task', body: 'why' },
  }])
  await g.apply(
    await tools.task_update!(
      [],
      ctx({ task: 't', title: 'a better title' }),
    ) as Bundle[],
  )
  assertEquals(comp((await g.read('.entity.eid="t"'))[0], 'doc'), {
    title: 'a better title',
    body: 'why',
  })
})
