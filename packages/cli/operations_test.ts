import { equal, ok, test } from '@yaks/testing'
import { compose } from './host.ts'
import { operations } from './operations.ts'
import { connect, text } from '../mcp/testing.ts'

test('host operations answer through MCP without a CLI plugin', async () => {
  let host = await compose(
    { db: ':memory:', plugins: ['@yaks/kernel', '@yaks/tools'] },
    ['graph'],
    undefined,
    { process: false },
  )
  let calls: string[][] = []
  ok(
    host.anatomy().tools.some((t) =>
      t.name == 'restart' && t.package == '@yaks/cli'
    ),
  )
  let tools = operations(host, {
    runtimeDir: '/unused',
    roles: [{ unit: 'yak-test', old: ['yak-test@*.service'] }],
    lock: () => Promise.resolve({ close() {} }),
    ready: () => Promise.resolve(true),
    run: (_command, args) => {
      calls.push(args)
      return Promise.resolve({
        code: 0,
        stdout: 'yak-test@old.service active',
        stderr: '',
      })
    },
  })
  let client = await connect({ graph: host.graph, tools })
  try {
    let listed = (await client.listTools()).tools.map((t) => t.name)
    ok(listed.includes('help') && listed.includes('restart'))
    let all = await client.callTool({ name: 'help', arguments: {} })
    ok(text(all).includes('restart'))
    let detail = await client.callTool({
      name: 'help',
      arguments: { words: ['restart'] },
    })
    ok(text(detail).includes('ready replacements'))
    let restarted = await client.callTool({ name: 'restart', arguments: {} })
    equal(restarted.isError, undefined)
    ok(text(restarted).includes('ready in'))
    ok(calls.some((args) => args.includes('start')))
    ok(
      calls.some((args) =>
        args.includes('stop') && args.includes('yak-test@old.service')
      ),
    )
  } finally {
    await client.close()
    await host.close()
  }
})
