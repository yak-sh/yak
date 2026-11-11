// A space's tasks and goals, kept in its Operator's store: made, listed and
// finished there by the shared tools, which the connector lists and sends on.
import { equal, test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { CallError } from '@yaks/tools/errors'
import { operatorMemory } from './operator-testing.ts'
import { working } from './operator-tasks.ts'
import { invokePackage, packageTools } from './package-tools.ts'
import { owned } from './directory-fixture.ts'
import { platform } from './directory-rows-probe.ts'
import { directoryOf } from './directory.ts'
import type { Ctx } from './tools.ts'

let store = operatorMemory()
let person = crypto.randomUUID()
let work = (name: string, args: Record<string, unknown>) =>
  working(store, person, name, args)
let titles = (rows: Bundle[]) => rows.map((b) => (b.doc as Comp).title)

let [task] = await work('task_new', { title: 'Order the hymnals' })
let [goal] = await work('goal_new', {
  title: 'Sunday runs itself',
  satisfied_by: [task.entity.eid],
})

test('a task and a goal made in the store are listed there', async () => {
  equal(titles(await work('task_list', {})), ['Order the hymnals'])
  equal(titles(await work('goal_list', {})), ['Sunday runs itself'])
  let links = await store.g.read(`.satisfies&.edge.to=${goal.entity.eid}`)
  equal(links.map((b) => (b.edge as Comp).from), [task.entity.eid])
})

test('a finished task leaves the open list and is done', async () => {
  await work('task_update', { task: task.entity.eid, status: 'done' })
  equal(await work('task_list', {}), [])
  let [done] = await work('task_list', { query: '.task.status=done' })
  equal((done.task as Comp).status, 'done')
})

test('a question the Operator asks the person is not a shared tool', async () => {
  for (let name of ['decision_new', 'decision_answer', 'graph_apply']) {
    await assertRejects(
      () => work(name, {}),
      CallError,
      'no Operator work tool',
    )
  }
})

let requests: Request[] = []
let { env } = platform('operator-tasks', {
  BUILDER: {
    idFromName: (name) => name,
    get: () => ({
      fetch: (request: Request) => {
        requests.push(request)
        return Promise.resolve(Response.json([{ entity: { eid: 'made' } }]))
      },
    }),
  },
})
let ctx: Ctx = { env, dir: directoryOf(env.STORE), person }
let space = await owned(ctx, 'operator-tasks')

test('the connector lists the tasks and goals tools, and none of the questions', () => {
  let names = packageTools(ctx).map((t) => t.name)
  equal(
    [
      'task_new',
      'task_list',
      'task_update',
      'goal_new',
      'goal_list',
      'goal_update',
    ]
      .filter((n) => !names.includes(n)),
    [],
  )
  equal(names.filter((n) => n.startsWith('decision_')), [])
})

test("the connector sends a call to the space's Operator, as the caller", async () => {
  let args = { title: 'Print the bulletin' }
  let out = await invokePackage(ctx, 'task_new', {
    space: 'operator-tasks',
    ...args,
  })
  let request = requests.at(-1)!
  equal(new URL(request.url).pathname, '/operator/tool')
  equal(await request.json(), {
    space: 'operator-tasks',
    tool: 'task_new',
    args,
  })
  equal(request.headers.get('x-yak-person'), person)
  equal(request.headers.get('x-space-eid'), space)
  equal(out, [{ entity: { eid: 'made' } }])
})
