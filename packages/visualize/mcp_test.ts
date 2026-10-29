import { equal, test } from '@yaks/testing'
import { compose } from '@yaks/cli/host'
import { loadTools } from '@yaks/graph/tools'
import { connect, result } from '../mcp/testing.ts'
import type { Bundle } from '@yaks/graph'
import { runs } from './tools.ts'
import { docs } from './vocab.ts'
import { anatomy } from './testing.ts'
import { http } from './http.ts'
import { readJson } from '@yaks/cli'

test('MCP anatomy search and remote URL preserve JSON snapshots and activity', async () => {
  let host = await compose(
    { db: ':memory:', plugins: ['@yaks/kernel', '@yaks/tools'] },
    ['graph'],
    undefined,
    { process: false },
  )
  let routes = http({ graph: {}, anatomy, who: () => null })
  let asks: Request[] = []
  let original = globalThis.fetch
  let directory = await Deno.makeTempDir()
  let config = `${directory}/config.json`
  await Deno.writeTextFile(config, '{}')
  globalThis.fetch = ((url, init) => {
    let request = new Request(url, init)
    asks.push(request)
    return routes.find((r) => r.path == new URL(request.url).pathname)!.handle(
      request,
    )
  }) as typeof fetch
  let here = await connect({
    graph: host.graph,
    tools: loadTools(
      docs,
      runs({
        graph: {},
        readJson: (url, options) =>
          readJson(url, { ...options, config, state: directory }),
      }),
    ),
  })
  try {
    for (let name of ['visualize_anatomy', 'visualize_activity']) {
      let args = {
        url: 'https://selected.test',
        json: true,
        ...(name.endsWith('anatomy') ? { search: 'Core engine' } : { wait: 0 }),
      }
      let out = await here.callTool({ name, arguments: args })
      equal(out.isError, undefined)
      let [row] = result(out) as Bundle[]
      let value = JSON.parse((row.content as { body: string }).body)
      if (name.endsWith('anatomy')) equal(value.selection.matched, 1)
      else equal(value.coverage, 'process-local')
    }
    equal(asks.length, 2)
    equal(asks.map((r) => r.method), ['GET', 'GET'])
    equal(asks.map((r) => new URL(r.url).pathname), [
      '/visualize/anatomy',
      '/visualize/activity',
    ])
    equal(new URL(asks[0].url).searchParams.get('search'), 'Core engine')
    equal(asks.map((r) => r.redirect), ['error', 'error'])
  } finally {
    globalThis.fetch = original
    await here.close()
    await host.close()
    await Deno.remove(directory, { recursive: true })
  }
})
