// Delivered comment history must not make a bus pass scan its target joins.
import { equal, ok, test } from '@yaks/testing'
import { type Bundle, graph } from '@yaks/graph'
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
import { comments } from './listen.ts'
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
for (
  let [name, visibility, count] of [
    ['hidden author', { entity: '.entity.eid!=agent' }, 4],
    ['hidden session', { components: { session: '.entity.eid!=agent' } }, 4005],
    ['hidden stamp', { components: { created: '!comment' } }, 4005],
  ] as const
) {
  let scoped = graph({
    vocab: v,
    storage: store,
    plugins: [{ scope: () => visibility }],
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
