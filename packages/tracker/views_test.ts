import { type Bundle } from '@yaks/render'
// Domain faces and queries are checked with graph bundles, not a fleet boot.
import { equal, ok, test } from '@yaks/testing'
import { renderToString } from 'preact-render-to-string'
import { h } from 'preact'
import { render as preact } from '@yaks/preact'
import { render as text } from '@yaks/text'
import type { Answer, Io } from '@yaks/inspect'
import { disclosureAt } from '@yaks/ux'
import { occurrences, openBugs, relatedTraces, views } from './views.ts'
import { inspectViews } from './inspect.ts'
import { fixture } from './fixture_test.ts'
import { runs } from './tools.ts'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { ram } from '@yaks/ram'
import { timingDoc } from '@yaks/timing/vocab'
import { trackerDoc } from './vocab.ts'
import { toolsDoc } from '@yaks/tools/vocab'

let vocab = loadVocab([kernelDoc, toolsDoc, trackerDoc, timingDoc], [
  kernelKeywords,
])
let ids: Record<string, string> = { bug: 'B-7', new: 'E-2', old: 'E-1' }
let held: Record<string, Bundle> = {
  proc: { entity: { eid: 'proc' }, doc: { title: 'yak serve' } },
  bug: { entity: { eid: 'bug' }, bug: {} },
}
let host = {
  id: (b: Bundle) => ids[b.entity.eid] ?? b.entity.eid,
  name: (eid: string) => `named ${eid}`,
  link: (eid: string) => `/${ids[eid] ?? eid}`,
  when: (at: string) => `at ${at}`,
  get: (eid: string) => held[eid],
  show: (b: Bundle, view: string) => `[${view} ${b.entity.eid}]`,
}
// A face drawn by the portable registry, in a terminal's words and as markup
// with its tags left out (a title attribute is not read).
let faces = (b: Bundle, view: string) => [
  text(views, b, view, vocab, host, 'plain'),
  renderToString(preact(views, b, view, vocab, host)!).replace(/<[^>]*>/g, ''),
]
// An inspector page, drawn with answers to its asks and its state closed
// unless `open` names it.
let page = (b: Bundle, answers: Record<string, Bundle[]>, open = '') => {
  let view = inspectViews.find((v) =>
    v.view == 'Full' && v.match && b[
      v == inspectViews[0] ? 'bug' : 'error'
    ]
  )!
  let answer = (rows: Bundle[] = []): Answer => ({ rows, ready: true })
  let io = {
    ...host,
    vocab,
    find: (q: string) => `/?q=${q}`,
    kind: () => 'entity',
    edits: false,
    go: () => {},
    apply: () => {},
    can: () => true,
    ask: (asks: Record<string, unknown>) =>
      Object.fromEntries(Object.keys(asks).map((k) => [k, answer()])),
    state: (eid: string) =>
      eid == disclosureAt(open)
        ? { entity: { eid }, Disclosure: { open: true } }
        : undefined,
    set: () => {},
  } as unknown as Io
  let got = Object.fromEntries(
    Object.keys(view.asks?.(b, io, {}) ?? {}).map((
      k,
    ) => [k, answer(answers[k])]),
  )
  return renderToString(h(view.Render, { e: b, io, got, ctx: {} }))
    .replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ')
}

let message =
  'TypeError: error sending request for url (http://127.0.0.1:5173/query?q=.entity.eid%3D99): refused (request 8340c228-dc11-464e-a9fe-1655ef354a15)\n    at fetch (ext:deno_fetch/26_fetch.js:103:11)'
let headline =
  'TypeError: error sending request for url (http://127.0.0.1:5173/query?…): refused (request 8340c228…)'
let bug: Bundle = {
  entity: { eid: 'bug', num: 7 },
  doc: { title: message },
  bug: {
    fault: 'call|typeerror: error sending request',
    hits: 338,
    people: 2,
    spot: 'file:///home/yaks/code/tasks/packages/code/source.ts:56 Object.get',
    first: '2026-10-01T00:00:00Z',
    last: '2026-10-03T00:00:00Z',
  },
}
let frames = [
  { file: 'ext:deno_fetch/26_fetch.js', line: 103, column: 11 },
  {
    file: 'file:///home/yaks/code/tasks/packages/tracker/group.ts',
    line: 42,
    column: 3,
    function: 'group',
    app: true,
  },
]
let sha = '9917d09d30a68730b83661652bdcaecc38670809'
let occurrence = (n: number, over: Record<string, unknown> = {}): Bundle => ({
  entity: { eid: `e${n}` },
  error: {
    at: `2026-10-0${1 + (n % 3)}T12:34:5${n % 10}Z`,
    bug: 'bug',
    message,
    commit: n < 2 ? 'a'.repeat(40) : sha,
    environment: ['live', 'live', 'live', 'dev', 'ci', 'test'][n % 6],
    tags: { handler: 'mcp' },
  },
  during: { process: `p${n}` },
  exception: { type: 'TypeError', value: message.slice(11), frames },
  ...over,
})

test('a bug reads as its headline wherever it is named, its whole message on its page', () => {
  for (let tile of faces(bug, 'List.Tile')) {
    for (
      let part of [
        'B-7',
        headline,
        '338 hits',
        'packages/code/source.ts:56',
        'last at 2026-10-03',
        'since at 2026-10-01',
      ]
    ) ok(tile.includes(part), part)
    ok(!tile.includes('8340c228-dc11'))
  }
  for (let bar of faces(bug, 'Card.Title')) {
    ok(bar.includes('B-7') && bar.includes(headline))
  }
  for (let whole of faces(bug, 'Page')) {
    ok(whole.includes(message.split('\n')[0]))
  }
})

