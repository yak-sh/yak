// What a persona holds, gathered off the graph: which tier a doc lands in, the
// order they arrive in, and how a carried persona folds in.

import { assert, assertEquals } from '@std/assert'
import { type Bundle, type Graph, isPromise } from '@yaks/graph'
import { held, link, memory, said, thin, voiced, world } from './testing.ts'
import { wear } from './worn.ts'
import type { Worn } from './voice.ts'

// Sync in, sync out: @yaks/ram answers immediately, so a test that had to
// await would be saying the gather went somewhere it should not have.
let now = (g: Graph, eid: string, vocab = said): Worn | undefined => {
  let worn = wear(held(g), vocab)(eid)
  assert(!isPromise(worn), 'the gather went async over a Map')
  return worn
}

let ids = (bundles: Bundle[]) => bundles.map((b) => b.entity.eid)

// One persona, its two tiers, and a second persona under it.
let graph = (...batch: Bundle[]): Graph => {
  let g = world()
  g.apply([
    voiced('n1', 'TaskMaster', 'the voice'),
    memory('m1', 'one', 'first'),
    memory('m2', 'two', 'second'),
    memory('m3', 'three', 'third'),
    ...batch,
  ])
  return g
}

Deno.test('contains carries the doc, reads only names it', () => {
  let g = graph(link('n1', 'contains', 'm1'), link('n1', 'reads', 'm2'))
  let worn = now(g, 'n1')!
  assertEquals(ids(worn.carries), ['m1'])
  assertEquals(ids(worn.names), ['m2'])
  assertEquals(worn.persona.entity.eid, 'n1')
})

Deno.test('the authored order is the order: ord first, then the end it points at', () => {
  let g = graph(
    link('n1', 'contains', 'm3', 1),
    link('n1', 'contains', 'm1', 9),
    link('n1', 'contains', 'm2', 2),
  )
  assertEquals(ids(now(g, 'n1')!.carries), ['m3', 'm2', 'm1'])
})

Deno.test('an unordered link sorts after the ordered ones, stably', () => {
  let g = graph(
    link('n1', 'contains', 'm3'),
    link('n1', 'contains', 'm2'),
    link('n1', 'contains', 'm1', 1),
  )
  assertEquals(ids(now(g, 'n1')!.carries), ['m1', 'm2', 'm3'])
})

Deno.test('a carried persona folds in: its voice is carried and its tiers join', () => {
  let g = graph(
    voiced('n2', 'base', 'the floor'),
    link('n1', 'contains', 'n2'),
    link('n2', 'contains', 'm1'),
    link('n2', 'reads', 'm2'),
  )
  let worn = now(g, 'n1')!
  assertEquals(ids(worn.carries), ['n2', 'm1'])
  assertEquals(ids(worn.names), ['m2'])
})

Deno.test('a named persona is only named — what it holds stays where it is', () => {
  let g = graph(
    voiced('n2', 'base', 'the floor'),
    link('n1', 'reads', 'n2'),
    link('n2', 'contains', 'm1'),
  )
  let worn = now(g, 'n1')!
  assertEquals(ids(worn.carries), [])
  assertEquals(ids(worn.names), ['n2'])
})

Deno.test('a doc carried and named is carried once', () => {
  let g = graph(
    voiced('n2', 'base', 'the floor'),
    link('n1', 'reads', 'm1'),
    link('n1', 'contains', 'n2'),
    link('n2', 'contains', 'm1'),
  )
  let worn = now(g, 'n1')!
  assertEquals(ids(worn.carries), ['n2', 'm1'])
  assertEquals(ids(worn.names), [])
})

Deno.test('a ring of personas ends the gather rather than spinning', () => {
  let g = graph(
    voiced('n2', 'base', 'the floor'),
    link('n1', 'contains', 'n2'),
    link('n2', 'contains', 'n1'),
    link('n2', 'contains', 'm1'),
  )
  assertEquals(ids(now(g, 'n1')!.carries), ['n2', 'm1'])
})

Deno.test('a proposal is said only once somebody approves it', () => {
  let g = graph(
    { entity: { eid: 'm1' }, proposed: {} },
    { entity: { eid: 'm2' }, proposed: {}, decided: { verdict: 'declined' } },
    { entity: { eid: 'm3' }, proposed: {}, decided: { verdict: 'approved' } },
    link('n1', 'contains', 'm1'),
    link('n1', 'reads', 'm2'),
    link('n1', 'reads', 'm3'),
  )
  let worn = now(g, 'n1')!
  assertEquals(ids(worn.carries), [])
  assertEquals(ids(worn.names), ['m3'])
})

Deno.test('an entity that is not a persona is nobody to wear', () => {
  let g = graph()
  assertEquals(now(g, 'm1'), undefined)
  assertEquals(now(g, 'nothing-at-all'), undefined)
})

Deno.test('a relation this vocabulary never declares contributes nothing', () => {
  // A host with no @yaks/task composed has no `contains`; the persona still
  // speaks, and still names what it reads.
  let g = world(thin)
  g.apply([
    voiced('n1', 'TaskMaster', 'the voice'),
    memory('m1', 'one', 'first'),
    link('n1', 'reads', 'm1'),
  ])
  let worn = now(g, 'n1', thin)!
  assertEquals(ids(worn.carries), [])
  assertEquals(ids(worn.names), ['m1'])
})
