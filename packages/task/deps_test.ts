// The two questions, kept apart: what is in the way (an alarm) and how much is
// left (a count).

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { edges, link } from '@yaks/edge'
import { graph } from '@yaks/graph'
import { kernel } from '@yaks/kernel'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { done, gated, openDeps } from './deps.ts'
import { tasks } from './plugin.ts'
import { team, teamGraph } from './testing.ts'

test('gated reads the blocked facet, and nothing else', () => {
  assertEquals(gated({ entity: { eid: 't' }, task: {} }), false)
  assertEquals(gated({ entity: { eid: 't' }, task: {}, blocked: {} }), true)
  assertEquals(
    gated({ entity: { eid: 't' }, task: {}, blocked: { on: 'legal' } }),
    true,
  )
  // an unfinished child is not a gate
  assertEquals(gated({ entity: { eid: 't' }, task: {}, completed: {} }), false)
})

// A parent with four children: one open, one done, one cancelled, one that is
// not a task at all.
let seeded = () => {
  let { g } = teamGraph()
  g.install()
  g.apply([
    { entity: { eid: 'p' }, doc: { title: 'the parent' }, task: {} },
    { entity: { eid: 'a' }, doc: { title: 'open' }, task: {} },
    { entity: { eid: 'b' }, doc: { title: 'done' }, task: {}, completed: {} },
    { entity: { eid: 'c' }, doc: { title: 'off' }, task: {}, cancelled: {} },
    { entity: { eid: 'd' }, doc: { title: 'a spec' } },
    link('p', 'requires', 'a'),
    link('p', 'requires', 'b'),
    link('p', 'contains', 'c'),
    link('p', 'requires', 'd'),
  ])
  return g
}

test('openDeps counts what has not settled, over both relations', () => {
  // a is open; d is not a task and cannot settle; b and c are finished
  assertEquals(openDeps(seeded(), 'p'), 2)
})

test('a task with no children counts nothing', () => {
  assertEquals(openDeps(seeded(), 'a'), 0)
})

test('openDeps follows only the relations it is given', () => {
  let s = seeded()
  // `contains` alone reaches c, which is cancelled and therefore settled
  assertEquals(openDeps(s, 'p', { relations: ['contains'] }), 0)
  assertEquals(openDeps(s, 'p', { relations: ['requires'] }), 2)
})

// The team's vocabulary with a rung of its own: a held claim reads `wip`.
let leased = loadVocab([...team.docs, {
  $defs: {
    task: { component: true, extends: true, status: { claim: 'wip' } },
  },
}], team.keywords)

test('a claimed child is open, whether or not its ladder reads it wip', () => {
  for (let vocab of [team, leased]) {
    let g = graph({
      storage: ram(vocab),
      vocab,
      plugins: [kernel(), edges(vocab), tasks()],
    })
    g.install()
    g.apply([
      { entity: { eid: 'p' }, task: {}, claim: {} },
      { entity: { eid: 'a' }, task: {}, claim: {} },
      link('p', 'requires', 'a'),
    ])
    // a lease is not finishing
    assertEquals(openDeps(g, 'p'), 1)
    assertEquals(done(g, 'p'), false)
    g.apply([{ entity: { eid: 'a' }, completed: {} }])
    assertEquals(openDeps(g, 'p'), 0)
  }
})

test('finishing a child lowers the count', () => {
  let { g } = teamGraph()
  g.install()
  g.apply([
    { entity: { eid: 'p' }, task: {} },
    { entity: { eid: 'a' }, task: {} },
    link('p', 'requires', 'a'),
  ])
  assertEquals(openDeps(g, 'p'), 1)
  g.apply([{ entity: { eid: 'a' }, completed: {} }])
  assertEquals(openDeps(g, 'p'), 0)
})

test('done requires a task and a settled status, not merely zero children', () => {
  let g = seeded()
  assertEquals(done(g, 'a'), false)
  assertEquals(done(g, 'b'), true)
  assertEquals(done(g, 'c'), true)
  assertEquals(done(g, 'd'), false)
  assertEquals(done(g, 'missing'), false)
})

test('done waits for both relations, deduplicates children, and accepts cancellation', () => {
  let { g } = teamGraph()
  g.install()
  g.apply([
    { entity: { eid: 'p' }, task: {}, completed: {} },
    { entity: { eid: 'a' }, task: {}, claim: {} },
    { entity: { eid: 'b' }, task: {} },
    link('p', 'requires', 'a'),
    link('p', 'contains', 'a'),
    link('p', 'contains', 'b'),
  ])
  assertEquals(done(g, 'p'), false)
  assertEquals(openDeps(g, 'p'), 2)
  g.apply([{ entity: { eid: 'a' }, completed: {} }])
  assertEquals(done(g, 'p'), false)
  assertEquals(done(g, 'p', { relations: ['requires'] }), true)
  g.apply([{ entity: { eid: 'b' }, cancelled: {} }])
  assertEquals(done(g, 'p'), true)
  g.apply([{ entity: { eid: 'a' }, completed: null }])
  assertEquals(done(g, 'p'), false)
})

test('done stays async over asynchronous storage, for true and false answers', async () => {
  let s = seeded().storage
  s.tx((tx) => tx.patch([{ entity: { eid: 'p' }, completed: {} }]))
  let asyncStorage: import('@yaks/graph').Storage = {
    ...s,
    read: async (...args) => await s.read(...args),
    get: async (eids, comps) => await s.get(eids, comps),
    tx: (body) => Promise.resolve(s.tx(body)),
  }
  for (
    let [eid, expected] of [['a', false], ['b', true], ['p', false]] as const
  ) {
    let result = done({ storage: asyncStorage, vocab: team }, eid)
    assertEquals(result instanceof Promise, true)
    assertEquals(await result, expected)
  }
})

test('done cannot settle a non-task or a parent waiting on one', () => {
  let { g } = teamGraph()
  g.install()
  g.apply([
    { entity: { eid: 'p' }, task: {}, cancelled: {} },
    { entity: { eid: 'spec' }, doc: { title: 'spec' }, completed: {} },
    link('p', 'requires', 'spec'),
  ])
  assertEquals(done(g, 'spec'), false)
  assertEquals(done(g, 'p'), false)
  g.apply([{ entity: { eid: 'spec' }, task: {} }])
  assertEquals(done(g, 'p'), true)
})
