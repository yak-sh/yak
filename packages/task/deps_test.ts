// The two questions, kept apart: what is in the way (an alarm) and how much is
// left (a count).

import { assertEquals } from '@std/assert'
import { link } from '@yaks/edge'
import { done, gated, openDeps } from './deps.ts'
import { teamGraph } from './harness.ts'

Deno.test('gated reads the blocked facet, and nothing else', () => {
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
  let { g, storage } = teamGraph()
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
  return storage
}

Deno.test('openDeps counts what has not settled, over both relations', () => {
  // a is open; d is not a task and cannot settle; b and c are finished
  assertEquals(openDeps(seeded(), 'p'), 2)
})

Deno.test('a task with no children counts nothing', () => {
  assertEquals(openDeps(seeded(), 'a'), 0)
})

Deno.test('openDeps follows only the relations it is given', () => {
  let s = seeded()
  // `contains` alone reaches c, which is cancelled and therefore settled
  assertEquals(openDeps(s, 'p', { relations: ['contains'] }), 0)
  assertEquals(openDeps(s, 'p', { relations: ['requires'] }), 2)
})

Deno.test('a rung the ladder does not know leaves a child open', () => {
  let { g, storage } = teamGraph()
  g.install()
  g.apply([
    { entity: { eid: 'p' }, task: {} },
    { entity: { eid: 'a' }, task: {}, claim: {} },
    link('p', 'requires', 'a'),
  ])
  // a claim is not a mark by default, so the child is open
  assertEquals(openDeps(storage, 'p'), 1)
  // and adding the rung does not settle it either — a lease is not finishing
  let marks = [
    { status: 'cancelled', comp: 'cancelled' },
    { status: 'done', comp: 'completed' },
    { status: 'wip', comp: 'claim', settled: false },
  ]
  assertEquals(openDeps(storage, 'p', { marks }), 1)
})

Deno.test('finishing a child lowers the count', () => {
  let { g, storage } = teamGraph()
  g.install()
  g.apply([
    { entity: { eid: 'p' }, task: {} },
    { entity: { eid: 'a' }, task: {} },
    link('p', 'requires', 'a'),
  ])
  assertEquals(openDeps(storage, 'p'), 1)
  g.apply([{
    entity: { eid: 'a' },
    completed: { at: '2026-01-01T00:00:00.000Z' },
  }])
  assertEquals(openDeps(storage, 'p'), 0)
})

Deno.test('done requires a task and a settled status, not merely zero children', () => {
  let storage = seeded()
  assertEquals(done(storage, 'a'), false)
  assertEquals(done(storage, 'b'), true)
  assertEquals(done(storage, 'c'), true)
  assertEquals(done(storage, 'd'), false)
  assertEquals(done(storage, 'missing'), false)
})

Deno.test('done waits for both relations, deduplicates children, and accepts cancellation', () => {
  let { g, storage } = teamGraph()
  g.install()
  g.apply([
    { entity: { eid: 'p' }, task: {}, completed: {} },
    { entity: { eid: 'a' }, task: {}, claim: {} },
    { entity: { eid: 'b' }, task: {} },
    link('p', 'requires', 'a'),
    link('p', 'contains', 'a'),
    link('p', 'contains', 'b'),
  ])
  assertEquals(done(storage, 'p'), false)
  assertEquals(openDeps(storage, 'p'), 2)
  g.apply([{ entity: { eid: 'a' }, completed: {} }])
  assertEquals(done(storage, 'p'), false)
  assertEquals(done(storage, 'p', { relations: ['requires'] }), true)
  g.apply([{ entity: { eid: 'b' }, cancelled: {} }])
  assertEquals(done(storage, 'p'), true)
  g.apply([{ entity: { eid: 'a' }, completed: null }])
  assertEquals(done(storage, 'p'), false)
})

Deno.test('done uses the supplied ladder for the parent and the children', () => {
  let { g, storage } = teamGraph()
  g.install()
  g.apply([
    { entity: { eid: 'p' }, task: {}, claim: {} },
    { entity: { eid: 'a' }, task: {}, claim: {} },
    link('p', 'requires', 'a'),
  ])
  let marks = [{ status: 'wip', comp: 'claim', settled: false }]
  assertEquals(done(storage, 'p', { marks }), false)
  marks = [{ status: 'accepted', comp: 'claim', settled: true }]
  assertEquals(done(storage, 'p', { marks }), true)
})

Deno.test('done stays async over asynchronous storage, for true and false answers', async () => {
  let s = seeded()
  s.tx((tx) => tx.patch([{ entity: { eid: 'p' }, completed: {} }]))
  let asyncStorage: import('@yaks/graph').Storage = {
    ...s,
    read: async (...args) => await s.read(...args),
    tx: (body) => Promise.resolve(s.tx(body)),
  }
  for (
    let [eid, expected] of [['a', false], ['b', true], ['p', false]] as const
  ) {
    let result = done(asyncStorage, eid)
    assertEquals(result instanceof Promise, true)
    assertEquals(await result, expected)
  }
})

Deno.test('done cannot settle a non-task or a parent waiting on one', () => {
  let { g, storage } = teamGraph()
  g.install()
  g.apply([
    { entity: { eid: 'p' }, task: {}, cancelled: {} },
    { entity: { eid: 'spec' }, doc: { title: 'spec' }, completed: {} },
    link('p', 'requires', 'spec'),
  ])
  assertEquals(done(storage, 'spec'), false)
  assertEquals(done(storage, 'p'), false)
  g.apply([{ entity: { eid: 'spec' }, task: {} }])
  assertEquals(done(storage, 'p'), true)
})
