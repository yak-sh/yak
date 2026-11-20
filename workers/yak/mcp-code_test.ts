import { equal, test } from '@yaks/testing'
import { argsOf, mint, type Tool } from '@yaks/graph'
import { listing } from '@yaks/mcp'
import { platform } from './directory-probe.ts'
import { directoryOf } from './directory.ts'
import { operatorContext } from './operator.ts'
import { operatorMemory } from './operator-testing.ts'
import { compiler } from './testing.ts'
import { evaluate } from '../../packages/code-mode/testing.ts'
import { coded } from './agent-code.ts'

test('remote MCP tools run in code mode while the connector keeps its published roster', async () => {
  let { env } = platform('mcp-code', {
    CODE_MODE: evaluate,
    ESBUILD: compiler(),
  })
  let person = mint(), dir = directoryOf(env.STORE)
  let eid = await dir.mint(person, 'books', 'Books', {
    'x-yak-person': person,
    'x-yak-role': 'owner',
  })
  let ctx = await operatorContext(
    env,
    { person },
    (await dir.at(eid))!,
    () => dir,
  )
  let store = operatorMemory(), calls: unknown[] = []
  let remote: Tool = {
    name: 'Books_Print__quote',
    description: 'Quote a book',
    inputSchema: {
      type: 'object',
      properties: { pages: { type: 'number' } },
      required: ['pages'],
    },
    readOnly: true,
    run: (call) => {
      calls.push(argsOf(call))
      return [{
        entity: { eid: '$said' },
        output: { source: call.entity.eid, value: { total: 12 } },
      }]
    },
  }
  let opts = { graph: store.g, core: false as const }
  let local = { graph: store.g, person, space: eid }
  let base = listing(coded(opts, ctx, local)).map((t) => t.name)
  let reads = 0
  let connected = coded(opts, ctx, local, () => {
    reads++
    return Promise.resolve([remote])
  })
  equal(listing(connected).map((t) => t.name), base)
  equal(reads, 0)
  let code = listing(connected).find((t) => t.name == 'code_mode')!
  let run = (args: Record<string, unknown>) =>
    code.run({
      entity: { eid: mint() },
      call: { args },
    }, store.g)
  let described = await run({ search: 'Quote a book' })
  equal(reads, 1)
  let value =
    (described[0].output as { value: { tools: { path: string[] }[] } }).value
  equal(value.tools.map((t) => t.path), [['mcp', 'Books_Print__quote']])
  let result = await run({
    script:
      'let quote = await tools.mcp.Books_Print__quote({pages:32}); return quote.structuredContent.result[0].output.value',
  })
  let out =
    (result[0].output as { value: { error?: string; value: unknown } }).value
  equal(out.error, undefined)
  equal(out.value, { total: 12 })
  equal(calls, [{ pages: 32 }])
})

test('a tool a host keeps out of scripts is listed for a direct call and found by no script', async () => {
  let { env } = platform('mcp-code-unscripted', {
    CODE_MODE: evaluate,
    ESBUILD: compiler(),
  })
  let person = mint(), dir = directoryOf(env.STORE)
  let eid = await dir.mint(person, 'quiet', 'Quiet', {
    'x-yak-person': person,
    'x-yak-role': 'owner',
  })
  let ctx = await operatorContext(
    env,
    { person },
    (await dir.at(eid))!,
    () => dir,
  )
  let store = operatorMemory(), ran = 0
  let mint_: Tool = {
    name: 'quiet_mint',
    description: 'Mint a token',
    inputSchema: { type: 'object' },
    run: () => (ran++, []),
  }
  let opts = { graph: store.g, core: false as const, tools: [mint_] }
  let connected = coded(
    { ...opts, unscripted: new Set(['quiet_mint']) },
    ctx,
    { graph: store.g, person, space: eid },
  )
  let names = listing(connected).map((t) => t.name)
  equal(names.includes('quiet_mint'), true)
  let code = listing(connected).find((t) => t.name == 'code_mode')!
  let [said] = await code.run({
    entity: { eid: mint() },
    call: { args: { script: 'return await tools.yaks.quiet_mint({})' } },
  }, store.g)
  equal(
    (said.output as { value: { error?: string } }).value.error != null,
    true,
  )
  equal(ran, 0)
})
