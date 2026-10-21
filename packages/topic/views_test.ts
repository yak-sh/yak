// A topic's page and tree over a small graph, mounted through the inspector
// contract browse uses: cover, contents, what it holds and cites, where it
// sits, the beliefs about it, and the tree with its cycle cut.
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { parseHTML } from 'linkedom'
import { equal, ok, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { and } from '@yaks/query'
import { define, resolve } from '@yaks/render'
import { edgeDoc, edgeKeywords, link } from '@yaks/edge'
import { kernelDoc, kernelKeywords } from '@yaks/kernel/vocab'
import { provenanceDoc } from '@yaks/provenance'
import { docDoc } from '@yaks/doc/vocab'
import { taskDoc } from '@yaks/task/vocab'
import { projectDoc } from '@yaks/project/vocab'
import { toolsDoc } from '@yaks/tools/vocab'
import { memoryDoc } from '@yaks/memory/vocab'
import { disclosed, disclosureAt } from '@yaks/ux'
import {
  all,
  type Answer,
  type Asks,
  type Bundle,
  type Io,
  type View,
} from '@yaks/inspect'
import { topicDoc } from './vocab.ts'
import { inspectViews } from './inspect.ts'

let vocab = loadVocab([
  kernelDoc,
  provenanceDoc,
  edgeDoc,
  docDoc,
  taskDoc,
  projectDoc,
  toolsDoc,
  memoryDoc,
  topicDoc,
], [kernelKeywords, edgeKeywords])
let store = ram(vocab)

let topic = (
  eid: string,
  title: string,
  more: Bundle = { entity: { eid } },
) => ({
  ...more,
  entity: { eid },
  topic: { name: title.toLowerCase() },
  doc: { title, body: `What belongs under ${title}.` },
})
let doc = (eid: string, title: string): Bundle => ({
  entity: { eid },
  doc: { title },
})
let belief = (eid: string, said: string, archived = false): Bundle => ({
  entity: { eid },
  belief: { about: 'data' },
  doc: { title: said, body: said },
  ...archived ? { archived: {} } : {},
})
store.tx((tx) =>
  tx.patch([
    { entity: { eid: 'fleet' }, project: {}, doc: { title: 'Fleet' } },
    topic('data', 'Data', {
      entity: { eid: 'data' },
      content: { body: 'An entity is its **id**.' },
    }),
    topic('model', 'Model'),
    topic('ids', 'Ids'),
    topic('naming', 'Naming'),
    topic('world', 'World'),
    { ...topic('scoped', 'Scoped'), topic: { name: 'scoped', scope: 'fleet' } },
    doc('guide', 'The guide'),
    doc('spec', 'The spec'),
    doc('said', 'what Jeff said'),
    link('world', 'contains', 'data'),
    link('data', 'contains', 'model', 1),
    link('data', 'contains', 'fleet', 2),
    link('model', 'contains', 'ids'),
    link('ids', 'contains', 'data'),
    link('fleet', 'contains', 'spec'),
    link('data', 'requires', 'naming'),
    link('data', 'reads', 'guide'),
    link('data', 'references', 'spec'),
    link('data', 'cites', 'said'),
    belief('live', 'Ids are UUIDs.'),
    belief('old', 'Ids were names.', true),
  ])
)

let asked = (q: string): Answer =>
  q.endsWith('&.count')
    ? { rows: [], count: store.read(q.slice(0, -7)).length, ready: true }
    : { rows: store.read(q), ready: true }
// The host's own face for anything a topic holds that has none of its own.
let title = (e?: Bundle) => String((e?.doc as { title?: string })?.title ?? '')
let tile: View = {
  view: 'Tile',
  match: and(),
  Render: ({ e }) => h('span', { 'data-tile': e.entity.eid }, title(e)),
}
let registry = define<View>([...inspectViews, ...all, tile])

let host = (state: Bundle[] = [], ready = true): Io => {
  let answers = (asks: Asks) =>
    Object.fromEntries(
      Object.entries(asks).map(([key, ask]) => [
        key,
        ready
          ? asked(typeof ask == 'string' ? ask : ask.query)
          : { rows: [], ready: false },
      ]),
    )
  let io: Io = {
    vocab,
    ask: answers,
    get: (id) => store.get([id])[0],
    show: (e, view, ctx = {}) => {
      let r = resolve(registry, e, view, vocab)
      return r
        ? h(r.Render, { e, got: answers(r.asks?.(e, io, ctx) ?? {}), io, ctx })
        : null
    },
    can: (e, view) => !!resolve(registry, e, view, vocab),
    state: (eid) => state.find((b) => b.entity.eid == eid),
    set: () => {},
    apply: () => {},
    edits: false,
    link: (id) => `/${id}`,
    find: (q) => `/find?q=${encodeURIComponent(q)}`,
    go: () => {},
    id: (e) => e.entity.eid,
    kind: () => 'topic',
    name: (id) => title(store.get([id])[0]) || id,
    when: (at) => at,
  }
  return io
}
let drawn = (eid: string, view: string, io = host()) =>
  parseHTML(
    renderToString(h('main', {}, io.show(store.get([eid])[0], view))),
  ).document.querySelector('main')!
let part = (page: Element, heading: string) =>
  page.querySelector(`[data-section="${heading}"]`)
let held = (page: Element, heading: string) =>
  [...part(page, heading)?.querySelectorAll('[data-held]') ?? []]
    .map((n) => n.getAttribute('data-held'))
let text = (page: Element, heading: string) =>
  part(page, heading)?.textContent ?? ''

let opened = disclosed({
  entity: { eid: disclosureAt('data/archived beliefs') },
}, true)
let data = drawn('data', 'Topic')
let open = drawn('data', 'Topic', host([opened]))
let scoped = drawn('scoped', 'Inspect.Page')
let waiting = drawn('naming', 'Topic', host([], false))
let tree = drawn('data', 'Tree')
let naming = drawn('naming', 'Topic')
let bare = drawn('naming', 'Tree')

test('a topic reads cover first, then its contents', () => {
  equal(data.querySelector('.Head_Title')?.firstChild?.textContent, 'Data')
  ok(
    data.querySelector('[data-cover]')?.textContent?.includes(
      'What belongs under Data.',
    ),
  )
  equal(part(data, 'Contents')?.querySelector('strong')?.textContent, 'id')
  ok(text(naming, 'Contents').includes('nothing is written'))
})

test('what it holds, needs, relates to and cites, each by its own face', () => {
  equal(held(data, 'Contains'), ['model', 'fleet'])
  ok(part(data, 'Contains')?.querySelector('[data-topic="model"]'))
  ok(part(data, 'Contains')?.querySelector('[data-tile="fleet"]'))
  equal(held(data, 'Understand first'), ['naming'])
  equal(held(data, 'Related').toSorted(), ['guide', 'spec'])
  ok(text(data, 'Related').includes('references'))
  equal(held(data, 'Sources'), ['said'])
  equal(part(data, 'Links'), null)
})

test('the head says what holds it and where it holds', () => {
  let sub = data.querySelector('.Head_Sub')?.textContent ?? ''
  ok(sub.startsWith('in Ids, World · '), sub)
  ok(sub.includes('holds everywhere'), sub)
  ok(
    scoped.querySelector('.Head_Sub')?.textContent?.includes('holds for Fleet'),
  )
})

test('live beliefs list; archived ones wait behind a press, muted', () => {
  ok(text(data, 'Beliefs').includes('Ids are UUIDs.'))
  ok(!text(data, 'Beliefs').includes('Ids were names.'))
  ok(text(data, 'Beliefs').includes('1 archived'))
  ok(part(open, 'Beliefs')?.querySelector('.Rows-quiet [data-tile="old"]'))
  ok(text(naming, 'Beliefs').includes('nothing is believed'))
  ok(part(waiting, 'Beliefs')?.querySelector('[role="status"]'))
})

test('the tree nests subtopics, leaves the rest as leaves, and ends a cycle', () => {
  let at = (eid: string) => tree.querySelectorAll(`[data-held="${eid}"]`).length
  equal([at('model'), at('ids'), at('fleet'), at('data')], [1, 1, 1, 1])
  equal(at('spec'), 0)
  ok(tree.querySelector('[data-held="model"] .Rows-nested [data-held="ids"]'))
  ok(bare.textContent?.includes('it holds nothing yet'))
})
