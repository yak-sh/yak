import { assertEquals } from '@std/assert'
import { argsFor, commandFor, unique } from '@yaks/cli'
import { compose } from '@yaks/cli/host'
import { argsOf, type Bundle, namedTool, offered } from '@yaks/graph'
import { answerOf, toolEid, worded } from '@yaks/tools'
import { connect } from '../mcp/testing.ts'
import { harness } from './testing.ts'

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
      '@yaks/harness',
    ],
  }, ['graph'])

Deno.test('the harness composes as a plugin, and its words reach a command line and MCP', async () => {
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
    assertEquals(mcp.includes('session_new'), false)
    assertEquals(mcp.includes('model_list'), false)
    assertEquals(mcp.includes('session_list'), true)
    unique(h.tools)

    await h.graph.apply([{ entity: { eid: 'one' }, session: { id: 'one' } }])
    await h.runner.ensure()
    let found = commandFor(h.tools, ['session', 'list'])!
    assertEquals(commandFor(h.tools, ['list', 'session'])?.verb, found.verb)
    assertEquals(await argsFor(found.verb, found.args, reads), {})
    let said = worded(answerOf(
      await h.runner.call({
        entity: { eid: '$call' },
        call: { to: toolEid(namedTool(found.verb).name), args: {} },
      }),
    ))
    assertEquals(said.includes('one'), true)
  } finally {
    await h.close()
  }
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
