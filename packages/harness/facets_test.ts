import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { argsFor, cli, commandFor, unique } from '@yaks/cli'
import { compose } from '@yaks/cli/host'
import { close as closeCli, opened } from '../cli/local.ts'
import { commands as localCommands } from '../cli/subcommands.ts'
import {
  argsOf,
  type Bundle,
  type Comp,
  mint,
  namedTool,
  offered,
} from '@yaks/graph'
import { answerOf, keeps, toolEid, worded } from '@yaks/tools'
import { BEST, loadTools } from '@yaks/graph/tools'
import { toolDefinition } from '@yaks/vocab/tools'
import { inputSchemaOf } from '@yaks/mcp/tools'
import { connect } from '../mcp/testing.ts'
import { textOf, transcript } from '@yaks/session'
import { selectedUsing } from './model_selection.ts'
import { runs } from './runs.ts'
import { docs } from './vocab.ts'
import { at, harness, working } from './testing.ts'

let reads = { file: () => '', stdin: () => '' }

// The harness is one plugin among the packages whose words it runs over: its
// `./vocab` says only its own, so it composes beside them.
let host = () =>
  compose({
    db: ':memory:',
    plugins: [
      '@yaks/kernel',
      '@yaks/id',
      '@yaks/edge',
      '@yaks/doc',
      '@yaks/task',
      '@yaks/session',
      '@yaks/provenance',
      '@yaks/model',
      '@yaks/harness',
    ],
  }, ['graph'])

test('the harness composes as a plugin, and its words reach a command line and MCP', async () => {
  let h = await host()
  try {
    let names = h.tools.map((t) => t.name)
    for (let name of ['session_list', 'session_new', 'session_send']) {
      assertEquals(names.includes(name), true, name)
    }
    // Running a transcript here, or reading this machine's credential, is a
    // command line's to ask; listing sessions is anybody's.
    let cli = h.tools.filter(offered('cli')).map((t) => t.name)
    let mcp = h.tools.filter(offered('mcp')).map((t) => t.name)
    assertEquals(cli.includes('session_new'), true)
    assertEquals(mcp.includes('session_new'), true)
    assertEquals(mcp.includes('model_list'), false)
    assertEquals(mcp.includes('session_list'), true)
    unique(h.tools)

    await h.graph.apply([{ entity: { eid: 'one' }, session: { id: 'one' } }])
    await h.runner.ensure()
    let found = commandFor(h.tools, ['session', 'list'])!
    assertEquals(commandFor(h.tools, ['list', 'session'])?.verb, found.verb)
    assertEquals(await argsFor(found.verb, found.args, reads), {})
    let id = mint()
    let said = worded(answerOf(
      await h.runner.call({
        entity: { eid: id },
        call: {
          to: toolEid(namedTool(found.verb).name),
          args: { query: '.session' },
        },
      }),
      id,
    ))
    assertEquals(said.includes('one'), true)
  } finally {
    await h.close()
  }
})

