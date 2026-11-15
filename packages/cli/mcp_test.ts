import { equal, test } from '@yaks/testing'
import { argsOf, type Tool } from '@yaks/graph'
import { mcp } from '@yaks/mcp'
import { shopGraph } from '../mcp/testing.ts'
import { argsFor } from './args.ts'
import { bridge, stdio } from './mcp.ts'
import { rpc } from './rpc.ts'

let schema = {
  type: 'object',
  properties: {
    body: { type: 'string' },
    nested: { type: 'array', items: { $ref: '#/$defs/item' } },
  },
  additionalProperties: false,
  required: ['body'],
  $defs: {
    item: {
      type: 'object',
      properties: { body: { type: ['string', 'null'] } },
    },
  },
}
let echo: Tool = {
  name: 'echo_body',
  description: 'Read a body',
  inputSchema: schema,
  readOnly: true,
  run: (call) => [{
    entity: { eid: '$out' },
    content: { body: JSON.stringify(argsOf(call)) },
    output: { source: call.entity.eid },
  }],
}
let body = '@literal content\n'.repeat(200)
let sent: unknown[] = []
let handler = mcp({ graph: shopGraph(), tools: [echo] })
let ask = rpc({
  url: 'http://remote/mcp',
  fetch: async (request) => {
    sent.push(await request.clone().json())
    return await handler(request)
  },
})
let reads: string[] = []
let read = (path: string) => {
  reads.push(path)
  if (path == '/body.md') return body
  throw new Error('File does not exist')
}
let local = bridge(ask, read)
let id = 0
let request = async (method: string, params?: Record<string, unknown>) =>
  (await local({ id: ++id, method, params }))!
let call = async (args: Record<string, unknown>) =>
  (await request('tools/call', { name: echo.name, arguments: args }))
    .result as {
      isError?: boolean
      content: { text: string }[]
    }

await request('tools/list')
await call({ body: 'warm' })

test('local MCP file input expands declared strings once before sending', async () => {
  let out = await call({
    _files: true,
    body: '@/body.md',
    nested: [{ body: '@/body.md' }, { body: null }],
  })
  equal(out.isError, undefined)
  equal(JSON.parse(out.content[0].text), {
    body,
    nested: [{ body }, { body: null }],
  })
  equal((sent.at(-1) as { params: unknown }).params, {
    name: echo.name,
    arguments: { body, nested: [{ body }, { body: null }] },
  })
})

test('local MCP preserves literal input and accepts both published file opt-ins', async () => {
  let before = reads.length
  for (
    let args of [{ body: '@yaks/fp' }, { body: '@/body.md', _files: false }]
  ) {
    let out = await call(args)
    equal(JSON.parse(out.content[0].text), { body: args.body })
  }
  equal(reads.length, before)
  equal(
    JSON.parse(
      (await call({ body: '@/body.md', $files: true })).content[0].text,
    ),
    { body },
  )
})

test('unreadable local files never send a tool call to the server', async () => {
  let before = sent.length
  let out = await call({ body: '@/missing.md', _files: true })
  equal(out.isError, true)
  equal(out.content[0].text.includes('Cannot read @/missing.md'), true)
  equal(sent.length, before)
})

test('only the local MCP client adds file controls and instructions', async () => {
  let out = await request('tools/list')
  let tools = (out.result as { tools: Tool[] }).tools
  let listed = tools.find((tool) => tool.name == echo.name)!
  equal(listed.inputSchema, {
    ...schema,
    properties: { ...schema.properties, _files: { type: 'boolean' } },
  })
  let init = await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'local', version: '0' },
  })
  equal(
    (init.result as { instructions: string }).instructions.includes('_files'),
    true,
  )
})

test('CLI expands top-level files once and nested JSON strings locally', async () => {
  let out = await argsFor(echo, [
    '--body',
    '@/body.md',
    '--nested',
    '[{"body":"@/body.md"},{"body":null}]',
    '--_files',
  ], { file: read, stdin: () => '' })
  equal(out, { body, nested: [{ body }, { body: null }] })
})

test('stdio keeps request ids, skips notifications and answers malformed JSON', async () => {
  let lines = [
    '{',
    'null',
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    JSON.stringify({ jsonrpc: '2.0', id: 'hello', method: 'ping' }),
  ]
  let output: string[] = []
  await stdio(
    (async function* () {
      yield* lines
    })(),
    (line) => output.push(line),
    bridge(() => Promise.resolve({}), read),
  )
  equal(output.map((line) => JSON.parse(line)), [
    {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Invalid JSON' },
    },
    {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid request' },
    },
    { jsonrpc: '2.0', id: 'hello', result: {} },
  ])
})