test("an occurrence among its bug's others reads its moment, short commit and tags, naming only what the host holds", () => {
  let e = occurrence(4, { during: { process: 'proc', entity: 'store' } })
  for (let row of faces(e, 'Bug.List.Tile')) {
    for (let part of [':34:54', '9917d09', 'handler mcp', '[Title proc]']) {
      ok(row.includes(part), part)
    }
    ok(!row.includes('9917d09d'))
    ok(!row.includes('store'))
  }
})

test('a bug page says how often and since when, where it ran in brief, and its newest stack', () => {
  let errors = [0, 1, 2, 3, 4, 5].map((n) => occurrence(n))
  let html = page(bug, { errors })
  for (
    let part of [
      headline.replace('TypeError: ', ''),
      'TypeError',
      '6 kept of 338',
      'a bar is',
      'first seen in aaaaaaa',
      '6 different',
      'live ×3',
      '1 more',
      'packages/tracker/group.ts:42:3',
      'Grouping key',
    ]
  ) ok(html.includes(part), part)
  // What a press opens is not drawn until pressed.
  ok(!html.includes('call|typeerror'))
  ok(page(bug, { errors }, 'bug|fault').includes('call|typeerror'))
})

test('an occurrence page says where it ran and what happened before it, and lists traces when the store has them', () => {
  let e = occurrence(4, {
    breadcrumbs: {
      items: [{ at: '2026-10-03', category: 'fetch', message: 'GET /query' }],
    },
  })
  let html = page(e, { traces: [{ entity: { eid: 'trace' } }] })
  for (
    let part of [
      'one occurrence of B-7',
      '9917d09',
      'packages/tracker/group.ts:42:3',
      'GET /query',
      '[List.Tile trace]',
    ]
  ) ok(html.includes(part), part)
  let asks = (vocab: unknown) =>
    inspectViews[1].asks!(e, { vocab } as never, {}).traces
  ok(asks(vocab))
  equal(asks(fixture().vocab), undefined)
})

test('open list and tools take worst first, and bug errors newest first', async () => {
  let g = fixture()
  await g.apply([
    { entity: { eid: 'small' }, bug: { hits: 1 }, doc: { title: 'small' } },
    { entity: { eid: 'worst' }, bug: { hits: 20 }, doc: { title: 'worst' } },
    { entity: { eid: 'resolved' }, bug: { hits: 50 }, resolved: {} },
    { entity: { eid: 'archived' }, bug: { hits: 100 }, archived: {} },
    { entity: { eid: 'old' }, error: { bug: 'worst', at: '2026-10-01' } },
    { entity: { eid: 'new' }, error: { bug: 'worst', at: '2026-10-03' } },
  ], { trusted: true })
  equal((await g.read(openBugs)).map((b) => b.entity.eid), ['worst', 'small'])
  equal((await g.read(occurrences('worst'))).map((b) => b.entity.eid), [
    'new',
    'old',
  ])
  equal(
    (await runs().bug_list({ entity: { eid: 'call' } }, g)).map((b) =>
      b.entity.eid
    ),
    ['worst', 'small'],
  )
  equal(
    (await runs().bug_show({
      entity: { eid: 'call' },
      call: { args: { bug: 'worst' } },
    }, g)).map((b) => b.entity.eid),
    ['worst', 'new', 'old'],
  )
})

test('occurrence traces use request identity or bounded shared context, never arbitrary neighbours', async () => {
  let vocab = loadVocab([kernelDoc, toolsDoc, trackerDoc, timingDoc], [
    kernelKeywords,
  ])
  let g = graph({ vocab, storage: ram(vocab) })
  let error: Bundle = {
    entity: { eid: 'error' },
    error: { at: '2026-10-06T12:00:00Z' },
    during: { request: 'request', entity: 'store', space: 'space' },
  }
  let trace = (
    eid: string,
    during: Record<string, string>,
    at = '2026-10-06T12:00:00Z',
  ): Bundle => ({
    entity: { eid },
    trace: { at, op: 'request', name: 'read' },
    during,
  })
  await g.apply(
    ['request', 'store', 'space', 'other', 'another', 'process'].map((eid) => ({
      entity: { eid },
      during: {},
    })),
    { trusted: true },
  )
  await g.apply([
    trace('same-request', {
      request: 'request',
      entity: 'store',
      space: 'space',
    }),
    trace('nearby', { request: 'other', entity: 'store', space: 'space' }),
    trace('other-space', { entity: 'store', space: 'another' }),
    trace(
      'too-old',
      { entity: 'store', space: 'space' },
      '2026-10-06T11:54:59Z',
    ),
    trace('wrong-store', { entity: 'another', space: 'space' }),
  ], { trusted: true })
  let exact = relatedTraces(error)!
  equal((await g.read(exact.query)).map((b) => b.entity.eid), ['same-request'])
  let contextual = relatedTraces({
    ...error,
    during: { entity: 'store', space: 'space' },
  })!
  equal(
    new Set((await g.read(contextual.query)).map((b) => b.entity.eid)),
    new Set(['same-request', 'nearby']),
  )
  ok(contextual.label.includes('rather than causal'))
  equal(
    relatedTraces({
      entity: { eid: 'empty' },
      error: { at: '2026-10-06T12:00:00Z' },
    }),
    undefined,
  )
  let process = relatedTraces({
    entity: { eid: 'process-error' },
    during: { process: 'process' },
    error: { at: '2026-10-06T12:00:00Z' },
  })!
  await g.apply([trace('same-process', { process: 'process' })], {
    trusted: true,
  })
  equal((await g.read(process.query)).map((b) => b.entity.eid), [
    'same-process',
  ])
})
