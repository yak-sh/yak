/// <reference lib="deno.ns" />
// What leaves the process, and what goes back when the server says no. Both
// are pure functions over a committed batch, so they are tested without a
// server, a socket, or a graph.

import { assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { box } from './harness.ts'
import { backoff } from './socket.ts'
import { asking, clean, echo, echoed } from './mark.ts'
import { durableOf, inverse, local, outward, relayed, syncOf } from './tier.ts'

// A bundle as the effect phase sees it: marked with what stood before it.
let sent = (b: Bundle, was: Bundle | null = null) => asking(b, was)

Deno.test('a component says who hears it and how long it lives', () => {
  assertEquals([syncOf(box, 'recipe'), durableOf(box, 'recipe')], [
    'server',
    'forever',
  ])
  assertEquals(local(box, 'draft'), 'vault') // sync: none, durable: forever
  assertEquals(local(box, 'sieve'), 'memory') // sync: none, until disconnect
  assertEquals(local(box, 'pointing'), null) // it leaves; not this node's
})

Deno.test('only server-tier components are told to the server', () => {
  let batch = [sent({
    entity: { eid: 'r1' },
    recipe: { serves: 4 },
    draft: { text: 'half a lemon?' },
  })]
  assertEquals(outward(batch, box), [
    { entity: { eid: 'r1' }, recipe: { serves: 4 } },
  ])
})

Deno.test('a batch that is entirely local says nothing at all', () => {
  let batch = [sent({ entity: { eid: 'r1' }, draft: { text: 'hm' } })]
  assertEquals(outward(batch, box), [])
})

Deno.test('stamps and casualties are not sent: they are the graph talking to itself', () => {
  let batch: Bundle[] = [
    sent({ entity: { eid: 'r1' }, recipe: { serves: 4 } }),
    { entity: { eid: 'r1' }, created: { at: 'now', by: 'c1' } },
    { entity: { eid: 'n1' }, tombstone: {} },
  ]
  assertEquals(outward(batch, box), [
    { entity: { eid: 'r1' }, recipe: { serves: 4 } },
  ])
})

Deno.test('a delete and a $was ride out with the batch', () => {
  let was = { recipe: { serves: 'abc' } }
  let batch = [
    sent({ entity: { eid: 'r1' }, $delete: true }),
    sent({ entity: { eid: 'r2' }, recipe: { serves: 6 }, $was: was }),
  ]
  assertEquals(outward(batch, box), [
    { entity: { eid: 'r1' }, $delete: true },
    { entity: { eid: 'r2' }, recipe: { serves: 6 }, $was: was },
  ])
})

Deno.test('the inverse restores a column, clears one that was absent, drops a new component', () => {
  let before: Bundle = { entity: { eid: 'r1' }, recipe: { serves: 4 } }
  let batch = [sent({
    entity: { eid: 'r1' },
    recipe: { serves: 8, course: 'dinner' },
    doc: { title: 'Dal' },
  }, before)]
  assertEquals(inverse(batch), [{
    entity: { eid: 'r1' },
    recipe: { serves: 4, course: null },
    doc: null,
  }])
})

Deno.test('the inverse of a dropped component puts it back whole', () => {
  let before: Bundle = { entity: { eid: 'r1' }, draft: { text: 'hm' } }
  assertEquals(
    inverse([sent({ entity: { eid: 'r1' }, draft: null }, before)]),
    [{ entity: { eid: 'r1' }, draft: { text: 'hm' } }],
  )
})

Deno.test('a bundle no caller sent has no inverse, and neither has a death', () => {
  let dead = sent({ entity: { eid: 'r1' }, $delete: true }, {
    entity: { eid: 'r1' },
    recipe: { serves: 4 },
  })
  assertEquals(inverse([dead]), [])
  assertEquals(inverse([{ entity: { eid: 'r1' }, recipe: { serves: 4 } }]), [])
})

Deno.test('an echoed bundle is marked, and the marks come off what a caller sees', () => {
  let [b] = echo([sent({ entity: { eid: 'r1' }, recipe: { serves: 4 } })])
  assertEquals(echoed(b), true)
  assertEquals(clean(b), { entity: { eid: 'r1' }, recipe: { serves: 4 } })
})

Deno.test('the reconnect wait doubles, up to the ceiling', () => {
  assertEquals(backoff(250, 30_000), 500)
  assertEquals(backoff(20_000, 30_000), 30_000)
  assertEquals(backoff(30_000, 30_000), 30_000)
})

Deno.test('the relay half goes to the peers, and only it', () => {
  let batch = [sent({
    entity: { eid: 'r1' },
    recipe: { serves: 4 },
    draft: { text: 'half a lemon?' },
    pointing: { x: 3, y: 9 },
  })]
  // The server is told the recipe and nothing else.
  assertEquals(outward(batch, box), [
    { entity: { eid: 'r1' }, recipe: { serves: 4 } },
  ])
  // The peers are told the finger and nothing else.
  assertEquals(relayed(batch, box), [
    { entity: { eid: 'r1' }, pointing: { x: 3, y: 9 } },
  ])
})

Deno.test('a relay carries no precondition and no death: it guards nothing', () => {
  let batch = [
    sent({ entity: { eid: 'r1' }, pointing: { x: 1, y: 2 } }, {
      entity: { eid: 'r1' },
      pointing: { x: 0, y: 0 },
    }),
  ]
  assertEquals(relayed(batch, box), [
    { entity: { eid: 'r1' }, pointing: { x: 1, y: 2 } },
  ])
  // Clearing it is the component set to null, the same as anywhere else.
  let off = [sent({ entity: { eid: 'r1' }, pointing: null })]
  assertEquals(relayed(off, box), [{ entity: { eid: 'r1' }, pointing: null }])
})
