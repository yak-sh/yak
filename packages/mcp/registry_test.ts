/// <reference lib="deno.ns" />
// MCP uses the same live catalog and admitted implementation as its runner.
import { equal, test } from '@yaks/testing'
import type { Tool } from '@yaks/graph'
import { registry, runner, toolEid } from '@yaks/tools'
import { connect, shopGraph } from './testing.ts'
import { mcp } from './mount.ts'

let sample = (version: string, readOnly = false): Tool => ({
  name: 'sample',
  description: `Read sample ${version}`,
  revision: version,
  readOnly,
  inputSchema: { type: 'object' },
  outputSchema: {
    type: 'object',
    properties: { version: { type: 'string' } },
    required: ['version'],
  },
  run: (call) => [{
    entity: { eid: '$answer' },
    output: { source: call.entity.eid, value: { version } },
  }],
})

// Connection setup is shared with the writable-call test so the assertion
// measures the tool call, rather than the protocol handshake.
let recordedGraph = shopGraph()
let recordedCatalog = registry([{ name: 'samples', tools: [sample('one')] }])
await runner(recordedGraph, { tools: recordedCatalog }).ensure()
let getRecorded = recordedGraph.get.bind(recordedGraph)
recordedGraph.get = (ids, comps) => {
  let rows = getRecorded(ids, comps)
  if (ids.includes(toolEid('sample'))) {
    recordedCatalog.replace('samples', [sample('two', true)])
  }
  return rows
}
let recordedClient = await connect({
  graph: recordedGraph,
  registry: recordedCatalog,
  core: false,
})

test('MCP pins admission across registry replacement while ensuring a tool row', async () => {
  try {
    equal(
      (await recordedClient.callTool({ name: 'sample' })).structuredContent,
      { version: 'one' },
    )
  } finally {
    await recordedClient.close()
  }
})

test('MCP lists and calls a replacement catalog without recording direct reads', async () => {
  let graph = shopGraph()
  let catalog = registry([{ name: 'samples', tools: [sample('one')] }])
  let client = await connect({ graph, registry: catalog, core: false })
  try {
    catalog.replace('samples', [{
      ...sample('two', true),
      name: 'another_sample',
    }])
    equal(
      (await client.listTools()).tools.map((t: { name: string }) => t.name),
      [
        'another_sample',
      ],
    )
    equal(
      (await client.callTool({ name: 'another_sample' })).structuredContent,
      { version: 'two' },
    )
    equal((await graph.read('.call')).length, 0)
  } finally {
    await client.close()
  }
})

let httpCatalog = registry([{ name: 'samples', tools: [sample('one', true)] }])
let door = mcp({ graph: shopGraph(), registry: httpCatalog, core: false })
let askHttp = async (method: string, params = {}) =>
  (await door(
    new Request('http://samples.test/mcp', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  )).json()
let initialHttp = await askHttp('tools/list')

test('the HTTP MCP handler retains a supplied registry between requests', async () => {
  equal(initialHttp.result.tools.map((t: { name: string }) => t.name), [
    'sample',
  ])
  httpCatalog.replace('samples', [sample('two', true)])
  equal(
    (await askHttp('tools/call', { name: 'sample' })).result.structuredContent,
    { version: 'two' },
  )
})
