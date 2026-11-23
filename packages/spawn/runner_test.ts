import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { line } from '@yaks/query'
import { runs } from './machines.ts'
import { type Child, run, type Runner } from './runner.ts'
import { INIT, ME, say, space, TASK } from './testing.ts'

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

// The space's tools as its connector runs them: called as the machine's
// owner, answering their content.body.
let tools = (g: Graph): Runner['call'] => async (name, args) => {
  let out = await runs()[name]({
    entity: { eid: crypto.randomUUID() },
    call: { name, args, actor: ME },
  }, g) as Bundle[]
  return String(comp(out[0], 'content')?.body ?? '')
}

// A CLI that prints `lines` and exits `code`, keeping what it was started
// with.
let cli = (lines: string[], code: number | null) => {
  let started: { argv: string[]; cwd: string; env: Record<string, string> }[] =
    []
  let launch: Runner['launch'] = (argv, o) => {
    started.push({ argv, ...o })
    return Promise.resolve<Child>({
      pid: 7,
      lines: (async function* () {
        yield* lines
      })(),
      done: Promise.resolve(code),
    })
  }
  return { launch, started }
}

test('a machine runs what its space asks with its own CLI, and its report lands on the task', async () => {
  let { g } = await space()
  let stop = new AbortController()
  let { launch, started } = cli([INIT, say('Fixed the parser.')], 0)
  let looping = run({
    machine: 'mbp',
    call: tools(g),
    checkout: (session) => Promise.resolve(`/runs/${session}`),
    launch,
    mcp: { yaks: 'https://yaks.app/mcp' },
    token: () => Promise.resolve('tok'),
    every: 1,
    signal: stop.signal,
  })
  let report: Bundle | undefined
  while (!report) {
    ;[report] = await g.read(line`.comment.target=${TASK}&*`)
    await new Promise((go) => setTimeout(go, 1))
  }
  stop.abort()
  await looping
  assertEquals(started.length, 1)
  let [{ argv, cwd, env }] = started
  assertEquals(cwd, '/runs/S1')
  assertEquals(argv[0], 'claude')
  assert(!argv.includes('tok'))
  assertEquals(Object.values(env).filter((v) => v == 'tok').length, 1)
  assertStringIncludes(String(comp(report, 'doc')?.body), 'Fixed the parser.')
  let [row] = await g.get(['S1'])
  assertEquals(comp(row, 'process')?.pid, 7)
  assertEquals(comp(row, 'exit')?.code, 0)
})
