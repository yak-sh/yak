// The two questions, kept apart: what is in the way (an alarm) and how much is
// left (a count).

import { assertEquals } from '@std/assert'
import { link } from '@yaks/edge'
import { gated, openDeps } from './deps.ts'
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
