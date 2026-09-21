/// <reference lib="deno.ns" />
// The command's own words at their pure seam: `ask` is a function that records
// what it was asked, so nothing here opens a socket. What is proven is the one
// thing the line adds to the tool — a dry run is `check` on the call.

import { assert, assertEquals } from '@std/assert'
import { cli } from './run.ts'
import { own, YAK } from './yak.ts'

type Call = { name: string; arguments: Record<string, unknown> }

// One line aimed at a DOOR that lists `graph_apply` and answers anything.
// `YAKS_HOME` is where the tool list is cached, so it points at a scratch
// directory this test takes away with it; `YAK_CONFIG`, `YAKS_HOST` and `HOME`
// are all moved off the box's own, so the line opens no graph of its own
// whatever this box keeps.
let ran = async (argv: string[]): Promise<Call[]> => {
  let home = Deno.makeTempDirSync()
  let was = { ...Deno.env.toObject() }
  Deno.env.set('YAKS_HOME', home)
  Deno.env.set('HOME', home)
  Deno.env.delete('YAK_CONFIG')
  Deno.env.delete('YAKS_HOST')
  let calls: Call[] = []
  try {
    await cli(own, {
      ...YAK,
      argv,
      host: 'yaks.test',
      reads: { file: () => '', stdin: () => '' },
      out: () => {},
      note: () => {},
      ask: (method, params) => {
        if (method == 'tools/list') {
          return Promise.resolve({ tools: [{ name: 'graph_apply' }] })
        }
        if (method == 'initialize') {
          return Promise.resolve({ protocolVersion: '2025-06-18' })
        }
        calls.push(params as Call)
        return Promise.resolve({ content: [{ type: 'text', text: 'done' }] })
      },
    })
    return calls
  } finally {
    for (let name of ['YAKS_HOME', 'HOME', 'YAK_CONFIG', 'YAKS_HOST']) {
      was[name] == undefined
        ? Deno.env.delete(name)
        : Deno.env.set(name, was[name])
    }
    Deno.removeSync(home, { recursive: true })
  }
}

let change = '[{"entity":{"eid":"$a"},"doc":{"title":"One"}}]'

Deno.test('a dry run is the tool’s check, and nothing else moves', async () => {
  let [dry] = await ran(['apply', '--change', change, '--dry-run'])
  assertEquals(dry.name, 'graph_apply')
  assertEquals(dry.arguments.check, true)
  assert(Array.isArray(dry.arguments.change))
  let [wet] = await ran(['apply', '--change', change])
  assertEquals(wet.arguments.check, undefined)
})
