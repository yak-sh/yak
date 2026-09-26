/// <reference lib="deno.ns" />
// The relay: what a server hands on without owning. Everything here is about
// the three ways a peers value stops being true — its writer clears it, its
// writer's connection closes, or its own time runs out — because a broadcast
// that only ever says "here it is" leaves a cursor on the screen forever.

import { assert, assertEquals } from '@std/assert'
import type { Bundle, Graph } from '@yaks/graph'
import { shopGraph } from './testing.ts'
import { type Frame, type Sink, subscriptions } from './subs.ts'

let ear = () => {
  let heard: Frame[] = []
  let to: Sink = (f) => {
    heard.push(f)
  }
  return { to, take: () => heard.splice(0, heard.length) }
}

// The relay bundles one sink has heard, flattened.
let relayed = (frames: Frame[]) => frames.flatMap((f) => f.relay ?? [])

// A clock the test holds: nothing fires until `tick` says so.
let stopped = () => {
  let due: { at: number; fn: () => void }[] = []
  let now = 0
  return {
    timer: (fn: () => void, after: number) => {
      let one = { at: now + after, fn }
      due.push(one)
      return () => {
        due = due.filter((d) => d != one)
      }
    },
    tick: (ms: number) => {
      now += ms
      let ready = due.filter((d) => d.at <= now)
      due = due.filter((d) => d.at > now)
      for (let d of ready) d.fn()
    },
  }
}

let shop = (): Graph => shopGraph()

Deno.test('a peer hears a relay; the writer does not hear its own', () => {
  let graph = shop()
  graph.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  let subs = subscriptions(graph)
  let one = ear(), two = ear()
  subs.open(one.to, 's', '.book')
  subs.open(two.to, 's', '.book')
  one.take(), two.take()

  subs.relay(one.to, [{ entity: { eid: 'b1' }, browsing: { x: 3, y: 9 } }])
  assertEquals(relayed(two.take()), [
    { entity: { eid: 'b1' }, browsing: { x: 3, y: 9 } },
  ])
  assertEquals(one.take(), []) // its own graph already has it
})

Deno.test('a relay is never stored: the set is unchanged and nothing commits', () => {
  let graph = shop()
  graph.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  let subs = subscriptions(graph)
  let one = ear(), two = ear()
  subs.open(one.to, 's', '.book')
  subs.open(two.to, 's', '.book')
  one.take(), two.take()
  subs.relay(one.to, [{ entity: { eid: 'b1' }, browsing: { x: 1, y: 1 } }])
  two.take()
  // Read the graph back: the shop knows nothing about anybody's finger.
  let [b1] = graph.read('.book') as Bundle[]
  assertEquals(b1.browsing, undefined)
  // And the peer heard it exactly once, as a relay and never as a bundle.
  assertEquals(two.take(), [])
})

Deno.test('a late subscriber is told what the peers are already saying', () => {
  let graph = shop()
  graph.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  let subs = subscriptions(graph)
  let one = ear()
  subs.open(one.to, 's', '.book')
  one.take()
  subs.relay(one.to, [{ entity: { eid: 'b1' }, browsing: { x: 4, y: 4 } }])

  let three = ear()
  subs.open(three.to, 's', '.book')
  let [first] = three.take()
  assertEquals(first.relay, [
    { entity: { eid: 'b1' }, browsing: { x: 4, y: 4 } },
  ])
})

for (let query of ['.book', '.book&.order=price']) {
  Deno.test(`an entity joining ${query} brings what the peers already say of it`, () => {
    let graph = shop()
    let subs = subscriptions(graph)
    let one = ear(), two = ear()
    subs.open(one.to, 's', query)
    subs.open(two.to, 's', query)
    one.take(), two.take()
    // Said before b1 is in anybody's set, and not said again.
    subs.relay(two.to, [{ entity: { eid: 'b1' }, browsing: { x: 1, y: 2 } }])
    assertEquals(one.take(), [])

    graph.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
    assertEquals(relayed(one.take()), [
      { entity: { eid: 'b1' }, browsing: { x: 1, y: 2 } },
    ])
    assertEquals(relayed(two.take()), []) // it said it itself
  })
}

Deno.test('a closed connection stops saying everything it was saying', () => {
  let graph = shop()
  graph.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  let subs = subscriptions(graph)
  let one = ear(), two = ear()
  subs.open(one.to, 's', '.book')
  subs.open(two.to, 's', '.book')
  one.take(), two.take()
  subs.relay(one.to, [{ entity: { eid: 'b1' }, browsing: { x: 2, y: 2 } }])
  two.take()

  subs.drop(one.to)
  assertEquals(relayed(two.take()), [{ entity: { eid: 'b1' }, browsing: null }])
})

Deno.test('a durable duration clears itself, and each write restarts it', () => {
  let clock = stopped()
  let graph = shop()
  graph.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  let subs = subscriptions(graph, { timer: clock.timer })
  let one = ear(), two = ear()
  subs.open(one.to, 's', '.book')
  subs.open(two.to, 's', '.book')
  one.take(), two.take()

  subs.relay(one.to, [{ entity: { eid: 'b1' }, typing: { who: 'ada' } }])
  two.take()
  clock.tick(4000)
  assertEquals(two.take(), []) // not yet
  subs.relay(one.to, [{ entity: { eid: 'b1' }, typing: { who: 'ada' } }])
  two.take()
  clock.tick(4000)
  assertEquals(two.take(), []) // the write restarted the span
  clock.tick(1001)
  assertEquals(relayed(two.take()), [{ entity: { eid: 'b1' }, typing: null }])
})

Deno.test('a value held through a lost memory can still be cleared', () => {
  let graph = shop()
  graph.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  let subs = subscriptions(graph)
  let one = ear(), two = ear()
  subs.open(one.to, 's', '.book')
  subs.open(two.to, 's', '.book')
  one.take(), two.take()
  subs.relay(one.to, [{ entity: { eid: 'b1' }, browsing: { x: 7, y: 7 } }])
  let keys = subs.relaying(one.to)
  assertEquals(keys, ['b1 browsing'])

  // A hibernation: the registry is new and remembers nothing, but the keys
  // came back off the socket's attachment.
  let after = subscriptions(graph)
  let three = ear(), four = ear()
  after.open(three.to, 's', '.book')
  after.open(four.to, 's', '.book')
  three.take(), four.take()
  after.relayed(three.to, keys)
  // The value is gone, so a later subscriber is told nothing …
  let five = ear()
  after.open(five.to, 's', '.book')
  assert(!five.take()[0].relay)
  // … but the clearing still reaches the peers.
  after.drop(three.to)
  assertEquals(relayed(four.take()), [{
    entity: { eid: 'b1' },
    browsing: null,
  }])
})

Deno.test('a durable component sent to the relay door is dropped, not stored', () => {
  let graph = shop()
  graph.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  let subs = subscriptions(graph)
  let one = ear(), two = ear()
  subs.open(one.to, 's', '.book')
  subs.open(two.to, 's', '.book')
  one.take(), two.take()
  subs.relay(one.to, [{ entity: { eid: 'b1' }, book: { price: 999 } }])
  assertEquals(two.take(), [])
  assertEquals(subs.relaying(one.to), [])
})
