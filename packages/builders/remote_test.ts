import { equal, ok, test } from '@yaks/testing'
import { compose } from '@yaks/cli/host'
import { loadTools } from '@yaks/graph/tools'
import { connect, shopGraph, text } from '../mcp/testing.ts'
import { said } from '@yaks/tools/result'
import { builderDoc } from './vocab.ts'
import { runs } from './tools.ts'

test('MCP builder scope forwards remote ids without resolving them locally', async () => {
  let host = await compose(
    { db: ':memory:', plugins: ['@yaks/kernel', '@yaks/tools'] },
    ['graph'],
    undefined,
    { process: false },
  )
  let asks: unknown[] = []
  let returned: string[] = []
  let there = await connect({
    graph: shopGraph(),
    tools: [{
      name: 'builder_build',
      description: '',
      inputSchema: { type: 'object' },
      run: (call) => [said(call, 'remote-build')],
    }],
  })
  let tools = loadTools(
    [builderDoc],
    runs({
      vocab: host.vocab,
      remote: async (name, args, options) => {
        asks.push({ name, args, options })
        let answer = await there.callTool({ name, arguments: args })
        let rows = (answer.structuredContent as {
          result: import('@yaks/graph').Bundle[]
        }).result
        returned = rows.map((b) => b.entity.eid)
        return rows
      },
    }),
  ).filter((t) => t.name == 'builder_build')
  let here = await connect({ graph: host.graph, tools })
  try {
    let args = {
      builder: 'remote:builder',
      provider: 'remote:provider',
      model: 'remote:model',
      only: ['remote:item'],
      space: 'space',
      app: 'app',
      as: 'account',
    }
    let out = await here.callTool({ name: 'builder_build', arguments: args })
    equal(out.isError, undefined)
    ok(text(out).includes('remote-build'))
    equal(await host.graph.get(returned), [])
    let { as, ...input } = args
    equal(asks, [{
      name: 'builder_build',
      args: input,
      options: { as, via: undefined },
    }])
  } finally {
    await here.close()
    await there.close()
    await host.close()
  }
})
