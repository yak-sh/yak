// The bus follows commits: a quiet graph costs it no read, and what is
// written reaches its session at once, with no timer to wait for.

import { equal, test, tick, until } from '@yaks/testing'
import { type Bundle, graph, type News } from '@yaks/graph'
import { kernelDoc } from '@yaks/kernel/vocab'
import { provenanceDoc } from '@yaks/provenance'
import { docDoc } from '@yaks/doc'
import { mailDoc } from '@yaks/mail/vocab'
import { notifyDoc } from '@yaks/notify/vocab'
import { personaDoc } from '@yaks/persona/vocab'
import { projectDoc } from '@yaks/project/vocab'
import { processDoc } from '@yaks/process'
import { ram } from '@yaks/ram'
import { taskDoc } from '@yaks/task/vocab'
import { toolsDoc } from '@yaks/tools/vocab'
import { loadVocab } from '@yaks/vocab'
import { follow } from './bus.ts'
import { sessionDoc } from './comp.ts'
import { sessions } from './plugin.ts'
import { statusComputed } from './status.ts'

let vocab = loadVocab([
  kernelDoc,
  provenanceDoc,
  processDoc,
  docDoc,
  mailDoc,
  notifyDoc,
  personaDoc,
  projectDoc,
  taskDoc,
  sessionDoc,
  toolsDoc,
])

// A graph the bus follows with a feed of its own, a clock that never comes
// due, and every comment it reads counted.
let followed = async (rows: Bundle[]) => {
  let store = ram(vocab, { computed: statusComputed })
  let g = graph({ vocab, storage: store, plugins: [sessions()] })
  // One row a batch, so each row's `$actor` is its own.
  for (let row of rows) await g.apply([row], { trusted: true })
  let reads = 0, seen = new Set<string>()
  let count = (found: Bundle[]) => {
    reads++
    for (let b of found) if (b.comment) seen.add(b.entity.eid)
    return found
  }
  let watched = {
    ...g,
    read: async (...a: Parameters<typeof g.read>) => count(await g.read(...a)),
    get: async (...a: Parameters<typeof g.get>) => count(await g.get(...a)),
  }
  let others: ((news: News) => void | Promise<void>) | undefined
  let stop = new AbortController()
  let never = (_: number, signal: AbortSignal) =>
    new Promise((done) => signal.addEventListener('abort', done))
  let run = follow(
    {
      graph: watched,
      feed: (each) => (others = each, () => others = undefined),
    },
    stop.signal,
    { wait: never },
  )
  let said = async (eid: string) => !!(await g.get([eid]))[0]?.notified
  let settled = async () => {
    for (let i = 0; i < 5; i++) await tick()
  }
  return {
    g,
    store,
    said,
    settled,
    /** what another process wrote, as the feed tells it */
    elsewhere: async (rows: Bundle[]) => {
      store.tx((tx) => tx.patch(rows))
      await others?.({ applied: [rows], missed: false })
    },
    reset: () => (reads = 0, seen.clear()),
    reads: () => reads,
    seen: () => [...seen],
    close: () => (stop.abort(), run),
  }
}

let native = [
  { entity: { eid: 'native' }, session: { id: 'native' } },
  {
    entity: { eid: 'start' },
    entry: { session: 'native' },
    content: { body: 'start' },
    using: {},
  },
  { entity: { eid: 'agent' }, session: { id: 'agent' } },
  { entity: { eid: 'person' }, doc: { title: 'Person' } },
]

test('the bus reads nothing while the graph is quiet and says what is written at once', async () => {
  let f = await followed([
    ...native,
    {
      entity: { eid: 'mine' },
      task: {},
      $actor: { by: 'native', via: 'native' },
    },
    { entity: { eid: 'knock' }, knock: { target: 'native' } },
    ...Array.from({ length: 200 }, (_, i) => ({
      entity: { eid: `history${i}` },
      comment: { target: 'mine' },
      $actor: { by: 'agent', via: 'agent' },
    })),
  ])
  try {
    await until(() => f.said('knock'))
    await f.settled()
    f.reset()
    await f.settled()
    equal(f.reads(), 0)
    await f.g.apply([{
      entity: { eid: 'here' },
      comment: { target: 'mine' },
      doc: { body: 'from this process' },
      $actor: { by: 'person', via: 'person' },
    }], { trusted: true })
    await until(() => f.said('here'))
    equal(f.seen(), ['here'])
    await f.elsewhere([{
      entity: { eid: 'there' },
      comment: { target: 'mine' },
      doc: { body: 'from another process' },
      created: { by: 'person', via: 'person' },
    }])
    await until(() => f.said('there'))
    equal(
      (await f.g.read('.entry.session=native .content .fields=content.body'))
        .map((b) => (b.content as { body: string }).body)
        .filter((line) => line.includes('process')).length,
      2,
    )
  } finally {
    await f.close()
  }
})

test('a claim taken later routes a knock that waited', async () => {
  let f = await followed([
    ...native,
    { entity: { eid: 'page' }, doc: { title: 'Page' } },
    { entity: { eid: 'waiting' }, knock: { target: 'page' } },
  ])
  try {
    await f.settled()
    equal(await f.said('waiting'), false)
    await f.g.apply([{ entity: { eid: 'page' }, claim: { session: 'native' } }])
    await until(() => f.said('waiting'))
  } finally {
    await f.close()
  }
})

test('a session coming to work hears what its project holds', async () => {
  let f = await followed([
    { entity: { eid: 'p' }, project: {} },
    { entity: { eid: 'operator' }, persona: { home: 'p' } },
    { entity: { eid: 'resting' }, session: { persona: 'operator' } },
    {
      entity: { eid: 'asked' },
      entry: { session: 'resting' },
      content: { body: 'look into it' },
      using: {},
    },
    {
      entity: { eid: 'answered' },
      entry: { session: 'resting' },
      output: { source: 'asked' },
      content: { body: 'done' },
    },
    { entity: { eid: 'news' }, knock: { target: 'p' }, doc: { body: 'bug' } },
  ])
  try {
    await f.settled()
    equal(await f.said('news'), false)
    await f.g.apply([{
      entity: { eid: 'again' },
      entry: { session: 'resting' },
      content: { body: 'and this' },
    }], { trusted: true })
    await until(() => f.said('news'))
  } finally {
    await f.close()
  }
})
