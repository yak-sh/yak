/// <reference lib="deno.ns" />
// The client against a server, in one process: @yaks/mcp's own HTTP door is
// handed over as this client's `fetch`, so the JSON-RPC, the schemas and the
// results are the real ones and nothing opens a socket.

import { assert, assertEquals, assertRejects } from '@std/assert'
import { Unauthorized as Refuse } from '@yaks/api'
import { mcp } from '@yaks/mcp'
import { shopGraph } from '../mcp/harness.ts'
import { argsFor, type Reads } from './args.ts'
import { doorUrl, initialize, rpc, Unauthorized } from './rpc.ts'
import { saidBy } from './roster.ts'
import { toolHelp } from './show.ts'
import type { Tool } from './tool.ts'

let reads: Reads = { file: () => '', stdin: () => '' }

// A client of a door in this process. `signedIn: false` gives a door that
// refuses everything with the 401 an MCP server answers.
let client = (signedIn = true) => {
  let door = mcp({
    graph: shopGraph(),
    authenticate: (r: Request) => {
      if (!signedIn && !r.headers.get('authorization')) {
        throw new Refuse('sign in first')
      }
      return null
    },
  })
  return rpc({ url: doorUrl('shop.test'), fetch: (req) => door(req) })
}

let listed = async (): Promise<Tool[]> => {
  let ask = client()
  await initialize(ask)
  return (await ask('tools/list')).tools as Tool[]
}

Deno.test('a host becomes the /mcp door it names', () => {
  assertEquals(doorUrl('yaks.app'), 'https://yaks.app/mcp')
  assertEquals(doorUrl('http://localhost:8787/'), 'http://localhost:8787/mcp')
})

Deno.test('the tool list is the subcommand list', async () => {
  let names = (await listed()).map((t) => t.name).sort()
  assertEquals(names, [
    'graph_apply',
    'graph_query',
    'graph_schema',
    'graph_show',
  ])
})

Deno.test('a command line goes through the published schema and answers', async () => {
  let ask = client()
  await initialize(ask)
  let tools = (await ask('tools/list')).tools as Tool[]
  let apply = tools.find((t) => t.name == 'graph_apply')!
  let query = tools.find((t) => t.name == 'graph_query')!

  // The schema says `change` is an array, so the word on the line parses.
  let args = await argsFor(
    apply,
    ['--change', '[{"entity":{"eid":"b1"},"book":{"price":12}}]'],
    reads,
  )
  assertEquals((args.change as unknown[]).length, 1)
  let wrote = await ask('tools/call', { name: 'graph_apply', arguments: args })
  assertEquals(wrote.isError, undefined)

  // And a filter line rides as the string it is, JSON-looking or not.
  let said = await ask('tools/call', {
    name: 'graph_query',
    arguments: await argsFor(query, ['--q', '.price<20'], reads),
  })
  let { text } = saidBy(said)
  assertEquals(JSON.parse(text)[0].entity.eid, 'b1')
})

Deno.test('a tool that refused says so, and the words are what is printed', async () => {
  let ask = client()
  await initialize(ask)
  let said = await ask('tools/call', {
    name: 'graph_apply',
    arguments: { change: [{ book: {} }] },
  })
  assertEquals(said.isError, true)
  assert(saidBy(said).text.includes('"entity"'))
})

Deno.test('a 401 is one sentence a person can act on', async () => {
  let err = await assertRejects(() => client(false)('tools/list'), Unauthorized)
  assertEquals(
    err.message,
    'not signed in — run `yaks login <token>`, or set YAKS_TOKEN',
  )
})

Deno.test('help is drawn from the schema the server published', async () => {
  let query = (await listed()).find((t) => t.name == 'graph_query')!
  let help = toolHelp(query)
  assert(help.startsWith('yaks graph_query --q <string>'), help)
  assert(help.includes('--limit'), help)
})

Deno.test('a reply framed as one SSE event reads the same', async () => {
  let ask = rpc({
    url: 'https://x.test/mcp',
    fetch: () =>
      Promise.resolve(
        new Response(
          'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      ),
  })
  assertEquals(await ask('tools/list'), { tools: [] })
})
