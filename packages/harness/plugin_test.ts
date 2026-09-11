import { assertEquals, assertThrows } from '@std/assert'
import { load, select } from '@yaks/plugin'
import {
  commandPlugin,
  commandTools,
  defineCommands,
  resolveCommand,
} from '@yaks/cli/structured'
import type { Ctx } from '@yaks/cli'
import type { ToolCtx } from '@yaks/graph'
import { connect } from '../mcp/harness.ts'
import { open } from './store.ts'
import { commands } from './commands.ts'
import manifest from './plugin.ts'

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
    apply: (b) => h.g.apply(b),
  }
  const results: unknown[] = []
  const cli = commandPlugin(declarations, async (c, args) => {
    assertEquals(args, [])
    results.push(await c.run({}, context))
    return 0
  })
  const ctx = { args: ['list'], note: () => {} } as unknown as Ctx
  assertEquals(
    await (await cli.verbs(ctx)).find((v) => v.name === 'session')!.run(ctx),
    0,
  )
  assertEquals(
    resolveCommand(declarations, ['list', 'session'])?.command,
    declarations[0],
  )
  const client = await connect({
    graph: h.g,
    tools: commandTools(declarations),
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

Deno.test('structured paths are explicit, deterministic, and collision checked', () => {
  const c = commands[0]
  assertEquals(commandTools([c])[0].name, 'session_list')
  assertEquals(resolveCommand([c], ['session', 'list', 'extra'])?.args, [
    'extra',
  ])
  assertEquals(resolveCommand([c], ['list']), undefined)
  assertThrows(() => defineCommands([c, c]), Error, 'Duplicate')
  assertThrows(
    () =>
      defineCommands([c, {
        ...c,
        noun: ['other'],
        aliases: [['session', 'list', 'all']],
      }]),
    Error,
    'Ambiguous',
  )
  assertThrows(
    () => defineCommands([{ ...c, noun: ['repo_branch'] }]),
    Error,
    'lowercase',
  )
  const trio = { ...c, noun: ['repo', 'branch'], verb: 'create', aliases: [] }
  assertEquals(commandTools([trio])[0].name, 'repo_branch_create')
})
