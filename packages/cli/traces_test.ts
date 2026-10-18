import { graph, mint } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { channel, during, measure, peek } from '@yaks/trace'
import { equal, ok, test } from '@yaks/testing'
import { traces } from './traces.ts'
import type { Bundle } from '@yaks/graph'

let request = (target: object, name: string, rows: number) => {
  let c = ok(peek(target))
  return during(c.begin({ kind: 'request', name }), () => {
    during(c.begin({ kind: 'phase', name: 'prepare', plugin: 'shop' }), () => {
      measure({ rowsRead: rows, rowsWritten: 0, statements: 1 })
    })
  })
}

test('box traces deliver only heavy, armed or sampled roots, with repeat counts', async () => {
  let target = {}
  let delivered: Bundle[][] = []
  let time = 1000
  let armed = false
  let rate = 0
  let recorder = traces(target, {
    process: mint(),
    sink: (rows) => {
      delivered.push(rows)
    },
    take: () => Promise.resolve({ requested: armed, rate }),
    now: () => time,
    random: () => 0.1,
  })
  request(target, 'query', 10_000)
  await Promise.resolve()
  await Promise.resolve()
  equal(delivered.length, 0)
  request(target, 'query', 10_001)
  await Promise.resolve()
  await Promise.resolve()
  equal(delivered.length, 1)
  request(target, 'query', 10_001)
  await Promise.resolve()
  await Promise.resolve()
  equal(delivered.length, 1)
  armed = true
  request(target, 'query', 1)
  await Promise.resolve()
  await Promise.resolve()
  equal(delivered.length, 2)
  equal(delivered[1][1].repeats, { n: 1 })
  equal(delivered[1][2].span, {
    trace: delivered[1][0].entity.eid,
    parent: delivered[1][1].entity.eid,
    op: 'phase',
    name: 'prepare',
    plugin: 'shop',
    outcome: 'ok',
  })
  armed = false
  rate = 1
  request(target, 'query', 2)
  await Promise.resolve()
  await Promise.resolve()
  equal(delivered.length, 3)
  rate = 0
  time += 3_600_000
  request(target, 'query', 10_001)
  await recorder.close()
  equal(delivered.length, 4)
  equal(delivered[0][1].rows_read, { n: 10_001 })
  equal(delivered[0][1].statements, { n: 1 })
  equal(peek(target), undefined)
  equal(channel(target).history(), [])
})

test('nested applies are one request tree, and concurrent roots stay separate', async () => {
  let target = {}
  let sent: Bundle[][] = []
  let recorder = traces(target, {
    process: mint(),
    sink: (rows) => {
      sent.push(rows)
    },
    take: () => Promise.resolve({ requested: true, rate: 0 }),
  })
  let c = ok(peek(target))
  let first = c.begin({ kind: 'request', name: 'first' })!
  let second = c.begin({ kind: 'request', name: 'second' })!
  c.begin({ kind: 'apply', name: 'apply', parent: second.id })!.end()
  second.end()
  c.begin({ kind: 'apply', name: 'apply', parent: first.id })!.end()
  first.end()
  await recorder.close()
  equal(sent.length, 2)
  equal(sent.map((rows) => rows.length), [3, 3])
  equal(sent.map((rows) => (rows[0].trace as { name: string }).name).sort(), [
    'first',
    'second',
  ])
})

let unselectedWork = await (async () => {
  let vocab = loadVocab({
    $defs: {
      note: {
        component: true,
        type: 'object',
        properties: { title: { type: 'string' } },
      },
    },
  })
  let g = graph({ vocab, storage: ram(vocab) })
  let state = { sends: 0 }
  let recorder = traces(g, {
    process: mint(),
    take: () => Promise.resolve({ requested: false, rate: 0 }),
    sink: () => {
      state.sends++
    },
  })
  let events: string[] = []
  let stop = channel(g).subscribe((e) => {
    if (e.stage == 'start') events.push(e.kind)
  }, { history: false })
  await g.apply([{ entity: { eid: mint() }, note: { title: 'one' } }])
  return { recorder, state, events, stop }
})()

test('unselected work performs no graph operations or delivery for tracing', async () => {
  let { recorder, state, events, stop } = unselectedWork
  await recorder.close()
  stop()
  equal(state.sends, 0)
  equal(events.filter((kind) => kind == 'apply').length, 1)
  equal(events.filter((kind) => kind == 'query' || kind == 'get').length, 0)
})

test('closing tracing abandons unselected work waiting on capture control', async () => {
  let target = {}
  let selection = Promise.withResolvers<{ requested: boolean; rate: number }>()
  let sent = 0
  let recorder = traces(target, {
    process: mint(),
    take: () => selection.promise,
    sink: () => {
      sent++
    },
  })
  request(target, 'waiting for capture control', 2)
  await recorder.close()
  equal(sent, 0)
  // A lock becoming available after shutdown cannot deliver a late trace.
  selection.resolve({ requested: true, rate: 0 })
  await Promise.resolve()
  equal(sent, 0)
})

test('closing tracing finishes delivery already selected', async () => {
  let target = {}
  let delivering = Promise.withResolvers<void>()
  let accepted = Promise.withResolvers<void>()
  let delivered = false
  let recorder = traces(target, {
    process: mint(),
    take: () => Promise.resolve({ requested: true, rate: 0 }),
    sink: async () => {
      accepted.resolve()
      await delivering.promise
      delivered = true
    },
  })
  request(target, 'selected before shutdown', 2)
  await accepted.promise
  let closed = false
  let ending = recorder.close().then(() => {
    closed = true
  })
  await Promise.resolve()
  equal(closed, false)
  delivering.resolve()
  await ending
  equal(delivered, true)
})

let startTarget = {}
let startStacks: string[] = []
let startLeft = 1
let startRecorder = traces(startTarget, {
  process: mint(),
  take: () => Promise.resolve({ requested: false, rate: 0 }),
  getStart: () => startLeft-- > 0,
  reportGetStart: (stack) => startStacks.push(stack),
})
let startChannel = channel(startTarget)
let openGet = startChannel.begin({ kind: 'get', name: 'get' })
test('armed GET caller capture is delivered before completion and bounded', () => {
  equal(startStacks.length, 1)
  equal(startStacks[0].includes('armed get start'), true)
  equal(startStacks[0].length <= 8192, true)
})
openGet?.end()
await startRecorder.close()
