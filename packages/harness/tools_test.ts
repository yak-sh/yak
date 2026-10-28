import { test, until } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { graphTools, harnessTools } from './tools.ts'
import { core, inputSchemaOf } from '@yaks/mcp/tools'
import { type Bundle, type Comp, identityEid, mint } from '@yaks/graph'
import { toolEid } from '@yaks/tools'
import { harness, repo } from './testing.ts'
import { local } from './local.ts'
import { agent } from './agent.ts'

let body = (b: Bundle | undefined) => (b?.content as Comp | undefined)?.body

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

// A session's call through a graph tool, and the stamp it left.
let signedBy = await (async () => {
  let h = await harness()
  await h.g.apply([
    { entity: { eid: 'works' }, doc: { title: 'the project' } },
    { entity: { eid: 'run' }, session: { actor: 'works' } },
  ])
  let [apply] = graphTools(h.g)
  await apply.run({ bundles: [{ entity: { eid: 't1' }, task: {} }] }, {
    session: 'run',
    call: { entity: { eid: 'asked' } },
    entries: [],
  })
  let { by, via } = (await h.g.get(['t1']))[0].created as Comp
  h.close()
  return [by, via]
})()

test('a graph tool writes by the actor its session works for, via the session', () => {
  assertEquals(signedBy, ['works', 'run'])
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

test('a transcript naming a plugin’s tool is offered it alone, and it runs', async () => {
  let offered: string[][] = []
  let worktrees = Deno.makeTempDirSync({ prefix: 'yaks-named-' })
  let a = local({
    name: 'gpt-6-astra',
    cwd: repo(),
    h: await harness(),
    tools: [],

    model: (req) => {
      offered.push(req.tools?.map((t) => t.name) ?? [])
      return Promise.resolve({
        id: `r${offered.length}`,
        model: 'fake',
        items: offered.length == 1
          ? [{
            kind: 'call',
            id: 'c1',
            name: 'task_new',
            args: '{"title":"x"}',
          }]
          : [{ kind: 'assistant', text: 'filed' }],
      })
    },
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
      // What a serving host writes for each of its tools at start-up.
      { entity: { eid: toolEid('task_new') }, tool: { name: 'task_new' } },
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

// A session checking a write through graph_apply, run before the cases are
// timed: the result its transcript records, read as the model reads it.
let checked = await (async () => {
  let h = await harness()
  let asked = 0
  let a = agent({
    h,
    release: () => h.close(),
    name: 'fake',
    tools: graphTools(h.g),
    model: (req) =>
      Promise.resolve({
        id: `r${++asked}`,
        model: req.model,
        items: asked == 1
          ? [{
            kind: 'call',
            id: 'c1',
            name: 'graph_apply',
            args: JSON.stringify({
              check: true,
              bundles: [{ entity: { eid: '$t' }, doc: { title: 'a topic' } }],
            }),
          }]
          : [{ kind: 'assistant', text: 'done' }],
      }),
  })
  let s = await a.start('check it')
  await until(async () =>
    (await a.transcript(s)).some((b) => body(b) == 'done')
  )
  let said = String(body((await a.transcript(s)).find((b) => b.result)))
  let cut = said.lastIndexOf('\n]') + 2
  let [made] = JSON.parse(said.slice(0, cut))
  let kept = (await h.g.read('.doc.title="a topic"')).length
  await a.close()
  return {
    alias: made.$alias,
    minted: made.entity.eid[0] != '$',
    checked: said.slice(cut).match(/Checked: nothing was written/g)?.length,
    kept,
  }
})()

test('a session’s graph check reads as a check once, its $name beside the eid it became', () => {
  assertEquals(checked, { alias: '$t', minted: true, checked: 1, kept: 0 })
})

// A session reading two ids through graph_show, one of them miscopied: what
// its transcript records for the call.
let gone = mint()
let shown = await (async () => {
  let h = await harness()
  let [held] = await h.g.apply([{
    entity: { eid: '$t' },
    doc: { title: 'a topic' },
  }])
  let asked = 0
  let a = agent({
    h,
    release: () => h.close(),
    name: 'fake',
    tools: graphTools(h.g),
    model: (req) =>
      Promise.resolve({
        id: `r${++asked}`,
        model: req.model,
        items: asked == 1
          ? [{
            kind: 'call',
            id: 'c1',
            name: 'graph_show',
            args: JSON.stringify({ ids: [held.entity.eid, gone] }),
          }]
          : [{ kind: 'assistant', text: 'done' }],
      }),
  })
  let s = await a.start('show them')
  await until(async () =>
    (await a.transcript(s)).some((b) => body(b) == 'done')
  )
  let result = (await a.transcript(s)).find((b) => b.result)!
  let said = String(body(result))
  let cut = said.lastIndexOf('\n]') + 2
  await a.close()
  return {
    shown: JSON.parse(said.slice(0, cut)).map((b: Bundle) => b.entity.eid),
    held: held.entity.eid,
    words: said.slice(cut).trim(),
    refused: !!result.refusal,
  }
})()

test('a session’s graph_show of an id that names nothing answers the rest', () => {
  assertEquals(shown, {
    shown: [shown.held],
    held: shown.held,
    words: `${gone} names nothing: no entity has that id; the other is shown`,
    refused: false,
  })
})
