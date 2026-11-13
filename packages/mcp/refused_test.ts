// What a server hears of the refusals it answers: those its runner gives,
// and those made before any runner, each once.
import { equal, test } from '@yaks/testing'
import type { Tool } from '@yaks/graph'
import type { Refusal } from '@yaks/tools'
import { server } from './server.ts'
import { shopGraph } from './testing.ts'

let echo: Tool = {
  name: 'echo',
  description: 'Say a body back',
  inputSchema: {
    type: 'object',
    properties: { body: { type: 'string' } },
    required: ['body'],
  },
  readOnly: true,
  run: () => [],
}
let heard: [string, string | undefined, string][] = []
let told: unknown[] = []
let mcp = server({
  graph: shopGraph(),
  tools: [echo],
  core: false,
  readFile: () => {
    throw new Error('File does not exist')
  },
  refused: (r: Refusal, call, tool) => {
    heard.push([r.code, tool, call.entity.eid])
  },
  report: (e) => told.push(e),
})
let id = 0
let asked = async (params: unknown) => {
  heard.length = 0
  told.length = 0
  await mcp.answer(
    { jsonrpc: '2.0', id: ++id, method: 'tools/call', params } as never,
    'legacy',
  )
  return heard.map(([code, tool]) => [code, tool])
}

test('each refusal of a tool call is heard once, with its code and tool', async () => {
  for (
    let [params, said] of [
      [{ name: 'nope', arguments: {} }, ['tool', 'nope']],
      [{ name: 'echo', arguments: 'body' }, ['arguments', 'echo']],
      [{ name: 'echo', arguments: {} }, ['arguments', 'echo']],
      [
        { name: 'echo', arguments: { body: '@/missing.md', _files: true } },
        ['file', 'echo'],
      ],
    ] as const
  ) {
    equal(await asked(params), [[...said]], JSON.stringify(params))
    equal(told, [])
  }
})

test('a call to a read-only tool tells the door it only reads', async () => {
  let told = 0
  let tools: Tool[] = [echo, { ...echo, name: 'save', readOnly: false }]
  let door = server({
    graph: shopGraph(),
    tools,
    core: false,
    reading: () => told++,
  })
  let said = []
  for (let name of ['echo', 'save']) {
    told = 0
    await door.answer({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: { body: 'hi' } },
    } as never, 'legacy')
    said.push(told)
  }
  equal(said, [1, 0])
})

test('an answered call is heard by nobody', async () => {
  equal(await asked({ name: 'echo', arguments: { body: 'hi' } }), [])
})
