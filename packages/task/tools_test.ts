import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { type Bundle, type Comp, type Graph, Stale, token } from '@yaks/graph'
import { statusOf } from './words.ts'
import { store, teamGraph } from './testing.ts'
import { listing, runs } from './tools.ts'

// The runs, built the way a host builds them: a facet is a factory.
let tools = runs()

// A call, and a graph that answers a read with the query it was asked. The
// ids arrive as eids: the runner resolves what a person typed (@yaks/tools).
let asked = (args: Record<string, unknown>): [Bundle, Graph] => [
  { entity: { eid: 'c1' }, call: { args } },
  { read: (q: string) => [{ entity: { eid: q } }] } as unknown as Graph,
]

let comp = (b: Bundle, name: string) => b[name] as Comp

test('a new task is task{} plus the words, filed where the line said', async () => {
  let [said] = await tools.task_new!(
    ...asked({ title: 'ship it', project: 'p19', priority: 2 }),
  ) as Bundle[]
  assertEquals(comp(said, 'task'), {})
  assertEquals(comp(said, 'doc'), { title: 'ship it' })
  assertEquals(comp(said, 'filed'), { project: 'p19', priority: 2 })
})

test('a task nobody filed wears no filing', async () => {
  let [said] = await tools.task_new!(
    ...asked({ title: 'a microtask' }),
  ) as Bundle[]
  assertEquals(Object.keys(said).sort(), ['doc', 'entity', 'task'])
})

test('a listing always says .task, and open unless told otherwise', () => {
  assertEquals(listing(), '.task&.task.status=open&*')
  assertEquals(listing('.filed.project=P-19'), '.task&.filed.project=P-19&*')
  assertEquals(listing('hobbit', 5), '.task&hobbit&.limit=5&*')
})

test('a listing of alternatives lists only tasks', async () => {
  let { g } = teamGraph()
  await g.apply([
    { entity: { eid: 't' }, task: {}, doc: { title: 'fig' } },
    { entity: { eid: 'd' }, doc: { title: 'pear' } },
  ])
  let found = await tools.task_list!(
    { entity: { eid: 'c1' }, call: { args: { query: 'fig|pear' } } },
    g,
  ) as Bundle[]
  assertEquals(found.map((b) => b.entity.eid), ['t'])
})

let task = (() => {
  let { g } = teamGraph()
  g.apply([{ entity: { eid: 't' }, task: {}, doc: { title: 'a task' } }])
  return g.storage.read('*') as Bundle[]
})()

test('a status is the marks that mean it', async () => {
  let storage = store()
  storage.tx((tx) => tx.patch(task))
  let { g } = teamGraph(storage)
  let move = async (status: string) => {
    let said = await tools.task_update!(
      ...asked({ task: 't', status }),
    ) as Bundle[]
    await g.apply(said)
    return statusOf(g.vocab, (await g.get(['t']))[0])
  }
  assertEquals(await move('done'), 'done')
  assertEquals(await move('cancelled'), 'cancelled')
  assertEquals(await move('open'), 'open')
})

test('what the line left out is left alone', async () => {
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

test('a listed task guards its body and refuses a stale whole patch', async () => {
  let { g } = teamGraph()
  await g.apply([{
    entity: { eid: 't' },
    task: {},
    doc: { title: 'draft', body: 'first' },
  }])
  let [read] = await tools.task_list!(
    { entity: { eid: 'c1' }, call: { args: {} } },
    g,
  ) as Bundle[]
  let was = read.$was!.doc.body
  assertEquals(was, token('first'))
  let update = async (args: Record<string, unknown>) =>
    g.apply(
      await tools.task_update!(...asked({ task: 't', ...args })) as Bundle[],
    )
  await update({ body: 'second', was })
  let stale = await assertRejects(
    () => update({ title: 'lost', body: 'third', status: 'done', was }),
    Stale,
  )
  assertEquals(stale.current, 'second')
  let [held] = await g.get(['t'])
  assertEquals(comp(held, 'doc'), { title: 'draft', body: 'second' })
  assertEquals(statusOf(g.vocab, held), 'open')
})

test('a task body without was keeps the blind replacement behavior', async () => {
  let { g } = teamGraph()
  await g.apply([{
    entity: { eid: 't' },
    task: {},
    doc: { title: 'draft', body: 'first' },
  }])
  await g.apply(
    await tools.task_update!(
      ...asked({ task: 't', body: 'second' }),
    ) as Bundle[],
  )
  await g.apply(
    await tools.task_update!(
      ...asked({ task: 't', title: 'renamed', was: token('first') }),
    ) as Bundle[],
  )
  assertEquals(comp((await g.get(['t']))[0], 'doc'), {
    title: 'renamed',
    body: 'second',
  })
})

test('a partial task edit guards the body read while preparing its patch', async () => {
  let { g } = teamGraph()
  await g.apply([{ entity: { eid: 't' }, task: {}, doc: { body: 'before' } }])
  let patch = await tools.task_update!(
    {
      entity: { eid: 'call' },
      call: { args: { task: 't', edit: { append: ' after' } } },
    },
    g,
  ) as Bundle[]
  await g.apply([{ entity: { eid: 't' }, doc: { body: 'concurrent' } }])
  await assertRejects(async () => await g.apply(patch), Stale)
  assertEquals(comp((await g.get(['t']))[0], 'doc').body, 'concurrent')
})
