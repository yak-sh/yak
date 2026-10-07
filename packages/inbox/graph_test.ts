import { equal, ok, test, until } from '@yaks/testing'
import { type Graph, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { type Frame, subscriptions } from '@yaks/api'
import { kernelDoc } from '@yaks/kernel'
import { docDoc } from '@yaks/doc'
import { taskDoc } from '@yaks/task'
import { sessionDoc } from '@yaks/session/vocab'
import { toolsDoc } from '@yaks/tools/vocab'
import { inboxDoc } from './vocab.ts'
import { plugins } from './graph.ts'
import { summaryQuery } from './queries.ts'

let shop = () => {
  let v = loadVocab([
    kernelDoc,
    docDoc,
    taskDoc,
    sessionDoc,
    toolsDoc,
    inboxDoc,
  ])
  let g: Graph
  g = graph({
    vocab: v,
    storage: ram(v),
    plugins: plugins({
      get graph() {
        return g
      },
    }),
  })
  return g
}
test('summary subscription is exact, refreshes on policy dependencies, and keeps history off the wire', async () => {
  let g = shop()
  await g.storage.tx((tx) =>
    tx.patch([
      { entity: { eid: 'person' }, doc: { title: 'Person' } },
      {
        entity: { eid: 'root' },
        conversation: {},
        doc: { title: 'Question', body: 'long root'.repeat(1000) },
        created: { by: 'person', at: '2026-10-01' },
      },
      {
        entity: { eid: 'reply' },
        comment: { target: 'root' },
        doc: { body: 'needle'.repeat(1000) },
        created: { by: 'agent', at: '2026-10-02' },
      },
    ])
  )
  let subs = subscriptions(g), frames: Frame[] = []
  let to = (f: Frame) => {
    frames.push(f)
  }
  await subs.open(to, 'summary', summaryQuery('person'))
  let first = frames[0]?.bundles?.[0]?.inbox_summary as {
    threads: {
      eid: string
      lane: string
      messages: unknown[]
      unread: boolean
    }[]
  }
  equal(first.threads.map((t) => [t.eid, t.lane, t.unread]), [[
    'root',
    'Replies',
    true,
  ]])
  equal(first.threads[0].messages, [])
  ok(!JSON.stringify(frames).includes('needle'))
  frames.length = 0
  await g.storage.tx((tx) =>
    tx.patch([{
      entity: { eid: 'root' },
      archived: { at: '2026-10-03', by: 'person' },
    }])
  )
  await subs.commit([{
    entity: { eid: 'root' },
    archived: { at: '2026-10-03', by: 'person' },
  }])
  await until(() => frames.length > 0)
  equal(
    (frames.at(-1)?.bundles?.[0]?.inbox_summary as typeof first).threads.length,
    0,
  )
  let found = await g.read(
    summaryQuery('person', { text: 'needle', all: true }),
  )
  equal((found[0].inbox_summary as typeof first).threads.map((t) => t.eid), [
    'root',
  ])
  let detail = await g.read(summaryQuery('person', { all: true }, 'root'))
  ok(JSON.stringify(detail).includes('needle'))
  subs.drop(to)
})

test('a web reader calculates summary views in its read worker, without a second local scan', async () => {
  let target = shop(), server = shop(), calls = 0
  server.use(
    plugins({
      graph: target,
      reader: {
        read: (q) => {
          calls++
          return target.read(q)
        },
      },
    })[0],
  )
  // The forwarding plugin is appended after the local plugin in shop; make a
  // host with only the forwarding view so its first view owns the request.
  let g = graph({
    vocab: server.vocab,
    storage: ram(server.vocab),
    plugins: plugins({
      graph: target,
      reader: {
        read: (q) => {
          calls++
          return target.read(q)
        },
      },
    }),
  })
  equal((await g.read(summaryQuery('person'))).length, 1)
  equal(calls, 1)
})
