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

test('unselected work performs no graph operations or delivery for tracing', async () => {
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
  let sends = 0
  let recorder = traces(g, {
    process: mint(),
    take: () => Promise.resolve({ requested: false, rate: 0 }),
    sink: () => {
      sends++
    },
  })
  let events: string[] = []
  let stop = channel(g).subscribe((e) => {
    if (e.stage == 'start') events.push(e.kind)
  }, { history: false })
  await g.apply([{ entity: { eid: mint() }, note: { title: 'one' } }])
  await recorder.close()
  stop()
  equal(sends, 0)
  equal(events.filter((kind) => kind == 'apply').length, 1)
  equal(events.filter((kind) => kind == 'query' || kind == 'get').length, 0)
})
