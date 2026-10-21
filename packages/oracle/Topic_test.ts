// Shared topic views show owned context bytes and direct typed neighbors,
// while history and conversations retain their ordinary entity links.
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { parseHTML } from 'linkedom'
import { equal, ok, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { define, resolve } from '@yaks/render'
import { edgeDoc, edgeKeywords, link } from '@yaks/edge'
import { memoryDoc } from '@yaks/memory/vocab'
import { topicDoc } from '@yaks/topic/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel/vocab'
import { provenanceDoc } from '@yaks/provenance'
import { contextDoc } from '@yaks/context'
import { docDoc } from '@yaks/doc/vocab'
import { sessionDoc } from '@yaks/session'
import { toolsDoc } from '@yaks/tools/vocab'
import type { Answer, Asks, Bundle, Io } from '@yaks/inspect'
import { oracleDoc } from './vocab.ts'
import { inspectViews } from './views.ts'

let vocab = loadVocab([
  toolsDoc,
  memoryDoc,
  topicDoc,
  kernelDoc,
  provenanceDoc,
  contextDoc,
  docDoc,
  sessionDoc,
  edgeDoc,
  oracleDoc,
], [kernelKeywords, edgeKeywords])
let store = ram(vocab)
let topic = (eid: string, title: string): Bundle => ({
  entity: { eid },
  topic: { name: title.toLowerCase() },
  doc: { title, body: `Advertisement for ${title}.` },
  topic_context: {},
})
let root = topic('root', 'Oracles'), incoming = topic('incoming', 'Vehicles')
let outgoing = topic('outgoing', 'Owner manuals')
let bodies = {
  parent: '  Parent-facing text.\n\n<exact bytes> & spacing.  ',
  self: 'Only this topic owns this self text.\n  Its indentation stays.',
  children: 'Children-facing text; distinct from private and parent text.',
}
let heads = Object.entries(bodies).map(([slot, body]) => ({
  entity: { eid: `${slot}-head` },
  content: { body },
  prompt: { source: 'root', revision: `${slot}-revision` },
  created: { at: '2026-10-19T12:00:00Z' },
}))
root.topic_context = Object.fromEntries(
  Object.keys(bodies).map((slot) => [slot, `${slot}-head`]),
)
let rows = [
  root,
  incoming,
  outgoing,
  ...heads,
  link('incoming', 'reads', 'root'),
  link('root', 'cites', 'outgoing'),
  {
    entity: { eid: 'conversation' },
    session: {},
    native: {},
    oracle_dialogue: { from: 'incoming', to: 'root', revision: 1 },
  },
]
store.tx((tx) => tx.patch(rows))
let registry = define(inspectViews())
let calls: string[] = [], queries: string[] = []
let answers = (asks: Asks): Record<string, Answer> =>
  Object.fromEntries(
    Object.entries(asks).map(([key, ask]) => {
      let q = typeof ask == 'string' ? ask : ask.query
      queries.push(q)
      return [key, { rows: store.read(q), ready: true }]
    }),
  )
let io: Io = {
  vocab,
  ask: answers,
  get: (id) => store.get([id])[0],
  show: (e, view) => {
    calls.push(`${e.entity.eid} ${view}`)
    let r = resolve(registry, e, view, vocab)
    return r
      ? h(r.Render, { e, got: answers(r.asks?.(e, io, {}) ?? {}), io, ctx: {} })
      : null
  },
  can: (e, view) => !!resolve(registry, e, view, vocab),
  state: () => undefined,
  set: () => {},
  apply: () => {},
  edits: false,
  link: (id) => `/${id}`,
  find: (q) => `/find?q=${encodeURIComponent(q)}`,
  go: () => {},
  id: (e) => e.entity.eid,
  kind: () => 'entity',
  name: (id) => id,
  when: (at) => at,
}
let page = (e: Bundle, view = 'Oracle') =>
  parseHTML(
    renderToString(h('main', {}, io.show(e, view))),
  ).document.querySelector('main')!
let shown = page(root)
let sparse = page(
  { entity: root.entity, topic: {}, topic_context: {} },
  'List.Tile',
)
let empty = page(outgoing)
let versions = [...shown.querySelectorAll('a[title$="-revision"]')].map((a) =>
  a.getAttribute('href')
)

test('topic oracle view keeps title, advertisement and exact directional context separate', () => {
  equal(shown.querySelector('.Head_Title')?.textContent, 'Oracles')
  equal(
    shown.querySelector('[data-section="advertisement"] .Value')?.textContent,
    'Advertisement for Oracles.',
  )
  for (let [slot, body] of Object.entries(bodies)) {
    equal(
      shown.querySelector(`[data-section="${slot}-context"] .Value`)
        ?.textContent,
      body,
    )
  }
  equal(versions, ['/parent-head', '/self-head', '/children-head'])
})
test('topic context view shares typed neighboring topic faces and native conversation links', () => {
  ok(calls.includes('incoming List.Tile'))
  ok(calls.includes('outgoing List.Tile'))
  ok(calls.includes('conversation Oracle.Dialogue.Tile'))
  ok(
    shown.querySelector('[data-section="incoming-topics"]')?.textContent
      ?.includes('reads'),
  )
  ok(
    shown.querySelector('[data-section="outgoing-topics"]')?.textContent
      ?.includes('cites'),
  )
  ok(
    shown.querySelector(
      '[data-section="conversations"] [href="/conversation"]',
    ),
  )
})
test('topic list faces fetch topic identity and advertisement while empty context stays explicit', () => {
  equal(sparse.querySelector('.Tile_Title')?.textContent, 'Oracles')
  equal(
    sparse.querySelector('.Tile_Text > .Tile_Sub')?.textContent,
    'Advertisement for Oracles.',
  )
  ok(
    empty.querySelector('[data-section="self-context"]')?.textContent?.includes(
      'No stored self context.',
    ),
  )
  ok(
    queries.some((q) =>
      q.includes('parent-head,self-head,children-head') &&
      q.includes('.fields=content.body')
    ),
  )
  equal(queries.some((q) => q.includes('.entry.session')), false)
})
