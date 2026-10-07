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
  differences,
  merge,
  ordinary,
  peers,
  said,
  sameKind,
  spans,
  totals,
  walk,
} from './readings.ts'
import { inspectViews } from './inspect.ts'
import { views } from './views.ts'
import { render as preact } from '@yaks/preact'
import { render as text } from '@yaks/text'
import { renderToString } from 'preact-render-to-string'
import { h } from 'preact'
import type { Answer, Bundle, Io } from '@yaks/inspect'
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
    repeats: undefined,
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
// A span of `trace` under `parent`, measuring `n` rows read in `ms`.
let at = (
  eid: string,
  parent: string | undefined,
  [op, name]: string[],
  n: number,
  ms = 1,
  of = 'trace',
): Bundle => ({
  entity: { eid },
  span: {
    trace: of,
    parent,
    op,
    name,
    plugin: op == 'rule' ? '@yaks/task' : undefined,
  },
  rows_read: { n },
  rows_written: { n: 0 },
  statements: { n: 1 },
  elapsed: { start: 0, ms },
})
let request = ['request', 'POST apply'], rule = ['rule', 'task_ready']
let read = ['query', 'read']
// A request whose rule read three times what an ordinary one's read once.
let mine = [
  at('root', undefined, request, 903),
  at('rule', 'root', rule, 902, 0.7),
  ...[1, 2, 3].map((i) => at(`q${i}`, 'rule', read, 300, 0.1)),
  at('stamp', 'root', ['phase', 'stamp'], 0),
]
let theirs = (n = 101) => [
  at('r0', undefined, request, n, 1, 'peer'),
  at('r1', 'r0', rule, 100, 0.5, 'peer'),
  at('r2', 'r1', read, 100, 0.1, 'peer'),
]
let peer: Bundle = { ...trace, entity: { eid: 'peer' } }

test('siblings that ran the same code read as one place, and two traces line up place by place', () => {
  let roots = merge(branches(mine))
  equal(
    walk(roots).map((w) => [said(w.node), w.node.spans.length, w.depth]),
    [
      ['request POST apply', 1, 0],
      ['rule task_ready', 1, 1],
      ['query read', 3, 2],
      ['phase stamp', 1, 1],
    ],
  )
  let them = merge(branches(theirs()))
  equal(
    differences(roots, them, 'rows_read').map((d) => [said(d.node), d.by]),
    [['query read', 800], ['rule task_ready', 2]],
  )
  // The rule's own time is the same in both, but for a clock's last bits.
  equal(
    differences(roots, them, 'elapsed').map((d) => said(d.node)),
    ['phase stamp', 'request POST apply', 'query read'],
  )
})

// An inspector view drawn with the answer to each query line it asks, and
// the page state `held` keeps.
let draw = (
  view: string,
  e: Bundle,
  lines: Record<string, Bundle[]>,
  ctx: Record<string, unknown> = {},
  held: Record<string, Bundle> | ((eid: string) => Bundle | undefined) = {},
) => {
  let answer = (line: unknown): Answer => ({
    rows: lines[String(line)] ?? [],
    count: lines[String(line)]?.length,
    ready: true,
  })
  let answers = (asks: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(asks).map(([k, l]) => [k, answer(l)]))
  let io = {
    vocab,
    link: (eid: string) => `/${eid}`,
    find: (q: string) => `/?q=${q}`,
    id: (b: Bundle) => b.entity.eid.toUpperCase(),
    name: (eid: string) => eid,
    when: (s: string) => `at ${s}`,
    get: () => undefined,
    show: () => null,
    can: () => true,
    ask: answers,
    state: (eid: string) => typeof held == 'function' ? held(eid) : held[eid],
    set: () => {},
  } as unknown as Io
  let v = inspectViews.find((r) =>
    r.view == view && (view == 'Inspect.Query' || r.match && e.trace)
  )!
  return renderToString(
    h(v.Render, { e, io, got: answers(v.asks?.(e, io, ctx) ?? {}), ctx }),
  ).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
}
let lines = (peerRows = theirs()) => ({
  [spans(['trace'])]: mine,
  [peers(trace)]: [trace, peer],
  [`${spans(['peer'])} !span.parent`]: peerRows.slice(0, 1),
  [spans(['peer'])]: peerRows,
})

