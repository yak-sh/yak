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
import { seenBy } from './operator-access.ts'
import { working } from './operator-tasks.ts'
import { handedOf } from '@yaks/spawn/machines'
import { MEMORY_OWNERS } from '@yaks/platform/operator-memory'
import { OWNERS } from '@yaks/platform/operator-owner'
import { invokePackage, packageTools } from './package-tools.ts'
import { ORACLES } from './oracle-move.ts'
import { owned } from './directory-fixture.ts'
import { platform } from './directory-rows-probe.ts'
import { directoryOf } from './directory.ts'
import type { Ctx } from './tools.ts'
import { snapshot } from '../../packages/sqlite/testing.ts'

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

let body = (rows: Bundle[]) => String((rows[0].content as Comp).body)

test('a developer can retire and register their machine again', async () => {
  let store = operatorMemory()
  let machine = 'laptop'
  let owner = { person, member: true }
  let other = { person: crypto.randomUUID(), member: true }
  let register = () =>
    working(store, owner, 'machine_register', {
      machine,
      clis: ['claude', 'codex'],
    })
  let remove = (reader = owner) =>
    working(store, reader, 'machine_remove', { machine })
  let registration = JSON.parse(body(await register()))
  let ids = [
    registration.machine,
    ...Object.values<string>(registration.providers),
  ]
  let live = () => store.g.read(line`.entity.eid=${ids}&(.machine|.provider)`)

  await remove(other)
  equal((await live()).length, 3)
  await remove()
  equal(await live(), [])
  await remove()
  equal(JSON.parse(body(await register())), registration)
  equal((await live()).length, 3)
})

test("a session asked of a developer's machine runs there and reports on its task", async () => {
  // A populated space has all the tables a scoped status read can use.
  using db = durable(snapshot(operatorVocab))
  let store = await operatorStore(db)
  for (let mark of [OWNERS, ORACLES, MEMORY_OWNERS]) {
    store.marks!.set(mark, 'done')
  }
  let work = (name: string, args: Record<string, unknown>) =>
    working(store, { person, member: true }, name, args)
  let [made] = await work('task_new', { title: 'Tune the organ' })
  let machine = JSON.parse(
    body(await work('machine_register', { machine: 'mbp', clis: ['claude'] })),
  )
  equal(typeof machine.providers.claude, 'string')
  // Named as a person types them: the task by its id, the provider by name.
  let started = body(
    await work('session_spawn', { task: id(made), provider: 'claude on mbp' }),
  )
  equal(started, 'S-1 spawned')
  // Read as yaks.app hands it to the machine, its prose drawn for the reader:
  // the session still its eid, which the CLI names its thread with.
  let job = handedOf(
    body(await store.readable(await work('session_take', { machine: 'mbp' }))),
  )!
  equal(/^[0-9a-f-]{36}$/.test(job.session), true)
  equal(job.cli, 'claude')
  await work('session_log', {
    machine: 'mbp',
    session: job.session,
    lines: [],
    pid: 9,
  })
  let follow = body(
    await work('session_spawn', {
      task: id(made),
      provider: 'claude on mbp',
      instruction: 'Check the pedals too.',
    }),
  )
  equal(follow.includes('no second run started'), true)
  equal(body(await work('session_take', { machine: 'mbp' })), '')
  let said = (text: string) =>
    JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text }] },
    })
  await work('session_log', {
    machine: 'mbp',
    session: job.session,
    lines: [said('Tuned.')],
    pid: 9,
    exit: 0,
  })
  let peeked = body(await work('session_peek', { session: job.session }))
  equal(peeked.includes('Tuned.'), true)
  let notes = await store.g.read(line`.comment.target=${made.entity.eid}&*`)
  equal(notes.length, 1)
  equal(String((notes[0].doc as Comp).body).includes('Tuned.'), true)
  // Its claim went with it: the task is asked of a machine again.
  await work('session_spawn', { task: id(made), provider: 'claude on mbp' })
  let again = handedOf(body(await work('session_take', { machine: 'mbp' })))!
  equal(again.session == job.session, false)
  await work('comment_new', { target: made.entity.eid, body: 'Sounds right.' })
  equal(
    (await store.g.read(line`.comment.target=${made.entity.eid}`)).length,
    2,
  )
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

test('an approval ask is private to its assignee', async () => {
  let [row] = await approvals.g.get([ask])
  equal(row.owner, { person: approver })
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
  // Nor does their turn's graph_apply reach it, by its number or its eid.
  let [held] = await approvals.g.get([ask])
  let self = seenBy(approvals, { person: requester, member: true })
  for (let at of [`T-${held.entity.num}`, ask]) {
    for (
      let b of [
        { entity: { eid: at }, doc: { title: 'Nothing to see' } },
        { entity: { eid: '$c' }, comment: { target: at }, doc: { body: 'Ok' } },
      ]
    ) {
      await assertRejects(
        async () => await self.apply([b]),
        Error,
        'names nothing',
      )
    }
  }
  equal((await approvals.g.get([ask]))[0], held)
})

test('an escalation is visible to its recipient and its words are written by the system', async () => {
  let escalation = crypto.randomUUID()
  await approvals.g.apply([{
    entity: { eid: escalation },
    task: {},
    doc: { title: 'Review the reply', body: 'The proposed reply.' },
    operator_escalation: { raised: crypto.randomUUID(), from: session },
    filed: { assignee: approver, project: approvalSpace },
  }], { trusted: true })
  let query = line`.entity.eid=${escalation}`
  equal(titles(await approvalWork(approver, 'task_list', { query })), [
    'Review the reply',
  ])
  equal(await approvalWork(requester, 'task_list', { query }), [])
  for (let patch of [{ body: 'Edited reply.' }, { assignee: requester }]) {
    await assertRejects(
      () =>
        approvalWork(approver, 'task_update', { task: escalation, ...patch }),
      CallError,
      'Only the system writes',
    )
  }
  let self = seenBy(approvals, { person: approver, member: true })
  await assertRejects(
    async () =>
      await self.apply([{
        entity: { eid: escalation },
        doc: { body: 'Edited reply.' },
      }]),
    Error,
    'Only the system writes',
  )
  let [row] = await self.get([escalation], ['doc'])
  equal((row.doc as Comp).body, 'The proposed reply.')
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
