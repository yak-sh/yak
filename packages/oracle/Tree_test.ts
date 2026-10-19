// Query-backed oracle faces on a tiny scratch graph, mounted via the same
// inspector contract browse uses. No live graph or browser process is needed.
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { parseHTML } from 'linkedom'
import { equal, ok, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { define, resolve } from '@yaks/render'
import type { Answer, Asks, Bundle, Io } from '@yaks/inspect'
import { docs } from './vocab.ts'
import { branches, title } from './Tree.tsx'
import { inspectViews } from './views.ts'

let vocab = loadVocab([...docs, {
  $defs: {
    doc: { component: true, properties: { title: { type: 'string' } } },
    session: { component: true, properties: {} },
    created: { component: true, properties: { at: { type: 'string' } } },
    edge: {
      component: true,
      properties: {
        from: { type: 'string', ref: 'entity' },
        to: { type: 'string', ref: 'entity' },
        ord: { type: 'number' },
      },
    },
  },
}])
let store = ram(vocab)
let tree: Bundle = {
  entity: { eid: 'tree' },
  doc: { title: 'A tree' },
  oracle_tree: { root: 'root' },
}
let node = (eid: string, domain: string): Bundle => ({
  entity: { eid },
  session: { ended: true },
  oracle: {
    tree: 'tree',
    domain,
    self: 'Exact context.\n\n<keep these words> & spacing.',
    advert: {
      title: `${domain} oracle`,
      description: `Ask about ${domain}`,
    },
  },
})
let root = node('root', 'Everything'),
  first = node('first', 'Plants'),
  last = node('last', 'Weather')
let edge = (eid: string, from: string, to: string, ord: number): Bundle => ({
  entity: { eid },
  edge: { from, to, ord },
  oracle_child: {},
})
let edges = [
  edge('edge-last', 'last', 'root', 2),
  edge('edge-first', 'first', 'root', 1),
]
let dialogue: Bundle = {
  entity: { eid: 'dialogue' },
  session: {},
  oracle_dialogue: {
    tree: 'tree',
    from: 'root',
    to: 'first',
    revision: 3,
    turns: 4,
    finished: true,
  },
  created: { at: '2026-10-18T00:00:00Z' },
}
store.tx((tx) => tx.patch([tree, root, last, first, ...edges, dialogue]))
let registry = define(inspectViews())
let calls: string[] = []
let answers = (asks: Asks): Record<string, Answer> =>
  Object.fromEntries(
    Object.entries(asks).map(([key, ask]) => [key, {
      rows: typeof ask == 'string' && ask ? store.read(ask) : [],
      ready: true,
    }]),
  )
let io: Io = {
  vocab,
  ask: answers,
  get: (eid) => store.get([eid])[0],
  show: (b, view) => {
    calls.push(`${b.entity.eid} ${view}`)
    let r = resolve(registry, b, view, vocab)
    return r
      ? h(r.Render, {
        e: b,
        got: answers(r.asks?.(b, io, {}) ?? {}),
        io,
        ctx: {},
      })
      : null
  },
  can: (b, view) => !!resolve(registry, b, view, vocab),
  state: () => undefined,
  set: () => {},
  apply: () => {},
  edits: false,
  link: (eid) => `/${eid}`,
  find: () => '/',
  go: () => {},
  id: (b) => b.entity.eid,
  kind: () => 'entity',
  name: (eid) => eid,
  when: (at) => at,
}
let page = (b: Bundle, view: string) =>
  parseHTML(
    renderToString(h('main', {}, io.show(b, view))),
  ).document.querySelector('main')!
let treePage = page(tree, 'Tree'), nodePage = page(first, 'Oracle')
let rootPage = page(root, 'Oracle')
let treeCalls = [...calls]
let pending =
  parseHTML(renderToString(h(resolve(registry, tree, 'Tree', vocab)!.Render, {
    e: tree,
    io,
    ctx: {},
    got: {
      nodes: { rows: [], ready: false },
      edges: { rows: [], ready: false },
      dialogues: { rows: [], ready: false },
    },
  }))).document
let refused =
  parseHTML(renderToString(h(resolve(registry, tree, 'Tree', vocab)!.Render, {
    e: tree,
    io,
    ctx: {},
    got: {
      nodes: { rows: [], ready: true, error: 'Tree query refused' },
      edges: { rows: [], ready: true },
      dialogues: { rows: [], ready: true },
    },
  }))).document
store.tx((tx) =>
  tx.patch([{
    entity: first.entity,
    oracle: {
      advert: {
        title: 'Updated plant oracle',
        description: 'New advertisement',
      },
    },
  }])
)
let changed = page(tree, 'Tree')

// Prepare the rendered fixtures outside the assertion budget.
test('oracle tree follows child edge order and draws clickable domain advertisements', () => {
  let links = [...treePage.querySelectorAll('[aria-label="Oracle tree"] a')]
  equal(links.map((a) => a.getAttribute('href')), [
    '/root?v=Oracle',
    '/first?v=Oracle',
    '/last?v=Oracle',
  ])
  ok(links[1].textContent?.includes('Plants oracle'))
  ok(links[1].textContent?.includes('Ask about Plants'))
  equal(treePage.querySelectorAll('.Rows-nested').length, 1)
})
test('oracle nodes and conversations go through shared renderers and retain session links', () => {
  ok(treeCalls.includes('first Oracle.Tree.Tile'))
  ok(treeCalls.includes('dialogue Oracle.Dialogue.Tile'))
  let conversation = treePage.querySelector('[href="/dialogue"]')!
  ok(conversation.textContent?.includes('Everything oracle → Plants oracle'))
  ok(conversation.textContent?.includes('revision 3'))
  ok(conversation.textContent?.includes('4 turns'))
  equal(
    [...rootPage.querySelectorAll('[data-section="children"] a')].map((a) =>
      a.getAttribute('href')
    ),
    ['/first?v=Oracle', '/last?v=Oracle'],
  )
  ok(nodePage.querySelector('[href="/tree"]'))
  ok(nodePage.querySelector('[data-section="parent"] [href="/root?v=Oracle"]'))
  ok(
    nodePage.querySelector('[data-section="conversations"] [href="/dialogue"]'),
  )
})
test('oracle tree reads new advertisements without a separate tree store', () => {
  ok(
    changed.querySelector('[href="/first?v=Oracle"]')?.textContent?.includes(
      'Updated plant oracle',
    ),
  )
  ok(changed.textContent?.includes('New advertisement'))
})
test('oracle tree distinguishes loading and query refusals from emptiness', () => {
  ok(pending.querySelector('[role="status"]'))
  equal(
    pending.querySelector('.Section')?.textContent?.includes(
      'No nodes in this tree.',
    ),
    false,
  )
  ok(
    refused.querySelector('.Section')?.textContent?.includes(
      'Tree query refused',
    ),
  )
})
test('oracle tree renders disconnected nodes and cycles once', () => {
  let got = branches([root, first, last], [
    ...edges,
    edge('cycle', 'root', 'first', 0),
  ], 'root')
  equal(
    got.map((
      b,
    ) => [b.node.entity.eid, b.children.map((c) => c.node.entity.eid)]),
    [['root', ['first', 'last']]],
  )
  equal(
    branches([root, first, last], [], 'root').map((b) => b.node.entity.eid),
    ['root', 'first', 'last'],
  )
})

test('oracle view exposes its exact retained self context as text', () => {
  equal(
    nodePage.querySelector('[data-section="self-context"] .Value')?.textContent,
    'Exact context.\n\n<keep these words> & spacing.',
  )
})

let sparse: Bundle = { entity: first.entity, oracle: {}, session: {} }
let tileFaces = [
  'Tile',
  'List.Tile',
  'Feed.Tile',
  'Search.Tile',
  'Tray.List.Tile',
]
  .map((view) => page(sparse, view))
test('oracle tiles show their title and advertisement from projected metadata on every list surface', () => {
  for (let face of tileFaces) {
    equal(
      face.querySelector('.Tile_Line .Tile_Title')?.textContent,
      'Updated plant oracle',
    )
    equal(
      face.querySelector('.Tile_Text > .Tile_Sub')?.textContent,
      'New advertisement',
    )
  }
})

test('an oracle topic supplies its short title separately from its advertisement', () => {
  equal(
    title({
      entity: { eid: 'topic-oracle' },
      topic: { name: 'cars' },
      doc: { title: 'Cars' },
      oracle: {
        advert: {
          title:
            'Answers every possible question about the world of motor vehicles',
        },
      },
    }),
    'Cars',
  )
})
