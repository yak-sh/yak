/// <reference lib="deno.ns" />
// The feed: a cursor that only moves forward, pages that never overlap, and a
// batch that rebuilds into the bundles it committed — the two things a server
// does with the journal (recast to subscribers, drive effects at most once).

import { assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { applied } from './undo.ts'
import { sync, wikiGraph } from './harness.ts'

let fixture = (n: number) => {
  let { g, j } = wikiGraph()
  for (let i = 1; i <= n; i++) {
    sync(g.apply([{ entity: { eid: `p${i}` }, page: { title: `page ${i}` } }]))
  }
  return { g, j }
}

Deno.test('the feed hands out the batches after a cursor, in order', () => {
  let f = fixture(5)
  assertEquals(f.j.since(0).map((e) => e.seq), [1, 2, 3, 4, 5])
  assertEquals(f.j.since(3).map((e) => e.seq), [4, 5])
})

Deno.test('an exhausted feed is empty, and the tip is the cursor', () => {
  let f = fixture(2)
  assertEquals(f.j.tip(), 2)
  assertEquals(f.j.since(2), [])
})

Deno.test('a batch carries only its own operations', () => {
  let f = fixture(3)
  let [second] = f.j.since(1)
  assertEquals(second.seq, 2)
  assertEquals(second.patches.map((p) => p.target), ['p2'])
})

Deno.test('a batch from the feed recasts as the bundles it committed', () => {
  let { g, j } = wikiGraph()
  let change: Bundle[] = [
    { entity: { eid: 'p1' }, page: { title: 'Kickoff' } },
    { entity: { eid: 'n1' }, note: { text: 'aside', page: 'p1' } },
  ]
  sync(g.apply(change))
  assertEquals(j.since(0).map((e) => applied(j.at(e.seq)!)), [change])
})

Deno.test('a feed drains what was committed while it was away', () => {
  let f = fixture(2)
  let cursor = f.j.since(0).at(-1)!.seq
  sync(f.g.apply([{ entity: { eid: 'p9' }, page: { title: 'late' } }]))
  assertEquals(f.j.since(cursor).map((e) => e.seq), [3])
})