test('session_list answers a page of live sessions, newest first, and says how to read on', async () => {
  let h = await host()
  try {
    let live = (n: number): Bundle[] => [
      { entity: { eid: `s${n}` }, session: { id: `s${n}` } },
      {
        entity: { eid: mint() },
        entry: { session: `s${n}`, seq: 1 },
        content: { body: 'go' },
      },
    ]
    for (let n = 0; n < BEST + 2; n++) await h.graph.apply(live(n))
    await h.graph.apply([{
      entity: { eid: 'over' },
      session: { id: 'over', ended: true },
    }])
    let list = async (args: Record<string, unknown> = {}) => {
      let id = mint()
      let rows = answerOf(
        await h.runner.call({
          entity: { eid: id },
          call: { to: toolEid('session_list'), args },
        }),
        id,
      ) as Bundle[]
      return {
        ids: rows.map((b) => b.entity.eid).filter((e) => e != '$said'),
        said: (rows.find((b) => b.entity.eid == '$said')?.content as Comp)
          ?.body as string | undefined,
      }
    }
    let page = await list()
    assertEquals(page.ids.length, BEST)
    let at = async (id: string) =>
      ((await h.graph.get([id]))[0].created as Comp).at as string
    let stamps = await Promise.all(page.ids.map(at))
    assertEquals(stamps, stamps.toSorted().toReversed())
    assert(page.said?.includes(`.after=${page.ids.at(-1)}`), page.said)

    let next = (said?: string) => said?.match(/`([^`]*\.after=[^`]*)`/)?.[1]
    let rest = await list({ query: next(page.said) })
    assertEquals(rest.ids.length, 2)
    assertEquals(rest.said, undefined)

    // Walking short pages reaches every live session once and then stops.
    let seen: string[] = []
    let query: string | undefined
    do {
      let step: Awaited<ReturnType<typeof list>> = await list({
        limit: 8,
        ...query ? { query } : {},
      })
      seen.push(...step.ids)
      query = next(step.said)
    } while (query && seen.length <= BEST + 2)
    assertEquals(seen.length, BEST + 2)
    assertEquals(new Set(seen).size, BEST + 2)

    assertEquals((await list({ limit: 2 })).ids.length, 2)
    let longer = await list({ limit: BEST + 2 })
    assertEquals(longer.ids.length, BEST + 2)
    assertEquals(longer.said, undefined)
    assert((await list({ query: '.session', limit: 99 })).ids.includes('over'))
  } finally {
    await h.close()
  }
})

test('connection authorization is a CLI command without a stored call', async () => {
  let dir = await Deno.makeTempDir()
  let path = dir + '/yak.json'
  let out: string[] = []
  await Deno.writeTextFile(path, JSON.stringify(at(':memory:')))
  try {
    for (let words of [['auth']]) {
      let code = await cli([], {
        argv: ['--config', path, '--no-duties', ...words],
        more: localCommands,
        out: (line) => out.push(line),
      })
      assertEquals(code, 0)
      assert(out.pop()?.includes('OpenAI'))
    }
    let host = await opened(path, ['graph'], false)
    assertEquals(await host.graph.read('.call&*'), [])
  } finally {
    await closeCli()
    await Deno.remove(dir, { recursive: true })
  }
})

test('session new opens an empty TUI session and requires input otherwise', async () => {
  let h = await harness()
  let start = runs().session_new!
  let call = (args: Record<string, unknown>): Bundle => ({
    entity: { eid: crypto.randomUUID() },
    call: { args },
  })
  try {
    await assertRejects(
      () => Promise.resolve(start(call({}), h.g)),
      Error,
      'needs a prompt',
    )
    assertEquals(await h.g.read('.session&*'), [])
    let [session] = await start(call({ tui: true }), h.g)
    assert(session.session)
    assertEquals((session.session as Record<string, unknown>).operator, true)
    let entries = await transcript(h.g, session.entity.eid)
    assert(entries.every((e) => !!e.prompt))
    assert((await selectedUsing(h.g, session.entity.eid))?.model)
  } finally {
    await h.close()
  }
})

test('session new keeps an agent instrument when its caller speaks for a person', async () => {
  let h = await harness()
  try {
    await h.g.apply([
      { entity: { eid: 'typist' }, doc: {} },
      { entity: { eid: 'launcher' }, session: { id: 'launcher' } },
    ])
    let [session] = await runs().session_new!({
      entity: { eid: mint() },
      call: { args: { tui: true } },
      created: { by: 'typist', via: 'launcher' },
    }, h.g)
    assertEquals((session.session as Record<string, unknown>).operator, false)
  } finally {
    await h.close()
  }
})

// Run the real two-call session once at load. Its revision-gated wait may
// sleep between committed replies; the assertion checks the settled reply.
let settledReply = await (async () => {
  let h = await harness()
  let echo = {
    name: 'echo',
    description: 'echo',
    parameters: { type: 'object', properties: {} },
    run: () => 'echoed',
  }
  // Calls echo twice, then replies.
  let model = (req: { items: { kind: string }[] }) =>
    Promise.resolve({
      id: 'r',
      model: 'fake',
      items: req.items.filter((i) => i.kind == 'result').length < 2
        ? [{ kind: 'call' as const, id: mint(), name: 'echo', args: '{}' }]
        : [{ kind: 'assistant' as const, text: 'done' }],
    })
  let runner = working(h, { tools: [echo], model })
  try {
    let [reply] = await runs().session_new!({
      entity: { eid: mint() },
      call: { args: { prompt: 'echo twice' } },
    }, h.g)
    return textOf(reply)
  } finally {
    await runner.stop()
    await h.close()
  }
})()
test('session new returns the reply its session settles on, past its tool calls', () =>
  assertEquals(settledReply, 'done'))

