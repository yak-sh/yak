/// <reference lib="deno.ns" />
// The public task tools and the CLI grammar that their MCP listing carries,
// connected in this process over a graph in memory.
let checks = Promise.resolve()
let test = (name: string, run: () => Promise<void>) => {
  checks = checks.then(run).then(() => console.log(name))
}
import { assertEquals } from '@std/assert'
import { type Bundle, graph, token } from '@yaks/graph'
import { loadTools } from '@yaks/graph/tools'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { toolsDoc } from '@yaks/tools'
import { edgeKeywords, edges } from '@yaks/edge'
import { docs } from '@yaks/doc'
import { kernel } from '@yaks/kernel'
import { projects } from '@yaks/project'
import { argsFor } from '../../packages/cli/args.ts'
import { type Listed, spelling } from '../../packages/cli/tool.ts'
import { connect, result } from '../../packages/mcp/testing.ts'
import { taskDoc } from '../../packages/task/comp.ts'
import { team } from '../../packages/task/testing.ts'
import { tasks } from '../../packages/task/plugin.ts'
import { runs } from '../../packages/task/tools.ts'

let vocab = loadVocab([...team.docs, toolsDoc], [edgeKeywords])
let g = graph({
  vocab,
  storage: ram(vocab, { number: true }),
  plugins: [docs(), kernel(), edges(vocab), tasks(), projects(vocab)],
})
await g.apply([{
  entity: { eid: 'project' },
  project: {},
  doc: { title: 'Tools' },
}])
let client = await connect({
  graph: g,
  tools: loadTools(taskDoc, runs()),
  readFile: (path) => Deno.readTextFile(path),
})
let listed = (await client.listTools()).tools as Listed[]
let call = async (name: string, args: Record<string, unknown>) => {
  let out = await client.callTool({ name, arguments: args })
  assertEquals(out.isError, undefined, JSON.stringify(out))
  return result(out) as Bundle[]
}
let line = async (name: string, argv: string[]) => {
  let tool = listed.find((t) => t.name == name)!
  return await call(name, await argsFor({ ...tool, ...spelling(tool) }, argv))
}

test('MCP task creation previews conditions without saving', async () => {
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

test('MCP task creation files a batch with sibling dependencies', async () => {
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
    doc: { title: 'Retained', body: 'Clear this body' },
    accept: { body: 'Works' },
    blocked: { on: 'Waiting' },
    filed: { project: 'project', priority: 2 },
  },
])

test('MCP task updates combine fields, marks and guarded body edits in a batch', async () => {
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

test('MCP stale text leaves every update in its transaction untouched', async () => {
  let out = await client.callTool({
    name: 'task_update',
    arguments: {
      updates: [
        { task: 'race-two', title: 'Lost' },
        { task: 'race-one', edit: { append: 'lost', was: token('older') } },
      ],
    },
  })
  assertEquals(out.isError, true)
  assertEquals((await g.get(['race-two']))[0].doc, { title: 'Unchanged' })
})

test('MCP clears task conditions and filing without dropping unrelated fields', async () => {
  await line('task_update', [
    'clear',
    '--clear',
    'accept',
    '--clear',
    'blocked',
    '--clear',
    'priority',
    '--clear',
    'body',
    '--clear',
    'project',
  ])
  let [one] = await g.get(['clear'])
  assertEquals(one.accept, undefined)
  assertEquals(one.blocked, undefined)
  assertEquals(one.filed, {})
  assertEquals(one.doc, { title: 'Retained' })
})

test('MCP task CLI preserves literal null text and file contents', async () => {
  await line('task_update', ['clear', '--body', 'null'])
  assertEquals((await g.get(['clear']))[0].doc, {
    title: 'Retained',
    body: 'null',
  })
  let tool = listed.find((t) => t.name == 'task_update')!
  await call(
    'task_update',
    await argsFor(
      { ...tool, ...spelling(tool) },
      ['clear', '--body', '@body'],
      { file: () => 'null', stdin: () => '' },
    ),
  )
  assertEquals((await g.get(['clear']))[0].doc, {
    title: 'Retained',
    body: 'null',
  })
})

test('MCP task creation and editing read body files through the box boundary', async () => {
  let path = await Deno.makeTempFile({ suffix: '.md' })
  let body = 'A task body kept in a file.\n'.repeat(100)
  try {
    await Deno.writeTextFile(path, body)
    let wrote = await call('task_new', {
      $files: true,
      tasks: [{ id: '$file-task', title: 'File body', body: '@' + path }],
    })
    let task = wrote.find((b) => b.$alias == '$file-task')!
    assertEquals(task.doc, { title: 'File body', body })
    await Deno.writeTextFile(path, 'Replacement from disk')
    await call('task_update', {
      $files: true,
      task: task.entity.eid,
      edit: { replace: '@' + path },
    })
    assertEquals((await g.get([task.entity.eid]))[0].doc, {
      title: 'File body',
      body: 'Replacement from disk',
    })
  } finally {
    await Deno.remove(path)
  }
})

await checks
await client.close()
