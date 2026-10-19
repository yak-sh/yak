// Delivered comment history must not make a bus pass scan its target joins.
import { equal, ok, test } from '@yaks/testing'
import { type Bundle, graph, type Visibility } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { sessionDoc } from '@yaks/session'
import { sessionDerived } from './status.ts'
import { toolsDoc } from '@yaks/tools/vocab'
import { docDoc } from '@yaks/doc'
import { mailDoc } from '@yaks/mail/vocab'
import { notifyDoc } from '@yaks/notify/vocab'
import { personaDoc } from '@yaks/persona/vocab'
import { projectDoc } from '@yaks/project/vocab'
import { taskDoc } from '@yaks/task/vocab'
import { processDoc } from '@yaks/process/vocab'
import { archetypeDoc } from '@yaks/archetype/vocab'
import { stepping } from '../sqlite/testing.ts'
import { storage } from '@yaks/sqlite'
import { archetypes } from '../archetype/plugin.ts'
import { sessions } from './plugin.ts'
import { due } from './bus.ts'
import { comments, pending } from './listen.ts'
let v = loadVocab([
  kernelDoc,
  sessionDoc,
  toolsDoc,
  docDoc,
  mailDoc,
  notifyDoc,
  personaDoc,
  projectDoc,
  taskDoc,
  processDoc,
  archetypeDoc,
], [kernelKeywords])
for (let count of [100, 1000]) {
  let { driver: d, steps } = stepping()
  let store = storage(d, v, { derived: sessionDerived(v) })
  let g = graph({
    vocab: v,
    storage: store,
    plugins: [sessions(), archetypes()],
  })
  await g.apply([{ entity: { eid: 'human' }, doc: { title: 'Human' } }, {
    entity: { eid: 'native' },
    session: {},
  }, {
    entity: { eid: 'target' },
    task: {},
    $actor: { by: 'native', via: 'native' },
  }, { entity: { eid: 'pick' }, entry: { session: 'native' }, using: {} }], {
    trusted: true,
  })
  let comments: Bundle[] = Array.from(
    { length: count },
    (_, i) => ({
      entity: { eid: 'comment' + i },
      comment: { target: 'target' },
      notified: {},
      doc: { body: 'seen' },
      $actor: { by: 'human', via: 'human' },
    }),
  )
  await g.apply(comments, { trusted: true })
  await g.apply([{
    entity: { eid: 'unread' },
    comment: { target: 'target' },
    doc: { body: 'news' },
    $actor: { by: 'human', via: 'human' },
  }], { trusted: true })
  await due(g)
  let at = steps()
  let got = await due(g)
  let vm = steps() - at
  test(`a bus pass seeks unread comments beside ${count} delivered comments`, () => {
    equal(got.map((x) => [x.session, x.item.entity.eid]), [[
      'native',
      'unread',
    ]])
    ok(vm < 3000, `${vm} VM steps beside ${count} delivered comments`)
  })
}

