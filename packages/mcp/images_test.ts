/// <reference lib="deno.ns" />
import { equal, test } from '@yaks/testing'
import type { Tool } from '@yaks/graph'
import { connect, shopGraph } from './testing.ts'
import { mcp } from './mount.ts'

let images = [
  { data: 'cGhvbmU=', mime_type: 'image/png' },
  { data: 'ZGVza3RvcA==', mime_type: 'image/jpeg' },
]
let tool: Tool = {
  name: 'preview',
  description: 'Read a preview',
  readOnly: true,
  input: {},
  outputSchema: {
    type: 'object',
    properties: { width: { type: 'number' } },
    required: ['width'],
    additionalProperties: false,
  },
  run: (call) => [{
    entity: { eid: '$said' },
    content: { body: 'Preview captured.' },
    output: { source: call.entity.eid, value: { width: 390 }, images },
  }],
}
let expected = {
  content: [
    { type: 'text', text: 'Preview captured.' },
    { type: 'image', data: images[0].data, mimeType: 'image/png' },
    { type: 'image', data: images[1].data, mimeType: 'image/jpeg' },
    { type: 'text', text: 'Tool list changed.' },
  ],
  structuredContent: { width: 390 },
}
let options = {
  tools: [tool],
  core: false,
  roster: () => ({ line: 'Tool list changed.' }),
}
let client = await connect(options)
let entityClient = await connect({
  tools: [{ ...tool, outputSchema: undefined }],
  core: false,
})
let door = mcp({ graph: shopGraph(), ...options })

test('MCP displays images beside text while preserving the declared structured answer', async () => {
  try {
    equal<unknown>(await client.callTool({ name: 'preview' }), expected)
  } finally {
    await client.close()
  }
})

test('MCP keeps the complete bundle answer when images use the default schema', async () => {
  try {
    let out = await entityClient.callTool({ name: 'preview' })
    equal(out.content, expected.content.slice(0, -1))
    let rows = (out.structuredContent as { result: Record<string, unknown>[] })
      .result
    equal(rows[0].content, { body: 'Preview captured.' })
    let output = rows[0].output as Record<string, unknown>
    equal(output.images, images)
    equal(output.value, { width: 390 })
  } finally {
    await entityClient.close()
  }
})

test('legacy HTTP MCP returns image blocks beside its structured answer', async () => {
  let response = await door(
    new Request('https://preview.test/mcp', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'preview', arguments: {} },
      }),
    }),
  )
  equal((await response.json()).result, expected)
})
