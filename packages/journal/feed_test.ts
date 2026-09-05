/// <reference lib="deno.ns" />
// The feed: a cursor that only moves forward, pages that never overlap, and a
// batch that rebuilds into the bundles it committed — the two things a server
// does with the journal (recast to subscribers, drive effects at most once).

import { assert, assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { isPromise } from '@yaks/graph'
import { type Cursor, since } from './read.ts'
import { applied } from './undo.ts'
import { wikiGraph } from './harness.ts'

let sync = <T>(out: T | Promise<T>): T => {
  assert(!isPromise(out), 'apply() went async over a Map')
  return out as T
}

let fixture = (n: number) => {
  let g = wikiGraph()
  for (let i = 1; i <= n; i++) {
    sync(g.apply([{ entity: { eid: `p${i}` }, page: { title: `page ${i}` } }]))
  }
  return {
    g,
    feed: (cursor?: Cursor, size?: number) => sync(since(g)(cursor, size)),
  }
}

Deno.test('the feed pages by cursor and never repeats a batch', () => {
  let f = fixture(5)
  let seen: number[] = []
  let cursor: Cursor | undefined
  for (let i = 0; i < 4; i++) {
    let page = f.feed(cursor, 2)
    seen.push(...page.batches.map((b) => b.seq))
    cursor = page.cursor
  }
  assertEquals(seen, [1, 2, 3, 4, 5], 'every batch once, in order')
  assertEquals(cursor, { seq: 5 })
})

Deno.test('an exhausted feed hands the cursor straight back', () => {
  let f = fixture(2)
  let page = f.feed({ seq: 2 })
  assertEquals(page.batches, [])
  assertEquals(page.cursor, { seq: 2 })
})

Deno.test('a page carries only its own batches deltas', () => {
  let f = fixture(3)
  let page = f.feed({ seq: 1 }, 1)
  assertEquals(page.batches.length, 1)
  assertEquals(page.batches[0].seq, 2)
  assertEquals(
    page.batches[0].deltas.map((d) => d.target),
    ['p2', 'p2'],
    'the appearing component, then its column',
  )
})

Deno.test('a batch from the feed recasts as the bundles it committed', () => {
  let g = wikiGraph()
  let change: Bundle[] = [
    { entity: { eid: 'p1' }, page: { title: 'Kickoff' } },
    { entity: { eid: 'n1' }, note: { text: 'aside', page: 'p1' } },
  ]
  sync(g.apply(change))
  let page = sync(since(g)())
  assertEquals(page.batches.map(applied), [change])
})

Deno.test('a feed drains what was committed while it was away', () => {
  let f = fixture(2)
  let first = f.feed()
  sync(f.g.apply([{ entity: { eid: 'p9' }, page: { title: 'late' } }]))
  let next = f.feed(first.cursor)
  assertEquals(next.batches.map((b) => b.seq), [3])
})
