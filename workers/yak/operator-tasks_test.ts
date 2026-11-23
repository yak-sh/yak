// A space's tasks and goals, kept in its Operator's store: made, listed and
// finished there by the shared tools, which the connector lists and sends on.
import { line } from '@yaks/query'
import { equal, test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { CallError } from '@yaks/tools/errors'
import { human } from '@yaks/id'
import { operatorMemory } from './operator-testing.ts'
import { operatorStore, operatorVocab } from './operator-store.ts'
import { durable } from '../../packages/durable-object/testing.ts'
import { askOf, waiting } from './operator-approvals.ts'
import { working } from './operator-tasks.ts'
import { invokePackage, packageTools } from './package-tools.ts'
import { owned } from './directory-fixture.ts'
import { platform } from './directory-rows-probe.ts'
import { directoryOf } from './directory.ts'
import type { Ctx } from './tools.ts'

let store = operatorMemory()
let person = crypto.randomUUID()
let work = (name: string, args: Record<string, unknown>) =>
  working(store, { person, member: true }, name, args)
let titles = (rows: Bundle[]) => rows.map((b) => (b.doc as Comp).title)
let id = human(operatorVocab)

let [task] = await work('task_new', { title: 'Order the hymnals' })
let [goal] = await work('goal_new', {
  title: 'Sunday runs itself',
  satisfied_by: [task.entity.eid],
})

test('a task and a goal made in the store are listed there', async () => {
  equal(titles(await work('task_list', {})), ['Order the hymnals'])
  equal(titles(await work('goal_list', {})), ['Sunday runs itself'])
  let links = await store.g.read(line`.satisfies&.edge.to=${goal.entity.eid}`)
  equal(links.map((b) => (b.edge as Comp).from), [task.entity.eid])
})

test('a finished task leaves the open list and is done', async () => {
  await work('task_update', { task: task.entity.eid, status: 'done' })
  equal(await work('task_list', {}), [])
  let [done] = await work('task_list', { query: '.task.status=done' })
  equal((done.task as Comp).status, 'done')
})

test('a task and a goal are numbered from 1, each in its series', () => {
  equal([task, goal].map(id), ['T-1', 'V-1'])
})

test('their ids in prose are kept as eids and read back as the ids', async () => {
  let [note] = await work('task_new', {
    title: 'Print the bulletin',
    body: 'For V-1, after T-1, not `T-1`.',
  })
  let [kept] = await store.g.get([note.entity.eid])
  equal(
    (kept.doc as Comp).body,
    `For ${goal.entity.eid}, after ${task.entity.eid}, not \`T-1\`.`,
  )
  let [read] = await store.readable([kept])
  equal((read.doc as Comp).body, 'For V-1, after T-1, not `T-1`.')
  await work('task_update', { task: id(note), status: 'cancelled' })
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

let approvals = await operatorStore(durable())
let requester = crypto.randomUUID(), approver = crypto.randomUUID()
let approval = crypto.randomUUID(), approvalSpace = crypto.randomUUID()
let session = crypto.randomUUID()
let ask = askOf(approval, approver)
await approvals.g.apply([
  { entity: { eid: session }, session: {} },
  { entity: { eid: requester }, doc: { title: 'Requester' } },
  ...await waiting(approvals, approvalSpace, approval, {
    person: requester,
    session,
    tool: 'example',
    args: {},
    say: 'Review the draft',
    expires: '2099-01-01T00:00:00Z',
    approvers: [approver],
  }),
], { trusted: true })
let approvalWork = (person: string, name: string, args: unknown) =>
  working(approvals, { person, member: true }, name, args)

test('an approval ask without a stored owner is private to its assignee', async () => {
  let [row] = await approvals.g.get([ask])
  equal(row.owner, undefined)
  equal(titles(await approvalWork(approver, 'task_list', {})), [
    'Review the draft?',
  ])
  equal(await approvalWork(requester, 'task_list', {}), [])
  await assertRejects(
    () =>
      approvalWork(requester, 'task_update', {
        task: ask,
        status: 'cancelled',
      }),
    CallError,
    'names no task',
  )
  equal((await approvals.g.get([ask]))[0].cancelled, undefined)
})

test('a work tool keeps the approval assigned to the person asked to answer it', async () => {
  await assertRejects(
    () =>
      approvalWork(approver, 'task_update', { task: ask, assignee: requester }),
    CallError,
    'Only the system writes an approval',
  )
  let [row] = await approvals.g.get([ask])
  equal((row.filed as Comp).assignee, approver)
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
