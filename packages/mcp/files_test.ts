import { cleanup, equal, test } from '@yaks/testing'
import { argsOf, type NamedTool } from '@yaks/graph'
import { routes } from './routes.ts'
import { shopGraph } from './testing.ts'

let dir = Deno.makeTempDirSync()
let path = `${dir}/body.md`
Deno.writeTextFileSync(path, 'private canary')
cleanup(() => Deno.removeSync(dir, { recursive: true }))
let echo: NamedTool = {
  name: 'echo_body',
  description: 'Read a body',
  inputSchema: {
    type: 'object',
    properties: { body: { type: 'string' } },
    required: ['body'],
  },
  readOnly: true,
  run: (call) => [{
    entity: { eid: '$out' },
    content: { body: JSON.stringify(argsOf(call)) },
    output: { source: call.entity.eid },
  }],
}
let route = routes({
  graph: shopGraph(),
  config: {},
  tools: [echo],
  who: () => null,
})[0]
let id = 0
let ask = async (method: string, params?: unknown, tunnel = false) => {
  let response = await route.handle(
    new Request('http://local/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'mcp-protocol-version': '2025-06-18',
        ...(tunnel ? { 'x-yak-tunnel': '1', 'x-yak-caller': 'operator' } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    }),
  )
  return (await response.json()).result
}

await ask('tools/list')
await ask('tools/call', { name: echo.name, arguments: { body: 'warm' } })

test('the HTTP door never expands caller paths, including the former opt-ins', async () => {
  for (let tunnel of [false, true]) {
    for (let flags of [{}, { _files: true }, { $files: true }]) {
      let input = { body: `@${path}`, ...flags }
      let out = await ask('tools/call', {
        name: echo.name,
        arguments: input,
      }, tunnel)
      equal(out.isError, undefined)
      equal(JSON.parse(out.content[0].text), input)
    }
  }
})

test('the HTTP door lists the supplied schema without local file controls', async () => {
  let out = await ask('tools/list')
  equal(
    out.tools.find((tool: NamedTool) => tool.name == echo.name).inputSchema,
    echo.inputSchema,
  )
})
