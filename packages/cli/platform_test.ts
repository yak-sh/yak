/// <reference lib="deno.ns" />
// A server's answer, shown: the same views a local graph's answer goes
// through, drawn with the vocabulary the server reports and the views of the
// packages it names. @yaks/mcp's own HTTP door is this client's `fetch`, so
// the replies are the ones a server sends.

import { assert, assertEquals } from '@std/assert'
import { docDoc } from '@yaks/doc'
import { graph } from '@yaks/graph'
import { idDoc, idKeywords } from '@yaks/id'
import { kernelDoc, kernelKeywords } from '@yaks/kernel/vocab'
import { mcp } from '@yaks/mcp'
import { ram } from '@yaks/ram'
import { taskDoc } from '@yaks/task'
import { toolsDoc } from '@yaks/tools'
import { loadVocab } from '@yaks/vocab'
import { doorUrl, rpc } from './rpc.ts'
import { printed, rosterOf } from './platform.ts'
import type { Result } from './roster.ts'
import type { Ctx } from './run.ts'
import { cached } from './store.ts'

// A server's graph as a host composes one: each document stamped with the
// package that declared it.
let vocab = loadVocab([
  { ...kernelDoc, package: '@yaks/kernel' },
  { ...idDoc, package: '@yaks/id' },
  { ...docDoc, package: '@yaks/doc' },
  { ...taskDoc, package: '@yaks/task' },
  { ...toolsDoc, package: '@yaks/tools' },
], [kernelKeywords, idKeywords])

// One command line against a server holding two tasks, one of them done, with
// the tool list cached under a scratch `YAKS_HOME` this test takes away.
let asking = async (
  go: (
    c: Ctx,
    call: (name: string, args?: object) => Promise<string>,
  ) => Promise<void>,
) => {
  let home = Deno.makeTempDirSync()
  let was = Deno.env.get('YAKS_HOME')
  Deno.env.set('YAKS_HOME', home)
  try {
    let g = graph({ storage: ram(vocab, { number: true }), vocab })
    await g.apply([
      { entity: { eid: '$a' }, doc: { title: 'Fix the bar' }, task: {} },
      {
        entity: { eid: '$b' },
        doc: { title: 'Ship it' },
        task: {},
        completed: {},
      },
    ])
    let door = mcp({ graph: g, authenticate: () => null })
    let ask = rpc({ url: doorUrl('tasks.test'), fetch: (r) => door(r) })
    let said: string[] = []
    let c: Ctx = {
      host: 'tasks.test',
      duties: false,
      json: false,
      tui: false,
      help: false,
      ask,
      reads: { file: () => '', stdin: () => '' },
      out: (line) => said.push(line),
      note: (line) => said.push(line),
      all: () => Promise.resolve([]),
      page: () => Promise.resolve(''),
    }
    let call = async (name: string, args = {}) => {
      said.length = 0
      let roster = await rosterOf(c.host, ask)
      let result = await ask('tools/call', { name, arguments: args })
      await printed(c, roster, name, result as Result)
      return said.join('\n')
    }
    await go(c, call)
  } finally {
    was == undefined
      ? Deno.env.delete('YAKS_HOME')
      : Deno.env.set('YAKS_HOME', was)
    Deno.removeSync(home, { recursive: true })
  }
}

Deno.test('a server’s answer is drawn through its packages’ views', async () => {
  await asking(async (c, call) => {
    let lines = (await call('graph_query', { q: '.task' })).split('\n').sort()
    assertEquals(lines.length, 2)
    assert(/^T-\d+ Fix the bar open$/.test(lines[0]), lines.join('\n'))
    assert(/^T-\d+ Ship it done$/.test(lines[1]), lines.join('\n'))
    // The vocabulary is asked once and kept beside the tool list.
    assertEquals(cached(c.host)?.vocab?.$defs?.task?.package, '@yaks/task')
  })
})

Deno.test('a lone entity is shown whole, as its page', async () => {
  await asking(async (_c, call) => {
    let page = await call('graph_query', { q: '.completed' })
    assert(/^task T-\d+ done\n\nShip it\n/.test(page), page)
  })
})

Deno.test('an answer that is not entities prints as the text it came as', async () => {
  await asking(async (_c, call) => {
    let schema = await call('graph_schema')
    assert(schema.includes('task'), schema)
    assert(!schema.startsWith('{'), schema)
  })
})
