/// <reference lib="deno.ns" />
// The command's own words at their pure seam: `ask` is a function that records
// what it was asked, so nothing here opens a socket. What is proven is what the
// line adds to the tool: a dry run is `check` on the call, and a sign-out ends
// the token rather than only forgetting it.

import { human } from '@yaks/id'
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { cli } from './run.ts'
import { tokenFor } from './store.ts'
import { own, YAK } from './main.ts'
import { close, opened } from './local.ts'

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
  try {
    await cli(own, {
      ...YAK,
      argv,
      env: (name) =>
        name == 'YAKS_HOME' ? home : name == 'YAKS_TOKEN' ? o.token : undefined,
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
    return {
      calls,
      said,
      kept: await tokenFor('yaks.test', home, { env: () => undefined }),
    }
  } finally {
    Deno.removeSync(home, { recursive: true })
  }
}

let bundles = '[{"entity":{"eid":"$a"},"doc":{"title":"One"}}]'

test('--version and version print the @yaks/cli release, and ask nothing', async () => {
  let release = (await import('./package.json', { with: { type: 'json' } }))
    .default.version
  for (let argv of [['--version'], ['version']]) {
    let { calls, said } = await ran(argv)
    assertEquals([said, calls], [[release], []])
  }
})

test('a dry run is the tool’s check, and nothing else moves', async () => {
  let { calls: [dry] } = await ran([
    'apply',
    '--bundles',
    bundles,
    '--dry-run',
  ])
  assertEquals(dry.name, 'graph_apply')
  assertEquals(dry.arguments.check, true)
  assert(Array.isArray(dry.arguments.bundles))
  let { calls: [wet] } = await ran(['apply', '--bundles', bundles])
  assertEquals(wet.arguments.check, undefined)
})

// `init` starts a graph where there was none: a config that opens, naming a
// person the graph holds, whose name is the first task, T-1, filed to them to
// confirm, and `name` renames. A second `init` on the same path is refused and
// leaves the first alone; `init --force` rewrites it, keeping graph and person
// and saving the old one beside it.
test('init writes a config whose graph knows its person', async () => {
  let dir = Deno.makeTempDirSync()
  let path = `${dir}/yak.json`
  let said: string[] = []
  let line = (argv: string[]) =>
    cli(own, {
      ...YAK,
      argv: [...argv, '--config', path],
      env: () => undefined,
      reads: { file: () => '', stdin: () => '' },
      out: (line: string) => void said.push(line),
      note: () => {},
    })
  try {
    assertEquals(await line(['init']), 0)
    let first = Deno.readTextFileSync(path)
    let { person } = JSON.parse(first)
    let host = await opened(path, ['graph'], false)
    let [task] = await host.graph.read(`.task&.filed.assignee=${person}`)
    assertEquals(human(host.vocab)(task), 'T-1')
    assertEquals(await line(['name', 'Ada']), 0)
    let [me] = await host.graph.read(`.entity.eid=${person}&.person&.doc`)
    assertEquals((me?.doc as { title?: string } | undefined)?.title, 'Ada')
    await close(0)
    assertEquals(await line(['init']), 1)
    assertEquals(Deno.readTextFileSync(path), first)
    let older = { ...JSON.parse(first), db: 'mine.db', port: 9 }
    Deno.writeTextFileSync(path, JSON.stringify(older))
    said.length = 0
    assertEquals(await line(['init', '--force']), 0)
    let now = JSON.parse(Deno.readTextFileSync(path))
    assertEquals([now.person, now.db, now.port], [person, 'mine.db', undefined])
    assertEquals(said.includes('Replaced port: dropped 9'), true)
    let [saved] = [...Deno.readDirSync(dir)]
      .filter((e) => e.name.startsWith('yak.json.'))
    assertEquals(
      JSON.parse(Deno.readTextFileSync(`${dir}/${saved.name}`)),
      older,
    )
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})
