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
  let calls: [string, string[]][] = []
  ok(
    host.anatomy().tools.some((t) =>
      t.name == 'restart' && t.package == '@yaks/cli'
    ),
  )
  let tools = operations(host, {
    config: '/box/yak.json',
    runtimeDir: '/unused',
    run: (command, args) => {
      calls.push([command, args])
      return Promise.resolve({ code: 0, stdout: '', stderr: '' })
    },
  })
  host.registry.replace('@yaks/cli', tools)
  equal(host.registry.describe('restart')?.provider, '@yaks/cli')
  let client = await connect({ graph: host.graph, runner: host.runner })
  try {
    let listed = (await client.listTools()).tools.map((t: { name: string }) =>
      t.name
    )
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
    ok(text(restarted).includes('Restart queued'))
    // The handover runs from the checkout's yak, the tree a replacement runs.
    let [[command, args]] = calls
    equal(command, 'systemd-run')
    equal(args.slice(args.indexOf('--') + 1).slice(-5), [
      new URL('./yak.ts', import.meta.url).href,
      '--config',
      '/box/yak.json',
      'restart',
      '--handover',
    ])
  } finally {
    await client.close()
    await host.close()
  }
})
