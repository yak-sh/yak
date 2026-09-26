/// <reference lib="deno.ns" />
// The command's own words at their pure seam: `ask` is a function that records
// what it was asked, so nothing here opens a socket. What is proven is what the
// line adds to the tool: a dry run is `check` on the call, and a sign-out ends
// the token rather than only forgetting it.

import { assert, assertEquals } from '@std/assert'
import { cli } from './run.ts'
import { saveToken, tokenFor } from './store.ts'
import { own, YAK } from './yak.ts'

type Call = { name: string; arguments: Record<string, unknown> }

// One line aimed at a door that lists `graph_apply` and answers anything, or
// refuses every call when `refusing`. Its environment names only `YAKS_HOME`,
// a scratch directory the tool list and any `token` are kept in and this test
// takes away with it: no `HOME`, `YAK_CONFIG` or `YAKS_HOST`, so the line opens
// no graph of its own whatever this box keeps.
let ran = async (
  argv: string[],
  o: { token?: string; refusing?: boolean } = {},
): Promise<{ calls: Call[]; said: string[]; kept: string | null }> => {
  let home = Deno.makeTempDirSync()
  let calls: Call[] = []
  let said: string[] = []
  if (o.token) saveToken('yaks.test', o.token, home)
  try {
    await cli(own, {
      ...YAK,
      argv,
      env: (name) => name == 'YAKS_HOME' ? home : undefined,
      host: 'yaks.test',
      reads: { file: () => '', stdin: () => '' },
      out: (l) => said.push(l),
      note: (l) => said.push(l),
      ask: (method, params) => {
        if (method == 'tools/list') {
          return Promise.resolve({ tools: [{ name: 'graph_apply' }] })
        }
        if (method == 'initialize') {
          return Promise.resolve({ protocolVersion: '2025-06-18' })
        }
        calls.push(params as Call)
        return o.refusing
          ? Promise.reject(new Error('no tool grant'))
          : Promise.resolve({ content: [{ type: 'text', text: 'Revoked.' }] })
      },
    })
    return { calls, said, kept: tokenFor('yaks.test', home) }
  } finally {
    Deno.removeSync(home, { recursive: true })
  }
}

let change = '[{"entity":{"eid":"$a"},"doc":{"title":"One"}}]'

Deno.test('a dry run is the tool’s check, and nothing else moves', async () => {
  let { calls: [dry] } = await ran([
    'apply',
    '--change',
    change,
    '--dry-run',
  ])
  assertEquals(dry.name, 'graph_apply')
  assertEquals(dry.arguments.check, true)
  assert(Array.isArray(dry.arguments.change))
  let { calls: [wet] } = await ran(['apply', '--change', change])
  assertEquals(wet.arguments.check, undefined)
})

// `init` starts a graph where there was none: a config that opens, naming a
// person the graph holds under the name given. A second `init` on the same
// path is refused and leaves the first alone.
Deno.test('init writes a config whose graph knows its person', async () => {
  let dir = Deno.makeTempDirSync()
  let path = `${dir}/yak.json`
  let line = (argv: string[]) =>
    cli(own, {
      ...YAK,
      argv: [...argv, '--config', path],
      env: () => undefined,
      reads: { file: () => '', stdin: () => '' },
      out: () => {},
      note: () => {},
    })
  try {
    assertEquals(await line(['init', 'Ada']), 0)
    let first = Deno.readTextFileSync(path)
    let { person } = JSON.parse(first)
    let { opened, close } = await import('./local.ts')
    let host = await opened(path, ['graph'], false)
    let [me] = await host.graph.read(`.eid=${person}&.person&.doc`)
    assertEquals((me?.doc as { title?: string } | undefined)?.title, 'Ada')
    await close(0)
    assertEquals(await line(['init', 'Bob']), 1)
    assertEquals(Deno.readTextFileSync(path), first)
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

Deno.test('a sign-out asks the host to revoke the token, then forgets it', async () => {
  let out = await ran(['logout'], { token: 'yaks_abc' })
  assertEquals(out.calls, [{
    name: 'grant',
    arguments: { revoke: 'yaks_abc' },
  }])
  assertEquals(out.kept, null)
  // A host that cannot revoke it still has it forgotten here, and says so.
  let no = await ran(['logout'], { token: 'yaks_abc', refusing: true })
  assertEquals(no.kept, null)
  assert(no.said.join('\n').includes('did not revoke it'), no.said.join('\n'))
  // And with nothing kept there is nothing to ask anybody.
  assertEquals((await ran(['logout'])).calls, [])
})
