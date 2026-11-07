/// <reference lib="deno.ns" />
// A command asked of the server running over its graph: @yaks/mcp's own door,
// addressed as `yak serve` addresses it, is this client's `fetch`, so the
// replies are the ones a server sends, and no server listens.

import { equal, ok, test, throws } from '@yaks/testing'
import { addressed } from '@yaks/api/tools'
import { docDoc } from '@yaks/doc'
import { graph } from '@yaks/graph'
import { idDoc, idKeywords } from '@yaks/id'
import { kernelDoc, kernelKeywords } from '@yaks/kernel/vocab'
import { mcp } from '@yaks/mcp'
import { ram } from '@yaks/ram'
import { taskDoc } from '@yaks/task'
import { toolsDoc } from '@yaks/tools'
import { loadVocab } from '@yaks/vocab'
import type { Ctx } from './run.ts'
import type { Declared } from './words.ts'
import { warm } from './warm.ts'

let vocab = loadVocab([
  { ...kernelDoc, package: '@yaks/kernel' },
  { ...idDoc, package: '@yaks/id' },
  { ...docDoc, package: '@yaks/doc' },
  { ...taskDoc, package: '@yaks/task' },
  { ...toolsDoc, package: '@yaks/tools' },
], [kernelKeywords, idKeywords])

let DB = '/box/yak.db'
// The config this command line reads: the server's plugins, whose own words
// and views the answer is drawn with.
let config = {
  db: DB,
  plugins: [
    '@yaks/kernel',
    '@yaks/id',
    '@yaks/doc',
    '@yaks/task',
    '@yaks/tools',
  ],
}
let query = { name: 'graph_query', readOnly: true } as Declared
let write = { name: 'graph_apply' } as Declared

type Fetch = (request: Request) => Response | Promise<Response>

// A server over a graph holding one task, serving `served` (undefined: one
// from before servers said which file they serve).
let server = async (served?: string): Promise<Fetch> => {
  let g = graph({ storage: ram(vocab, { number: true }), vocab })
  await g.apply([{ entity: { eid: '$a' }, doc: { title: 'Fix it' }, task: {} }])
  let door = mcp({ graph: g, authenticate: () => null })
  return served ? addressed(door, served) : door
}

// One command line asked of `fetch`, as a session or a keyboard: its exit
// code (undefined where it was left to this process) and what it printed.
let asked = async (
  fetch: Fetch,
  declared = query,
  args: Record<string, unknown> = { q: '.task&*' },
  more: Partial<Ctx> = { via: crypto.randomUUID() },
) => {
  let home = Deno.makeTempDirSync()
  let said: string[] = []
  let sent: string[] = []
  try {
    let c: Ctx = {
      host: 'yaks.app',
      duties: false,
      json: false,
      tui: false,
      help: false,
      state: home,
      ask: () => Promise.reject(new Error('asked yaks.app')),
      reads: { file: () => '', stdin: () => '' },
      out: (line) => said.push(line),
      note: (line) => said.push(line),
      all: () => Promise.resolve([]),
      page: () => Promise.resolve(''),
      ...more,
    }
    let code = await warm(c, config, declared, args, async (request) => {
      sent.push((await request.clone().json()).method)
      return fetch(request)
    })
    return { code, said: said.join('\n'), sent }
  } finally {
    Deno.removeSync(home, { recursive: true })
  }
}

test('the server for this graph answers a command, drawn as a local one is', async () => {
  let { code, said } = await asked(await server(DB))
  equal(code, 0)
  ok(/^T-\d+ Fix it open$/.test(said), said)
})

test('a server that could not have run it leaves the command here', async () => {
  let down: Fetch = () => Promise.reject(new TypeError('connection refused'))
  for (
    let [why, fetch, args] of [
      ['nothing listens', down],
      ['another graph', await server('/scratch/copy.db')],
      ['too old to say', await server()],
      ['an unknown tool', await server(DB), {}],
    ] as const
  ) {
    let declared = args ? { ...query, name: 'tool_from_tomorrow' } : query
    equal((await asked(fetch, declared, args)).code, undefined, why)
  }
})

test('a write typed with no session, or a tool another role runs, is never sent', async () => {
  let fetch = await server(DB)
  let typed = await asked(fetch, write, { bundles: [] }, { via: undefined })
  equal([typed.code, typed.sent], [undefined, []])
  let serve = { ...query, roles: ['web'] } as Declared
  equal((await asked(fetch, serve)).sent, [])
  equal((await asked(fetch, query, {}, { tui: true })).sent, [])
})

test('a call lost after it was sent is an error, never run again here', async () => {
  let fetch = await server(DB)
  let lost: Fetch = async (request) => {
    let { method } = await request.clone().json()
    if (method == 'tools/call') throw new TypeError('connection reset')
    return fetch(request)
  }
  await throws(() => asked(lost), 'connection reset')
})
