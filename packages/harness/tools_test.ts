import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { graphTools, harnessTools } from './tools.ts'
import { core, inputSchemaOf } from '@yaks/mcp/tools'
import { identityEid } from '@yaks/graph'
import { link } from '@yaks/edge'
import type { Model } from '@yaks/model'
import { toolEid } from '@yaks/tools'
import { harness, repo } from './testing.ts'
import { local } from './local.ts'

let schemas = async () => {
  let h = await harness()
  let table = core({ vocab: h.vocab })
    .map((t) => [t.name, inputSchemaOf(t)] as const)
  h.close()
  return new Map(table)
}

test('every graph tool says its arguments as JSON Schema', async () => {
  for (let [name, schema] of await schemas()) {
    assertEquals(schema.type, 'object', name)
    assert(!('$schema' in schema), `${name} carries a $schema`)
    assert(!JSON.stringify(schema).includes('"$ref"'), `${name} carries a $ref`)
  }
})

test('a required argument is required and an optional one is not', async () => {
  let query = (await schemas()).get('graph_query')!
  assertEquals(query.required, ['q'])
  let props = query.properties as Record<string, Record<string, unknown>>
  assertEquals(props.q.type, 'string')
  assertEquals(props.limit.type, 'number')
})

test('the harness gives an agent the shell and the graph', async () => {
  let h = await harness()
  let names = harnessTools(h.g).map((t) => t.name)
  assertEquals(names.slice(0, 3), ['shell', 'wait', 'stop'])
  assertEquals(new Set(names).size, names.length)
  assert(names.includes('fork'))
  assert(names.includes('spawn'))
  assert(names.includes('graph_apply'))
  assert(names.includes('graph_query'))
  h.close()
})

test('a graph tool writes and reads the harness graph', async () => {
  let h = await harness()
  let tools = graphTools(h.g)
  let by = (name: string) => tools.find((t) => t.name == name)!
  await by('graph_apply').run({
    bundles: [{ entity: { eid: 't1' }, doc: { title: 'a task' }, task: {} }],
  })
  let out = await by('graph_query').run({ q: '.task&?doc' })
  assert(out.includes('a task'), out)
  h.close()
})

test('a graph tool’s answer carries what a direct call is owed beside it', async () => {
  let h = await harness()
  let told: string[][] = []
  let [apply] = graphTools(h.g, {
    reply: (_call, _answer, wrote) => {
      told.push(wrote.map((b) => b.entity.eid))
      return Promise.resolve([{
        entity: { eid: 'owed' },
        content: { body: 'near: an older task' },
      }])
    },
  }).filter((t) => t.name == 'graph_apply')
  let out = await apply.run({
    bundles: [{ entity: { eid: 't1' }, doc: { title: 'a task' }, task: {} }],
  })
  assert(out.includes('near: an older task'), out)
  assertEquals(told, [['t1']])
  h.close()
})

test('the merged wait preserves process output and child status alongside task waiting', async () => {
  let h = await harness()
  // A process's output is its run's files (@yaks/process `tail`).
  let was = Deno.env.get('PROCESS_DIR')
  let dir = Deno.makeTempDirSync({ prefix: 'yaks-process-' })
  Deno.env.set('PROCESS_DIR', dir)
  Deno.writeTextFileSync(`${dir}/command.out`, 'process output\n')
  try {
    await h.g.apply([
      { entity: { eid: 'p' }, session: {} },
      { entity: { eid: 'c' }, session: {}, spawned: { parent: 'p' } },
      {
        entity: { eid: 'command' },
        process: { command: 'true' },
        exit: { code: 0 },
      },
    ])
    let wait = harnessTools(h.g, {
      workspaces: {
        connect: () =>
          Promise.resolve({
            start: () => Promise.resolve('command'),
            look: () => Promise.resolve({ exit: { code: 0 } }),
            tail: () => Promise.resolve(['process output']),
            kill: async () => {},
            read: () => Promise.resolve(''),
            stat: () => Promise.resolve([]),
            write: async () => {},
          }),
      },
    }).find((t) => t.name == 'wait')!
    await h.g.apply([{
      entity: { eid: 'launch' },
      workspace: { root: '/launch' },
    }, { entity: { eid: 'command' }, process: { workspace: 'launch' } }])
    let process = await wait.run({ process: 'command', timeout: 0 }, {
      session: 'p',
      call: { entity: { eid: 'process-call' } },
      entries: [],
    })
    assertEquals(process, 'process command exited 0\nprocess output')
    let children = await wait.run({ children: ['c'], timeout: 0 }, {
      session: 'p',
      call: { entity: { eid: 'call' } },
      entries: [],
    })
    assertEquals(JSON.parse(String(children)), [{
      session: 'c',
      status: 'empty',
      output: '',
    }])
  } finally {
    if (was == null) Deno.env.delete('PROCESS_DIR')
    else Deno.env.set('PROCESS_DIR', was)
    Deno.removeSync(dir, { recursive: true })
    h.close()
  }
})

// A model that files task x on its first ask and then says so, keeping the
// names of the tools each ask offered it.
let filer = (offered: string[][]): Model => (req) => {
  offered.push(req.tools?.map((t) => t.name) ?? [])
  return Promise.resolve({
    id: `r${offered.length}`,
    model: 'fake',
    items: offered.length == 1
      ? [{ kind: 'call', id: 'c1', name: 'task_new', args: '{"title":"x"}' }]
      : [{ kind: 'assistant', text: 'filed' }],
  })
}

// What a serving host writes for each of its tools at start-up.
let registered = (name: string) => ({
  entity: { eid: toolEid(name) },
  tool: { name },
})

test('a session wearing a persona is offered the tools it contains alone, and they run', async () => {
  let offered: string[][] = []
  let a = local({
    name: 'gpt-6-astra',
    h: await harness(),
    tools: [],
    model: filer(offered),
  })
  try {
    await a.h.g.apply([
      {
        entity: { eid: 'farmer' },
        persona: {},
        doc: { title: 'Farmer', body: 'File what you are asked to.' },
      },
      registered('task_new'),
      link('farmer', 'contains', toolEid('task_new')),
    ])
    let s = await a.start('file x', { persona: 'farmer' })
    await a.idle(s)
    assert(offered.length >= 2)
    for (let tools of offered) assertEquals(tools, ['task_new'])
    assertEquals((await a.h.g.read('.task&.doc.title=x')).length, 1)
  } finally {
    await a.close()
  }
})

test('a transcript naming a plugin’s tool is offered it alone, and it runs', async () => {
  let offered: string[][] = []
  let worktrees = Deno.makeTempDirSync({ prefix: 'yaks-named-' })
  let a = local({
    name: 'gpt-6-astra',
    cwd: repo(),
    h: await harness(),
    tools: [],
    model: filer(offered),
  })
  try {
    let [s] = await a.h.g.apply([
      { entity: { eid: '$s' }, session: {} },
      {
        entity: { eid: '$e' },
        entry: { session: '$s' },
        content: { body: 'file x' },
        using: {
          provider: identityEid('provider', ['openai']),
          model: a.model,
        },
        sending: {
          tools: ['task_new'],
        },
      },
      registered('task_new'),
    ])
    await a.idle(s.entity.eid)
    assert(offered.length == 2 || offered.length == 3)
    for (let tools of offered) assertEquals(tools, ['task_new'])
    assertEquals((await a.h.g.read('.task&.doc.title=x')).length, 1)
  } finally {
    await a.close()
    Deno.removeSync(worktrees, { recursive: true })
  }
})
