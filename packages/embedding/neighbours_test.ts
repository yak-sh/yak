// A write through the tools answers what it made is near: the host composes
// this plugin's reply into its one runner (@yaks/cli `compose`), and a task,
// a memory or a comment created by a call comes back with its nearest few of
// the same kind.

import { assertEquals } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { compose, type Plug } from '@yaks/cli/host'
import { answerOf, toolEid, worded } from '@yaks/tools'
import { hashEmbedder, searched, sweep } from './mod.ts'
import { fields } from './fields.ts'

let PLUGINS: Plug[] = [
  '@yaks/kernel',
  '@yaks/doc',
  '@yaks/task',
  '@yaks/memory',
]

// A graph with this plugin, its embedder as given.
let open = (embedder?: Record<string, unknown>) =>
  compose({
    db: ':memory:',
    numbers: false,
    plugins: [
      ...PLUGINS,
      { use: '@yaks/embedding', with: embedder ? { embedder } : {} },
    ],
  }, ['graph'])

type Yak = Awaited<ReturnType<typeof open>>

let SHELF = [
  { title: 'Fix the login page crash on submit', memory: false },
  { title: 'Paint the garden shed green', memory: false },
  { title: 'Fix the login page crash on submit', memory: true },
]

// The graph before the call: two tasks and a memory, each with its vector.
let stocked = async (yak: Yak) => {
  await yak.graph.apply(SHELF.map((s, i) => ({
    entity: { eid: `old-${i}` },
    doc: { title: s.title },
    ...s.memory ? { memory: {} } : { task: {} },
  })))
  await sweep(yak.sql, fields(yak.vocab, searched), hashEmbedder())
}

let call = async (yak: Yak, tool: string, args: Record<string, unknown>) => {
  await yak.runner.ensure([tool])
  return answerOf(
    await yak.runner.call({
      entity: { eid: '$call' },
      call: { to: toolEid(tool), args },
    }),
  )
}

let hits = (answer: Bundle[]): Comp[] =>
  answer.filter((b) => b.hit).map((b) => {
    let { near: _, ...h } = b.hit as Comp
    return { eid: b.entity.eid, ...h }
  })

let made = (answer: Bundle[]) => answer.find((b) => b.created)!.entity.eid

Deno.test('a new task answers its nearest tasks, and not itself or a memory', async () => {
  let yak = await open({ via: 'hash' })
  try {
    await stocked(yak)
    let answer = await call(yak, 'task_new', {
      title: 'The login page crashes on submit',
    })
    let found = hits(answer)
    assertEquals(found.map((h) => h.eid), ['old-0', 'old-1'])
    assertEquals(found[0], {
      eid: 'old-0',
      kind: 'task',
      title: 'Fix the login page crash on submit',
      snippet: '',
      source: 'meaning',
      status: 'open',
    })
    // What a model reads: the new task, then a line for each neighbour.
    assertEquals(
      worded(answer).split('\n').filter((l) => l.startsWith('near')),
      [
        `near ${
          made(answer)
        }: old-0 Fix the login page crash on submit · task open (meaning)`,
        `near ${
          made(answer)
        }: old-1 Paint the garden shed green · task open (meaning)`,
      ],
    )

    // Two made by one call are not each other's neighbours: both are new.
    let plan = await call(yak, 'graph_apply', {
      change: ['again', 'once more'].map((w, i) => ({
        entity: { eid: `$t${i}` },
        doc: { title: `Fix the login page crash ${w}` },
        task: {},
      })),
    })
    let each = ['old-0', made(answer), 'old-1']
    assertEquals(hits(plan).map((h) => h.eid), [...each, ...each])

    // A write that created nothing is answered as it was.
    let moved = await call(yak, 'task_update', {
      task: 'old-1',
      title: 'Paint the garden shed blue',
    })
    assertEquals(hits(moved), [])
    // Nor is a read: what it answers was there already.
    assertEquals(hits(await call(yak, 'task_list', {})), [])
  } finally {
    await yak.close()
  }
})

Deno.test('a comment answers comments near it, shown by their words', async () => {
  let yak = await open({ via: 'hash' })
  try {
    await stocked(yak)
    // The first comment's vector is made as it is answered, not by a sweep.
    await call(yak, 'comment_new', {
      target: 'old-0',
      body: 'The crash is in the submit handler of the login form.',
    })
    let answer = await call(yak, 'comment_new', {
      target: 'old-1',
      body: 'Found the submit handler crash on the login form.',
    })
    assertEquals(hits(answer).map(({ eid: _, ...h }) => h), [{
      kind: 'comment',
      snippet: 'The crash is in the submit handler of the login form.',
      source: 'meaning',
    }])
  } finally {
    await yak.close()
  }
})

Deno.test('a model out of reach leaves a twin found by its words', async () => {
  let yak = await open({
    via: 'ollama',
    model: 'm',
    base: 'http://127.0.0.1:9',
  })
  try {
    await stocked(yak)
    let answer = await call(yak, 'task_new', {
      title: 'Fix the login page crash',
    })
    assertEquals(hits(answer).map((h) => [h.eid, h.source]), [
      ['old-0', 'text'],
    ])
  } finally {
    await yak.close()
  }
})