test('session new accepts a graph persona and snapshots its instructions', async () => {
  let h = await harness()
  let persona = crypto.randomUUID()
  await h.g.apply([{
    entity: { eid: persona },
    doc: { title: 'Operator', body: 'Guide this work.' },
    persona: {},
    alias: { name: 'operator-persona' },
  }])
  try {
    let [session] = await runs().session_new!({
      entity: { eid: crypto.randomUUID() },
      call: { args: { tui: true, persona: 'operator-persona' } },
    }, h.g)
    assertEquals((session.session as Record<string, unknown>).persona, persona)
    let entries = await transcript(h.g, session.entity.eid)
    assert(
      entries.some((e) =>
        e.prompt &&
        String((e.content as Record<string, unknown>)?.body).includes(
          'Guide this work.',
        )
      ),
    )
    let project = crypto.randomUUID()
    let task = crypto.randomUUID()
    await h.g.apply([
      { entity: { eid: project }, project: {} },
      { entity: { eid: persona }, persona: { home: project } },
      {
        entity: { eid: '$includes' },
        edge: { from: project, to: persona },
        contains: {},
      },
      { entity: { eid: task }, task: {}, filed: { project } },
    ])
    let [working] = await runs().session_new!({
      entity: { eid: crypto.randomUUID() },
      call: { args: { tui: true, work: task } },
    }, h.g)
    assertEquals(working.filed, { project })
    assertEquals(working.home, {})
    let instructions = await transcript(h.g, working.entity.eid)
    assert(instructions.some((e) =>
      e.prompt &&
      String((e.content as Record<string, unknown>)?.body).includes(
        'Guide this work.',
      )
    ))
  } finally {
    await h.close()
  }
})

test('JSON Schema tool uses identical metadata and constraints through MCP and provider adapter', async () => {
  const tool = {
    ...toolDefinition({
      noun: 'example',
      verb: 'list',
      description: 'Example',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['scope'],
        properties: {
          scope: { type: 'string' },
          limit: { type: 'integer', minimum: 1, default: 2, short: 'n' },
        },
      },
      positional: ['scope'],
    }),
    run: (call: Bundle) => [{
      entity: { eid: '$said' },
      content: { body: JSON.stringify(argsOf(call)) },
      output: { source: call.entity.eid },
    }],
  }
  const h = await harness()
  const c = await connect({ graph: h.g, tools: [tool] })
  try {
    const listed = (await c.listTools()).tools.find((
      t: { name: string; inputSchema: unknown },
    ) => t.name === 'example_list')!
    const published = {
      ...tool.inputSchema,
      properties: {
        scope: { type: 'string' },
        limit: { type: 'integer', minimum: 1, default: 2 },
      },
    }
    assertEquals(listed.inputSchema, published)
    assertEquals<unknown>(inputSchemaOf(tool), published)
    const args = await argsFor(tool, ['root', '-n', '3'], reads)
    const response = await c.callTool({ name: 'example_list', arguments: args })
    assertEquals(response.isError, undefined)
    assertEquals(JSON.stringify(response).includes('root'), true)
    const invalid = await c.callTool({
      name: 'example_list',
      arguments: { scope: 'root', limit: 0 },
    })
    assertEquals(invalid.isError, true)
  } finally {
    await c.close()
    h.close()
  }
})

// The harness's tools as a host joins them (@yaks/cli `compose`).
let declared = loadTools(docs, runs())

// session_new answers the session as the graph holds it, stamped properties
// and all, which the caller's door may not write back: the runner hands that
// answer to the caller unwritten (@yaks/tools applied_test.ts).
test('session new through the runner answers the session it opened', () => {
  let tool = declared.find((t) => t.name == 'session_new')!
  assertEquals(keeps(tool, 'done'), false)
})
