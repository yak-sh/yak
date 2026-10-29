// Compact task requests through their declared argument schemas and graph.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { type Bundle, Stale, token } from '@yaks/graph'
import { loadTools } from '@yaks/graph/tools'
import { argsFor } from '../cli/args.ts'
import { resolved, validated } from '../tools/args.ts'
import { taskDoc } from './comp.ts'
import { teamGraph } from './testing.ts'
import { runs } from './tools.ts'

let { g } = teamGraph()
await g.apply([{
  entity: { eid: 'project' },
  project: {},
  doc: { title: 'Tools' },
}])
let tools = loadTools(taskDoc, runs())
let call = async (name: string, args: Record<string, unknown>) => {
  let tool = tools.find((t) => t.name == name)!
  args = await resolved(tool, validated(tool, args), g)
  let out = await tool.run({ entity: { eid: 'call' }, call: { args } }, g)
  return await g.apply(out as Bundle[], { check: Boolean(args.check) })
}
let line = async (name: string, argv: string[]) => {
  let tool = tools.find((t) => t.name == name)!
  return await call(name, await argsFor(tool, argv))
}

test('task creation previews conditions without saving', async () => {
  let before = (await g.read('.task')).length
  let [preview] = await call('task_new', {
    title: 'Preview',
    accept: 'Works',
    blocked: 'Waiting',
    check: true,
  })
  assertEquals(preview.accept, { body: 'Works' })
  assertEquals(preview.blocked, { on: 'Waiting' })
  assertEquals((await g.read('.task')).length, before)
})

test('task creation files a batch with sibling dependencies', async () => {
  let tasks = [
    { id: '$goal', title: 'Goal' },
    { id: '$last', title: 'Last', parent: '$goal', requires: ['$goal'] },
  ]
  let wrote = await line('task_new', [
    '--tasks',
    JSON.stringify(tasks),
    '--project',
    'Tools',
  ])
  let goal = wrote.find((b) => b.$alias == '$goal')!
  let last = wrote.find((b) => b.$alias == '$last')!
  assertEquals(goal.filed, { project: 'project' })
  assertEquals(wrote.filter((b) => b.contains).map((b) => b.edge), [
    { from: goal.entity.eid, to: last.entity.eid },
  ])
  assertEquals(wrote.find((b) => b.requires)?.edge, {
    from: last.entity.eid,
    to: goal.entity.eid,
  })
})

test('generated task and link aliases stay distinct from supplied aliases', async () => {
  let wrote = await call('task_new', {
    parent: 'project',
    tasks: [
      { id: '$task-2', title: 'Explicit' },
      { title: 'Generated' },
      { id: '$task-link-0-0', title: 'Edge name' },
    ],
  })
  assertEquals(wrote.filter((b) => b.task).length, 3)
  assertEquals(wrote.filter((b) => b.contains).length, 3)
})

await g.apply([
  {
    entity: { eid: 'one' },
    task: {},
    doc: { title: 'One', body: 'before\nafter' },
  },
  { entity: { eid: 'two' }, task: {}, doc: { title: 'Two', body: 'body' } },
  {
    entity: { eid: 'race-one' },
    task: {},
    doc: { title: 'Race', body: 'current' },
  },
  { entity: { eid: 'race-two' }, task: {}, doc: { title: 'Unchanged' } },
  {
    entity: { eid: 'clear' },
    task: {},
    doc: { title: 'Retained' },
    accept: { body: 'Works' },
    blocked: { on: 'Waiting' },
    filed: { project: 'project', priority: 2 },
  },
  {
    entity: { eid: 'sequence' },
    task: {},
    doc: { title: 'Initial', body: 'a' },
  },
  {
    entity: { eid: 'guards' },
    task: {},
    doc: { title: 'Kept', body: 'present' },
  },
])

test('task updates combine fields, marks and guarded body edits in a batch', async () => {
  await line('task_update', [
    '--priority',
    '2',
    '--updates',
    JSON.stringify([
      {
        task: 'one',
        title: 'Renamed',
        edit: { find: 'before', replace: 'start', append: '\nend' },
      },
      {
        task: 'two',
        status: 'cancelled',
        reason: 'Superseded',
        domain: 'tools',
      },
    ]),
  ])
  let [one, two] = await g.get(['one', 'two'])
  assertEquals(one.doc, { title: 'Renamed', body: 'start\nafter\nend' })
  assertEquals(one.filed, { priority: 2 })
  assertEquals((two.cancelled as Record<string, unknown>).reason, 'Superseded')
  assertEquals(two.filed, { priority: 2, domain: 'tools' })
})

test('stale task text leaves every update in its transaction untouched', async () => {
  await assertRejects(() =>
    call('task_update', {
      updates: [
        { task: 'race-two', title: 'Lost' },
        { task: 'race-one', edit: { append: 'lost', was: token('older') } },
      ],
    }), Stale)
  assertEquals((await g.get(['race-two']))[0].doc, { title: 'Unchanged' })
})

test('clearing task conditions and filing retains unrelated fields', async () => {
  await line('task_update', [
    'clear',
    '--clear',
    'accept',
    '--clear',
    'blocked',
    '--clear',
    'priority',
  ])
  let [one] = await g.get(['clear'])
  assertEquals(one.accept, undefined)
  assertEquals(one.blocked, undefined)
  assertEquals(one.filed, { project: 'project' })
  assertEquals(one.doc, { title: 'Retained' })
})

test('repeated task rows compose their field and text edits in order', async () => {
  await call('task_update', {
    updates: [
      { task: 'sequence', title: 'Kept', edit: { append: 'b' } },
      { task: 'sequence', priority: 3, edit: { find: 'ab', replace: 'c' } },
      { task: 'sequence', edit: { prepend: 'd', append: 'e' } },
    ],
  })
  let [task] = await g.get(['sequence'])
  assertEquals(task.doc, { title: 'Kept', body: 'dce' })
  assertEquals(task.filed, { priority: 3 })
})

test('a later task replacement cannot erase an earlier stale body guard', async () => {
  await assertRejects(
    () =>
      call('task_update', {
        updates: [
          { task: 'guards', body: 'stale', was: token('older') },
          { task: 'guards', body: 'later', was: token('present') },
        ],
      }),
    Error,
    'conflicting was',
  )
  assertEquals((await g.get(['guards']))[0].doc, {
    title: 'Kept',
    body: 'present',
  })
})

test('nested task text guards cannot erase the enclosing guard', async () => {
  await assertRejects(
    () =>
      call('task_update', {
        task: 'guards',
        was: token('older'),
        edit: { append: 'x', was: token('present') },
      }),
    Error,
    'conflicting was',
  )
  assertEquals((await g.get(['guards']))[0].doc, {
    title: 'Kept',
    body: 'present',
  })
})
