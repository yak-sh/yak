import { assertEquals, assertThrows } from '@std/assert'
import { argsFor, unique, wordFor } from '@yaks/cli'
import { loadTools } from '@yaks/graph/tools'
import { namedTool } from '@yaks/graph'
import { answerOf, runner, toolEid, worded } from '@yaks/tools'
import { driver } from '@yaks/sqlite/db'
import { connect } from '../mcp/harness.ts'
import { open } from './store.ts'
import { tools as declared } from './declared.ts'
import { tools as cliTools } from './cli.ts'
import { docs, vocab } from './vocab.ts'
import { rules } from './rules.ts'
import { runs } from './runs.ts'

let reads = { file: () => '', stdin: () => '' }

Deno.test('the facet subpaths say the harness once, and one declaration reaches both doors', async () => {
  // Every facet a host takes (@yaks/cli `compose`) is a SUBPATH of the package
  // — no manifest, no registration, no activation step — so a subsystem
  // imports only the one it needs.
  assertEquals(docs.some((d) => d.title == 'harness'), true)
  // Every declaration the harness SPEAKS, wearing its run — the checks the
  // packages it composes bring included, since a word it lists has to work.
  const declarations = loadTools(docs, runs({ vocab }))
  const h = open(':memory:')
  // The rules over that graph are `@yaks/harness/rules`, the very ones `open`
  // built it with: blobs, transcripts, edges, tasks, the portfolio they are
  // filed in, and the programs a session runs.
  assertEquals(
    rules({ vocab: h.vocab, sql: driver(h.db) }).map((p) => p.name),
    [
      '@yaks/blob',
      '@yaks/session',
      '@yaks/edge',
      '@yaks/task',
      '@yaks/project',
      '@yaks/process',
    ],
  )
  await h.g.apply([{ entity: { eid: 'session-one' }, session: { id: 'one' } }])
  // Nothing calls a tool function: a word typed here is a CALL in the graph,
  // and @yaks/tools' runner is what answers it.
  const r = runner(h.g, { tools: declarations })
  await r.ensure()
  const results: unknown[] = []
  // The same declaration reaches a command line and a transport: @yaks/cli
  // resolves either word order and reads the line through its input schema.
  const found = wordFor(declarations, ['session', 'list'])!
  assertEquals(found.verb, declarations[0])
  assertEquals(
    wordFor(declarations, ['list', 'session'])?.verb,
    declarations[0],
  )
  assertEquals(await argsFor(found.verb, found.args, reads), {})
  results.push(worded(answerOf(
    await r.call([{
      entity: { eid: '$call' },
      call: { to: toolEid(namedTool(found.verb).name), args: '{}' },
    }]),
  )))
  const client = await connect({
    graph: h.g,
    tools: [...declarations],
  })
  try {
    const listed = await client.listTools()
    assertEquals(
      listed.tools.some((t: { name: string }) => t.name === 'session_list'),
      true,
    )
    const response = await client.callTool({
      name: 'session_list',
      arguments: {},
    })
    assertEquals(response.isError, undefined)
    assertEquals(JSON.stringify(response).includes('session-one'), true)
    assertEquals(JSON.stringify(results).includes('session-one'), true)
  } finally {
    await client.close()
    h.close()
  }
})

Deno.test('noun and verb traversal is automatic and collision checked', () => {
  const c = declared[0]
  assertEquals(namedTool(c).name, 'session_list')
  assertEquals(wordFor([c], ['session', 'list', 'extra'])?.args, ['extra'])
  assertEquals(wordFor([c], ['list', 'session'])?.verb, c)
  assertEquals(wordFor([c], ['list']), undefined)
  assertThrows(() => unique([c, c]), Error, 'two tools answer to')
  assertThrows(
    () => unique([c, { ...c, noun: 'list', verb: 'session' }]),
    Error,
    'two tools answer to',
  )
  // And every word the command itself carries is reachable and unambiguous.
  unique(cliTools)
})

Deno.test('JSON Schema tool uses identical metadata and constraints through MCP and provider adapter', async () => {
  const { parametersOf } = await import('./tools.ts')
  const { toolDefinition } = await import('@yaks/vocab/tools')
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
          limit: { type: 'integer', minimum: 1, default: 2 },
        },
      },
      options: { positional: ['scope'], short: { n: 'limit' } },
    }),
    run: (
      _bundles: unknown[],
      ctx: { args: Record<string, unknown>; call: string },
    ) => [{
      entity: { eid: '$said' },
      content: { body: JSON.stringify(ctx.args) },
      output: { source: ctx.call },
    }],
  }
  const h = open(':memory:')
  const c = await connect({ graph: h.g, tools: [tool] })
  try {
    const listed = (await c.listTools()).tools.find((
      t: { name: string; inputSchema: unknown },
    ) => t.name === 'example_list')!
    assertEquals(listed.inputSchema, tool.inputSchema)
    assertEquals(parametersOf(tool), tool.inputSchema)
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