test('a trace page says where its rows went, beside an ordinary trace of its kind', () => {
  let page = draw('Full', trace, lines())
  for (
    let part of [
      'Where the rows read went',
      'query read ×3: 900 rows read',
      'Beside an ordinary POST apply',
      'PEER',
      '903 rows read; the ordinary one: 101 rows read, 8.9× as many',
      'query read ×3 900 100 +800',
      '1 more place recorded no rows read',
    ]
  ) ok(page.includes(part), part)
  ok(
    draw('Full', trace, lines(theirs(20_000))).includes(
      'No ordinary POST apply',
    ),
  )
  let timed = draw('Full', trace, lines(), {}, {
    'timing-axis:trace': {
      entity: { eid: 'timing-axis:trace' },
      table: { order: 'elapsed' },
    },
  })
  ok(timed.includes('Where the time went'))
})

test('the trace list puts each kind of request together, the most work first', () => {
  let query = '.trace'
  let list = draw('Inspect.Query', { entity: { eid: 'q' } }, {
    [`${query} * .order=-trace.at .limit=200`]: [peer, trace],
    [`${spans(['peer', 'trace'])} !span.parent`]: [theirs()[0], mine[0]],
  }, { query })
  ok(list.includes('POST apply request 2 traces'))
  ok(list.indexOf('903') < list.indexOf('101'))
})

// A bundle drawn as `view` in a terminal and in a browser.
let host = {
  id: (b: Bundle) => b.entity.eid.toUpperCase(),
  link: (eid: string) => `/${eid}`,
  when: (s: string) => `at ${s}`,
  get: (eid: string) => eid == 'trace' ? trace : undefined,
}
let faces = (b: Bundle, view: string) => [
  text(views, b, view, vocab, host, 'plain'),
  renderToString(preact(views, b, view, vocab, host)!),
]

test('a span and a trace read the same in a terminal and a browser', () => {
  for (let face of faces(mine[1], 'List.Tile')) {
    for (
      let part of [
        'rule',
        'task_ready',
        '@yaks/task',
        '902 rows read',
        '0.7 ms',
      ]
    ) {
      ok(face.includes(part), part)
    }
  }
  for (let face of faces(trace, 'List.Tile')) {
    for (let part of ['TRACE', 'POST apply', 'request', 'at 2026-10-06']) {
      ok(face.includes(part), part)
    }
  }
  for (let face of faces(mine[1], 'Page')) {
    ok(face.includes('Part of') && face.includes('TRACE POST apply'))
  }
})

test("a span's page and a place opened on a trace's page say which statements ran", () => {
  let sql = 'select title from book where id = ?'
  let reads = mine.map((b) =>
    b.entity.eid.startsWith('q')
      ? {
        ...b,
        statements: {
          n: 1,
          ran: [{ sql, n: 1, rows_read: 300, rows_written: 0, ms: 0.1 }],
        },
      }
      : b
  )
  for (let face of faces(reads[2], 'Full')) {
    for (let part of ['Statements', sql, '300', '0.1']) {
      ok(face.includes(part), part)
    }
  }
  let rows = { ...lines(), [spans(['trace'])]: reads }
  ok(!draw('Full', trace, rows).includes(sql))
  let open = (eid: string) => ({ entity: { eid }, Disclosure: { open: true } })
  let page = draw('Full', trace, rows, {}, open)
  for (
    let part of [
      `query read ×3 900 statement × rows read rows written ms ${sql} 3 900 0 0.3`,
      'Its 3 spans, the most rows read first: Q1 · Q2 · Q3',
    ]
  ) ok(page.includes(part), part)
})
