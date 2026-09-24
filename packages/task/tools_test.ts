import { assertEquals } from '@std/assert'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { loadTools } from '@yaks/graph/tools'
import { taskDoc } from './comp.ts'
import { statusOf } from './status.ts'
import { teamGraph } from './harness.ts'
import { listing, runs } from './tools.ts'

// The runs, built the way a host builds them: a facet is a factory.
let tools = runs()

// A call, and a graph that knows the ids in `at` and answers a read with the
// query it was asked.
let asked = (
  args: Record<string, unknown>,
  at: Record<string, string> = {},
): [Bundle, Graph] => [
  { entity: { eid: 'c1' }, call: { args } },
  {
    address: (ids: string[]) =>
      new Map(ids.filter((i) => at[i]).map((i) => [i, at[i]])),
    read: (q: string) => [{ entity: { eid: q } }],
  } as unknown as Graph,
]

let comp = (b: Bundle, name: string) => b[name] as Comp

Deno.test('every task tool is declared and implemented', () => {
  assertEquals(loadTools(taskDoc, tools).map((t) => t.name).sort(), [
    'task_list',
    'task_new',
    'task_update',
  ])
})

Deno.test('a new task is task{} plus the words, filed where the line said', async () => {
  let [said] = await tools.task_new!(
    ...asked({ title: 'ship it', project: 'P-19', priority: 2 }, {
      'P-19': 'p19',
    }),
  ) as Bundle[]
  assertEquals(comp(said, 'task'), {})
  assertEquals(comp(said, 'doc'), { title: 'ship it' })
  assertEquals(comp(said, 'filed'), { project: 'p19', priority: 2 })
})

Deno.test('a task nobody filed wears no filing', async () => {
  let [said] = await tools.task_new!(
    ...asked({ title: 'a microtask' }),
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
      ...asked({ task: 't', status }),
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
      ...asked({ task: 't', title: 'a better title' }),
    ) as Bundle[],
  )
  assertEquals(comp((await g.read('.entity.eid="t"'))[0], 'doc'), {
    title: 'a better title',
    body: 'why',
  })
})