let { driver: d, steps } = stepping()
let store = storage(d, v, { derived: sessionDerived(v) })
let g = graph({
  vocab: v,
  storage: store,
  plugins: [sessions(), archetypes()],
})
await g.apply([
  { entity: { eid: 'person' }, doc: {} },
  { entity: { eid: 'agent' }, session: {} },
  ...Array.from({ length: 4 }, (_, i) => [
    { entity: { eid: `native${i}` }, session: {} },
    {
      entity: { eid: `pick${i}` },
      entry: { session: `native${i}` },
      using: {},
    },
    {
      entity: { eid: `target${i}` },
      task: {},
      $actor: { by: `native${i}`, via: `native${i}` },
    },
    {
      entity: { eid: `news${i}` },
      comment: { target: `target${i}` },
      $actor: { by: 'person', via: 'person' },
    },
  ]).flat(),
], { trusted: true })
await g.apply([{
  entity: { eid: 'agent-comment' },
  comment: { target: 'target0' },
  $actor: { by: 'agent', via: 'agent' },
}], { trusted: true })
let [sample] = await g.get(['agent-comment'])
store.tx((tx) =>
  tx.patch(Array.from({ length: 4000 }, (_, i) => ({
    ...sample,
    entity: { eid: `agent-comment${i}`, archetype: sample.entity.archetype },
  })))
)
await due(g)
let read = g.read.bind(g), reread = 0
g.read = async (q, opts) => {
  let rows = await read(q, opts)
  reread += rows.filter((b) => b.comment).length
  return rows
}
let at = steps(), got = await due(g), vm = steps() - at, readComments = reread
test('several recipients share one pass over unread agent history', () => {
  equal(got.map((x) => [x.session, x.item.entity.eid]), [
    ['native0', 'news0'],
    ['native1', 'news1'],
    ['native2', 'news2'],
    ['native3', 'news3'],
  ])
  equal(readComments, got.length)
  ok(vm < 160_000, `${vm} VM steps beside unread agent history`)
})
let screened = graph({
  vocab: v,
  storage: store,
  plugins: [{ name: 'screen', scope: () => ({ entity: '!doc' }) }],
})
await comments(screened)
let started = steps(), screenedItems = await comments(screened)
let screenedVm = steps() - started
test('comment routing screens each candidate owner once', () => {
  equal(screenedItems.items.map((b) => b.entity.eid), [
    'news0',
    'news1',
    'news2',
    'news3',
  ])
  ok(screenedVm < 250_000, `${screenedVm} VM steps with owner visibility`)
})
let scopes: [string, Visibility, number][] = [
  ['hidden owner', { entity: '.entity.eid!=news0' }, 3],
  ['hidden author', { entity: '.entity.eid!=agent' }, 4],
  ['hidden session', { components: { session: '.entity.eid!=agent' } }, 4005],
  ['hidden stamp', { components: { created: '!comment' } }, 4005],
]
for (let [name, visibility, count] of scopes) {
  let scoped = graph({
    vocab: v,
    storage: store,
    plugins: [{ name: 'scope', scope: () => visibility }],
  })
  let selected = await comments(scoped)
  test(`human comment routing preserves ${name} visibility`, () => {
    equal(selected.items.length, count)
  })
}
await g.apply([{ entity: { eid: 'person' }, session: {} }], { trusted: true })
let changed = await due(g)
test('a new bus pass rereads whether an author is a session', () => {
  equal(changed, [])
})
await g.apply([{
  entity: { eid: 'unstamped' },
  comment: { target: 'target0' },
}], { trusted: true })
let unstamped = await due(g)
test('a missing author reference still delivers a human comment', () => {
  equal(unstamped.map((x) => [x.session, x.item.entity.eid]), [[
    'native0',
    'unstamped',
  ]])
})

let meter = stepping(),
  mailStore = storage(meter.driver, v, { derived: sessionDerived(v) })
let mailGraph = graph({
  vocab: v,
  storage: mailStore,
  plugins: [sessions(), archetypes()],
})
await mailGraph.apply([
  { entity: { eid: 'human' }, doc: {} },
  { entity: { eid: 'writer' }, session: {} },
  { entity: { eid: 'work' }, doc: {}, $actor: { by: 'writer', via: 'writer' } },
  {
    entity: { eid: 'sent' },
    mail: {},
    $actor: { by: 'writer', via: 'writer' },
  },
  {
    entity: { eid: 'reply' },
    mail: { reply_to: 'sent' },
    doc: { body: 'answer' },
    $actor: { by: 'human', via: 'human' },
  },
], { trusted: true })
let [work] = await mailGraph.get(['work'])
mailStore.tx((tx) =>
  tx.patch(Array.from({ length: 4000 }, (_, i) => ({
    ...work,
    entity: { eid: `work${i}`, archetype: work.entity.archetype },
  })))
)
await pending(mailGraph, 'writer')
let beforeMail = meter.steps(), reply = await pending(mailGraph, 'writer')
let replyVm = meter.steps() - beforeMail
test('a reply seeks its writer without traversing everything that writer created', () => {
  equal(reply.map(({ item }) => item.entity.eid), ['reply'])
  ok(replyVm < 10_000, `${replyVm} VM steps beside a writer's unrelated work`)
})

let mailScopes: [string, Visibility][] = [
  ['hidden answered letter', { entity: '.entity.eid!=sent' }],
  ['hidden writer', { entity: '.entity.eid!=writer' }],
  ['hidden creator stamp', { components: { created: '.entity.eid!=sent' } }],
  ['hidden reply', { components: { mail: '.entity.eid!=reply' } }],
]
for (let [name, visibility] of mailScopes) {
  let scoped = graph({
    vocab: v,
    storage: mailStore,
    plugins: [{ name: 'mail-scope', scope: () => visibility }],
  })
  let items = await pending(scoped, 'writer')
  test(`reply routing preserves ${name} visibility`, () => equal(items, []))
}

let unreadReplies = '.mail.reply_to !notified .fields=mail.reply_to,mail.target'
let replyScope = graph({
  vocab: v,
  storage: mailStore,
  plugins: [{ name: 'unread-scope', scope: () => ({ entity: '!cancelled' }) }],
})
await replyScope.read(unreadReplies)
let beforeReplies = meter.steps(),
  selectedReplies = await replyScope.read(unreadReplies)
let selectedVm = meter.steps() - beforeReplies
test('property presence shares the sparse shape selection with absence', () => {
  equal(selectedReplies.map((b) => b.entity.eid), ['reply'])
  ok(
    selectedVm < 3000,
    `${selectedVm} VM steps beside unrelated component owners`,
  )
})
