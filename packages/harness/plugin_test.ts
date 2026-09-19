import { assertEquals, assertThrows } from '@std/assert'
import { load, select } from '@yaks/plugin'
import { argsFor, unique, wordFor } from '@yaks/cli'
import { namedTool, type ToolCtx } from '@yaks/graph'
import { connect } from '../mcp/harness.ts'
import { open } from './store.ts'
import { commands } from './commands.ts'
import { tools as cliTools } from './cli.ts'
import manifest from './plugin.ts'

let reads = { file: () => '', stdin: () => '' }

Deno.test('manifest contributions share one command between CLI and MCP over a graph', async () => {
  const loaded = await load([{
    id: '@yaks/harness',
    specifier: 'explicit:test',
  }], () => Promise.resolve({ default: manifest }))
  assertEquals((await select(loaded, 'vocabulary')).length, 1)
  assertEquals((await select(loaded, 'graph.plugins')).length, 1)
  const declarations = (await select(loaded, 'commands'))[0]
    .value as typeof commands
  const h = open(':memory:')
  await h.g.apply([{ entity: { eid: 'session-one' }, session: { id: 'one' } }])
  const context: ToolCtx = {
    graph: h.g,
    actor: null,
    read: (q, opts) => h.g.read(q, opts),
  }
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
  results.push(await found.verb.run({}, context))
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
  const c = commands[0]
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
    run: (args: Record<string, unknown>) => ({ result: args }),
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
