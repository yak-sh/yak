// Capture the configured MCP declarations without opening the owner's graph.
import { compose } from '@yaks/cli/host'
import { read } from '../../packages/cli/config.ts'
import { server } from '@yaks/mcp'
import { generic } from '@yaks/graph/tools'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

let label = Deno.args[0] ?? 'after'
let configured = read('/home/yaks/.yak/yak.json')
let host = await compose(
  {
    db: ':memory:',
    plugins: configured.plugins,
    duties: false,
  },
  ['graph'],
  undefined,
  { process: false },
)
let tier = new Set(generic)
let mcp = server({
  graph: host.graph,
  tools: host.tools.filter((tool) => !tier.has(tool.name)),
  search: host.search,
  readFile: (path) => Deno.readTextFile(path),
})
let [here, there] = InMemoryTransport.createLinkedPair()
let client = new Client({ name: 'task-tools-roster', version: '0.0.0' })
try {
  await Promise.all([client.connect(here), mcp.connect(there)])
  let listed = await client.listTools()
  let body = JSON.stringify(listed.tools)
  await Deno.writeTextFile(
    `artifacts/task-tools/roster-${label}.jsonl`,
    body + '\n',
  )
  console.log(
    JSON.stringify({ label, tools: listed.tools.length, bytes: body.length }),
  )
} finally {
  await client.close()
  await host.close()
}
