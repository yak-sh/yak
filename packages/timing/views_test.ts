import { equal, ok, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { ram } from '@yaks/ram'
import { docDoc } from '@yaks/doc'
import { toolsDoc } from '@yaks/tools/vocab'
import { trackerDoc } from '@yaks/tracker/vocab'
import { timingDoc } from './vocab.ts'
import {
  branches,
  ordinary,
  peers,
  sameKind,
  spans,
  totals,
} from './readings.ts'
import { inspectViews } from './inspect.ts'
import { views } from './views.ts'
import { render } from '@yaks/preact'
import { renderToString } from 'preact-render-to-string'
import { h } from 'preact'
import type { Bundle, Io } from '@yaks/inspect'
import { Flamegraph } from './Flamegraph.ts'
let vocab = loadVocab([kernelDoc, toolsDoc, docDoc, trackerDoc, timingDoc], [
  kernelKeywords,
])
let row = (id: string, parent?: string, n = 10): Bundle => ({
  entity: { eid: id },
  span: {
    trace: 'trace',
    parent,
    op: parent ? 'sql' : 'request',
    name: parent ? 'select entity' : 'POST apply',
    plugin: parent ? '@yaks/sqlite' : undefined,
  },
  rows_read: { n },
  rows_written: { n: 0 },
  statements: { n: 1 },
  elapsed: { start: parent ? 1 : 0, ms: parent ? 2 : 5 },
})
let trace: Bundle = {
  entity: { eid: 'trace' },
  trace: { op: 'request', name: 'POST apply', at: '2026-10-06T12:00:00Z' },
  during: { space: 'space', entity: 'store', app: 'app' },
}
test('root totals do not double-count inclusive children and missing measurements stay unknown', () => {
  equal(totals([row('root', undefined, 100), row('child', 'root', 70)]), {
    elapsed: 5,
    rows_read: 100,
    rows_written: 0,
    statements: 1,
  })
  let missing = row('root')
  delete missing.rows_read
  equal(totals([missing]).rows_read, undefined)
  equal(totals([row('fragment', 'missing')]).rows_read, undefined)
})
test('trees keep parent order, missing parents and cycles readable without recursion or dropped spans', () => {
  let tree = branches([
    row('child', 'root'),
    row('root'),
    row('fragment', 'lost'),
  ])
  equal(tree.map((n) => n.row.entity.eid), ['root', 'fragment'])
  equal(tree[0].children.map((n) => n.row.entity.eid), ['child'])
  ok(tree[1].orphan)
  equal(branches([row('a', 'b'), row('b', 'a')]).map((n) => n.row.entity.eid), [
    'a',
    'b',
  ])
})
test('ordinary comparisons require matching request and store context and recorded cheap roots', async () => {
  ok(ordinary([row('root'), row('child', 'root')]))
  ok(!ordinary([row('root', undefined, 10001)]))
  ok(!ordinary([row('root'), row('orphan', 'lost')]))
  let error = row('root')
  error.span = { ...error.span as object, outcome: 'error' }
  ok(!ordinary([error]))
  let missing = row('root')
  delete missing.rows_written
  ok(!ordinary([missing]))
  ok(sameKind(trace, { ...trace, entity: { eid: 'peer' } }))
  ok(!sameKind(trace, { ...trace, during: { space: 'elsewhere' } }))
  let g = graph({ vocab, storage: ram(vocab) })
  await g.apply([
    ...['space', 'store', 'app', 'different'].map((eid) => ({
      entity: { eid },
      doc: { title: eid },
    })),
    trace,
    { ...trace, entity: { eid: 'peer' } },
    {
      ...trace,
      entity: { eid: 'other' },
      during: { space: 'different' },
    },
    row('root'),
  ], { trusted: true })
  equal((await g.read(peers(trace))).map((b) => b.entity.eid).sort(), [
    'peer',
    'trace',
  ])
  equal((await g.read(spans(['trace']))).map((b) => b.entity.eid), ['root'])
})
test('portable span readings expose each metric and flamegraph bars jump to exact spans', () => {
  let io = {
    link: (id: string) => '/' + id,
    name: (id: string) => id,
    when: (s: string) => s,
  } as Io
  let r = row('child', 'root')
  let html = renderToString(render(views, r, 'Timing.Span', vocab, io)!)
  for (
    let s of [
      'select entity',
      '@yaks/sqlite',
      '10 rows read',
      '0 rows written',
      '1 statements',
      '2 ms',
      'start +1 ms',
    ]
  ) ok(html.includes(s), s)
  let flame = renderToString(
    h(Flamegraph, { rows: [row('root'), r], axis: 'rows_read' }),
  )
  ok(flame.includes('#span-child'))
  ok(flame.includes('inclusive rows read'))
  ok(flame.includes('Flamegraph by rows read'))
  ok(
    renderToString(
      h(Flamegraph, { rows: [row('root')], axis: 'rows_read', extent: 1000 }),
    ).includes('Axis: 0–1,000'),
  )
  let zero = row('root')
  zero.elapsed = { start: 0, ms: 0 }
  ok(
    renderToString(
      h(Flamegraph, {
        rows: [zero, {
          ...row('zero-child', 'root'),
          elapsed: { start: 10, ms: 0 },
        }],
        axis: 'elapsed',
      }),
    )
      .includes('No positive ms'),
  )
})
test('query-backed trace page asks for stored span entities', () => {
  equal(
    inspectViews.find((v) => v.view == 'Inspect.Page')!.asks!(
      trace,
      {} as Io,
      {},
    ),
    { spans: spans(['trace']) },
  )
})
