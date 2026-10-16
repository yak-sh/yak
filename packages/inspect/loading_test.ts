import { type ComponentChildren, h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { parseHTML } from 'linkedom'
import { equal, ok, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import type { Answer, Bundle, Io } from './host.ts'
import { waiting } from './rows.ts'
import { QueryPage } from './Query.ts'
import { CompPage } from './Comp.ts'
import { PackagePage } from './Package.ts'
import { TaskPage } from '../task/inspect.ts'
import { Conversation, SessionPage } from '../session/inspect.ts'
import { BeliefPage, TopicPage } from '../memory/inspect.ts'

let vocab = loadVocab([{
  package: '@test/loading',
  $defs: {
    task: { component: true, properties: {} },
    doc: { component: true, properties: { title: { type: 'string' } } },
  },
}])
let item: Bundle = {
  entity: { eid: 'item' },
  doc: { title: 'Existing result' },
}
let io = (answers: Record<string, Partial<Answer>> = {}): Io => ({
  vocab,
  ask: (asks) =>
    Object.fromEntries(
      Object.keys(asks).map((key) => [
        key,
        { rows: [], ready: true, ...answers[key] },
      ]),
    ),
  get: () => undefined,
  state: () => undefined,
  set: () => {},
  apply: () => {},
  show: (b) => String((b.doc as { title?: string })?.title ?? b.entity.eid),
  can: () => false,
  edits: false,
  link: (eid) => `/${eid}`,
  find: (q) => `/?q=${encodeURIComponent(q)}`,
  go: () => {},
  id: (b) => b.entity.eid,
  kind: () => 'entity',
  name: (eid) => eid,
  when: (at) => at,
})
let page = (node: ComponentChildren) =>
  parseHTML(renderToString(h('main', {}, node))).document.querySelector('main')!
let section = (node: ComponentChildren, name: string) =>
  page(node).querySelector(`[data-section="${name}"]`)!
let props = (host: Io, e: Bundle = item) => ({ io: host, e, got: {}, ctx: {} })
let loading = (node: ComponentChildren) =>
  !!page(node).querySelector('[role="status"]')

// Render fixtures before the case: the assertions check the visible states,
// without spending their budgets constructing the vocabulary or the page.
let pendingRows = page(waiting({ rows: [], ready: false }))
let emptyTally = page(
  h(QueryPage, {
    io: io({ answer: { ready: false, tally: {} } }),
    text: '.task&.tally=doc.title',
  }),
)
let answeredTally = page(
  h(QueryPage, {
    io: io({ answer: { tally: {} } }),
    text: '.task&.tally=doc.title',
  }),
)
let pendingQuery = page(
  h(QueryPage, { io: io({ rows: { ready: false } }), text: '.task' }),
)
let answeredQuery = page(h(QueryPage, { io: io(), text: '.task' }))
let refreshQuery = page(
  h(QueryPage, {
    io: io({ rows: { ready: false, rows: [item] } }),
    text: '.task',
  }),
)

test('inspector query answers distinguish pending rows and empty aggregates from answered emptiness', () => {
  ok(pendingRows.querySelector('[role="status"]'))
  ok(emptyTally.querySelector('[role="status"]'))
  equal(answeredTally.querySelector('[role="status"]'), null)
  ok(pendingQuery.querySelector('[role="status"]'))
  equal(pendingQuery.textContent?.includes('none'), false)
  ok(answeredQuery.textContent?.includes('none'))
  ok(refreshQuery.textContent?.includes('Existing result'))
  equal(refreshQuery.querySelector('[role="status"]'), null)
})

let schema = { entity: { eid: 'component' }, _comp: { name: 'task' } }
let linksPending = section(
  h(
    CompPage,
    props(
      io({ sets: { ready: false }, tally: { ready: false, tally: {} } }),
      schema,
    ),
  ),
  'Refers to',
)
let extensionPending = section(
  h(
    PackagePage,
    props(io({ comps: { ready: false } }), {
      entity: { eid: 'package' },
      _package: { name: '@test/loading' },
    }),
  ),
  'Extends',
)

test('dependent schema tables wait for all their answers before saying none', () => {
  ok(linksPending.querySelector('[role="status"]'))
  equal(linksPending.textContent?.includes('none'), false)
  ok(extensionPending.querySelector('[role="status"]'))
})

let taskPending = section(
  h(TaskPage, props(io({ comments: { ready: false } }))),
  'Comments',
)
let taskRefresh = section(
  h(TaskPage, props(io({ comments: { ready: false, rows: [item] } }))),
  'Comments',
)
let sessionPending = section(
  h(SessionPage, props(io({ turns: { ready: false } }))),
  'Latest turns',
)
let sessionEmpty = section(h(SessionPage, props(io())), 'Latest turns')
let sessionRefresh = section(
  h(SessionPage, props(io({ turns: { ready: false, rows: [item] } }))),
  'Latest turns',
)
let conversationPending = loading(
  h(
    Conversation,
    props(io({ before: { ready: false }, after: { ready: false } }), {
      ...item,
      entry: { session: 'session', seq: 2 },
    }),
  ),
)
let topicPending = section(
  h(TopicPage, props(io({ beliefs: { ready: false } }))),
  'Beliefs',
)
let topicEmpty = section(h(TopicPage, props(io())), 'Beliefs')
let beliefPending = section(
  h(BeliefPage, props(io({ cites: { ready: false } }))),
  'Built from',
)

test('domain inspectors show loading before comments, turns, beliefs and evidence arrive', () => {
  for (let part of [taskPending, sessionPending, topicPending, beliefPending]) {
    ok(part.querySelector('[role="status"]'))
  }
  ok(conversationPending)
  equal(sessionPending.textContent?.includes('nothing said yet'), false)
  ok(sessionEmpty.textContent?.includes('nothing said yet'))
  equal(topicPending.textContent?.includes('nothing is believed'), false)
  ok(topicEmpty.textContent?.includes('nothing is believed'))
})

test('domain inspectors retain populated comments and turns during refresh', () => {
  for (let part of [taskRefresh, sessionRefresh]) {
    ok(part.textContent?.includes('Existing result'))
    equal(part.querySelector('[role="status"]'), null)
  }
})
