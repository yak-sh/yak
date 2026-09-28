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

Deno.test('a value another connection took over outlives the first closing', () => {
  let graph = shop()
  graph.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  let subs = subscriptions(graph)
  let one = ear(), two = ear(), three = ear()
  for (let e of [one, two, three]) subs.open(e.to, 's', '.book')
  subs.relay(one.to, [{ entity: { eid: 'b1' }, browsing: { x: 1, y: 1 } }])
  subs.relay(two.to, [{ entity: { eid: 'b1' }, browsing: { x: 2 } }])
  three.take()

  subs.drop(one.to)
  assertEquals(relayed(three.take()), [])
  let four = ear()
  subs.open(four.to, 's', '.book')
  assertEquals(four.take()[0].relay, [
    { entity: { eid: 'b1' }, browsing: { x: 2, y: 1 } },
  ])
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

Deno.test('a peer predicate admits late and moving rows, then lets them go', () => {
  let graph = shop()
  graph.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  let subs = subscriptions(graph)
  let writer = ear(), watcher = ear(), late = ear()
  subs.open(watcher.to, 'near', '.book&.browsing.x<10')
  assertEquals(watcher.take()[0].bundles, [])

  subs.relay(writer.to, [{ entity: { eid: 'b1' }, browsing: { x: 2 } }])
  let [joined] = watcher.take()
  assertEquals(joined.bundles?.map((b) => b.entity.eid), ['b1'])
  assertEquals(joined.relay?.[0].browsing, { x: 2 })
  assertEquals(graph.read('.browsing'), [])

  subs.open(late.to, 'near', '.book&.browsing.x<10')
  assertEquals(late.take()[0].relay?.[0].browsing, { x: 2 })

  subs.relay(writer.to, [{ entity: { eid: 'b1' }, browsing: { x: 12 } }])
  assertEquals(watcher.take().map((f) => f.gone ?? f.relay?.[0].browsing), [
    { x: 12 },
    ['b1'],
  ])
  assertEquals(late.take().at(-1)?.gone, ['b1'])

  subs.relay(writer.to, [{ entity: { eid: 'b1' }, browsing: { x: 3 } }])
  assertEquals(watcher.take()[0].relay?.[0].browsing, { x: 3 })
  subs.relay(writer.to, [{ entity: { eid: 'b1' }, browsing: null }])
  assertEquals(watcher.take().at(-1)?.gone, ['b1'])
})

Deno.test('sustained peer movement does not resend stored data to existing members', () => {
  let graph = shop()
  graph.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  let subs = subscriptions(graph)
  let writer = ear(), watcher = ear()
  subs.open(watcher.to, 'near', '.book&.browsing.x<10')
  watcher.take()
  subs.relay(writer.to, [{ entity: { eid: 'b1' }, browsing: { x: 1 } }])
  let joined = watcher.take()
  assertEquals(joined.length, 1)
  assertEquals(joined[0].bundles?.map((b) => b.entity.eid), ['b1'])
  assertEquals(joined[0].relay?.[0].browsing, { x: 1 })

  for (let x = 2; x < 102; x++) {
    subs.relay(writer.to, [{ entity: { eid: 'b1' }, browsing: { x: x % 9 } }])
    assertEquals(watcher.take(), [{
      id: 'near',
      relay: [{ entity: { eid: 'b1' }, browsing: { x: x % 9 } }],
    }])
  }
  // A real durable change still sends the changed stored bundle.
  graph.apply([{ entity: { eid: 'b1' }, book: { price: 13 } }])
  assertEquals(watcher.take().at(-1)?.bundles?.[0].book, { price: 13 })
})

Deno.test('peer movement reads storage once until a commit or release', () => {
  let graph = shop()
  graph.apply([
    { entity: { eid: 'b1' }, book: { price: 12 }, doc: { title: 'first' } },
    { entity: { eid: 'b2' }, doc: { title: 'other' } },
  ])
  let reads = 0
  let spy: Graph = {
    ...graph,
    get: (ids) => (reads++, graph.get(ids)),
    read: (q, opts) => (reads++, graph.read(q, opts)),
  }
  let subs = subscriptions(spy)
  let writer = ear(), watcher = ear()
  subs.open(watcher.to, 'near', '(.book.price<20|.doc&.browsing.x<10)&*')
  subs.open(watcher.to, 'count', '(.book.price<20|.doc&.browsing.x<10)&.count')
  watcher.take()
  reads = 0

  subs.relay(writer.to, [{ entity: { eid: 'b1' }, browsing: { x: 1 } }])
  assertEquals(reads, 1)
  watcher.take()
  for (let x = 2; x < 102; x++) {
    subs.relay(writer.to, [{ entity: { eid: 'b1' }, browsing: { x } }])
    watcher.take()
  }
  assertEquals(reads, 1)

  spy.apply([{ entity: { eid: 'b1' }, book: { price: 30 } }])
  let committed = watcher.take()
  assertEquals(committed.find((f) => f.id == 'near')?.gone, ['b1'])
  assertEquals(committed.find((f) => f.id == 'count'), {
    id: 'count',
    count: 0,
  })
  reads = 0
  subs.relay(writer.to, [{ entity: { eid: 'b1' }, browsing: { x: 3 } }])
  assertEquals(reads, 0) // both caches refreshed during the commit
  let joined = watcher.take()
  assertEquals(joined.find((f) => f.id == 'near')?.bundles?.[0].book, {
    price: 30,
  })
  assertEquals(joined.find((f) => f.id == 'count'), {
    id: 'count',
    count: 1,
  })
  subs.relay(writer.to, [{ entity: { eid: 'b1' }, browsing: null }])
  assertEquals(reads, 0)
  watcher.take()
  subs.relay(writer.to, [{ entity: { eid: 'b1' }, browsing: { x: 4 } }])
  assertEquals(reads, 1) // a new held lifetime reads its durable row
})

Deno.test('shared reference watches refresh from one moved peer read', () => {
  let graph = shop()
  graph.apply([
    { entity: { eid: 'p1' }, doc: { title: 'One' } },
    { entity: { eid: 'p2' }, doc: { title: 'Two' } },
    { entity: { eid: 'l1' }, book: { author: 'p1' } },
    { entity: { eid: 'l2' }, book: { author: 'p2' } },
  ])
  let reads: string[] = []
  let spy: Graph = {
    ...graph,
    get: (ids) => (reads.push(`get ${ids.join(',')}`), graph.get(ids)),
    read: (q, opts) => (reads.push(`read ${q}`), graph.read(q, opts)),
  }
  let subs = subscriptions(spy), writer = ear()
  let watchers = Array.from({ length: 8 }, () => ear())
  for (let watcher of watchers) {
    subs.open(
      watcher.to,
      'looks',
      '(.book.author.browsing.x<10|.book.author=p2)&.book&*',
    )
    assertEquals(watcher.take()[0].bundles?.map((b) => b.entity.eid), ['l2'])
  }
  reads = []
  subs.relay(writer.to, [{ entity: { eid: 'p1' }, browsing: { x: 5 } }])
  for (let watcher of watchers) {
    assertEquals(watcher.take().at(-1)?.bundles?.map((b) => b.entity.eid), [
      'l1',
    ])
  }
  assertEquals(reads.filter((r) => r.startsWith('read .book.author=')), [
    'read .book.author=p1',
  ])
  assertEquals(reads.filter((r) => r == 'get l1'), ['get l1'])
})

Deno.test('peer-only rows keep a missing durable candidate until expiry', () => {
  let clock = stopped(), graph = shop()
  let reads = 0
  let spy: Graph = {
    ...graph,
    get: (ids) => (reads++, graph.get(ids)),
  }
  let subs = subscriptions(spy, { timer: clock.timer })
  let writer = ear(), watcher = ear()
  subs.open(watcher.to, 'near', '.typing.who=ada')
  watcher.take()
  subs.relay(writer.to, [{
    entity: { eid: 'visitor' },
    typing: { who: 'ada' },
  }])
  assertEquals(reads, 1)
  assertEquals(watcher.take()[0].bundles, [{ entity: { eid: 'visitor' } }])
  for (let i = 0; i < 20; i++) {
    subs.relay(writer.to, [{
      entity: { eid: 'visitor' },
      typing: { who: 'ada' },
    }])
    watcher.take()
  }
  assertEquals(reads, 1)
  clock.tick(5001)
  assertEquals(watcher.take().at(-1)?.gone, ['visitor'])
  subs.relay(writer.to, [{
    entity: { eid: 'visitor' },
    typing: { who: 'ada' },
  }])
  assertEquals(reads, 2)
})

Deno.test('commits replace a cached missing row while its peer value lives', () => {
  let graph = shop(), subs = subscriptions(graph)
  let writer = ear(), watcher = ear()
  subs.open(watcher.to, 'near', '.book&.browsing.x<10')
  watcher.take()
  subs.relay(writer.to, [{
    entity: { eid: 'b1' },
    browsing: { x: 2 },
  }])
  assertEquals(watcher.take(), [])

  graph.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  let [joined] = watcher.take()
  assertEquals(joined.bundles?.[0].book, { price: 12 })
  assertEquals(joined.relay?.[0].browsing, { x: 2 })
  graph.apply([{ entity: { eid: 'b1' }, $delete: true }])
  assertEquals(watcher.take()[0].gone, ['b1'])
  subs.relay(writer.to, [{ entity: { eid: 'b1' }, browsing: { x: 3 } }])
  assertEquals(watcher.take(), [])
})

Deno.test('durable commits recheck a row beside its held peer value', () => {
  let graph = shop()
  graph.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  let subs = subscriptions(graph)
  let writer = ear(), watcher = ear()
  subs.relay(writer.to, [{ entity: { eid: 'b1' }, browsing: { x: 2 } }])
  subs.open(watcher.to, 'near', '.book.price<20&.browsing.x<10')
  assertEquals(watcher.take()[0].bundles?.map((b) => b.entity.eid), ['b1'])
  graph.apply([{ entity: { eid: 'b1' }, book: { price: 30 } }])
  assertEquals(watcher.take()[0].gone, ['b1'])
  graph.apply([{ entity: { eid: 'b1' }, book: { price: 9 } }])
  let [again] = watcher.take()
  assertEquals(again.bundles?.[0].book, { price: 9 })
  assertEquals(again.relay?.[0].browsing, { x: 2 })
})

Deno.test('peer expiry removes membership', () => {
  let clock = stopped(), graph = shop()
  graph.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  let subs = subscriptions(graph, { timer: clock.timer })
  let writer = ear(), watcher = ear()
  subs.open(watcher.to, 'typing', '.book&.typing.who=ada')
  watcher.take()
  subs.relay(writer.to, [{ entity: { eid: 'b1' }, typing: { who: 'ada' } }])
  watcher.take()
  clock.tick(5001)
  assertEquals(watcher.take().at(-1)?.gone, ['b1'])
})

Deno.test('a peer-only entity can join a query and a count', () => {
  let graph = shop(), subs = subscriptions(graph)
  let writer = ear(), watcher = ear()
  subs.open(watcher.to, 'where', '.browsing.x<10')
  subs.open(watcher.to, 'count', '.browsing.x<10&.count')
  watcher.take()
  subs.relay(writer.to, [{ entity: { eid: 'visitor' }, browsing: { x: 2 } }])
  let joined = watcher.take()
  assertEquals(joined.find((f) => f.id == 'where')?.bundles, [
    { entity: { eid: 'visitor' } },
  ])
  assertEquals(joined.find((f) => f.id == 'count'), { id: 'count', count: 1 })
  subs.drop(writer.to)
  let left = watcher.take()
  assertEquals(left.find((f) => f.gone?.length)?.gone, ['visitor'])
  assertEquals(left.find((f) => f.id == 'count'), { id: 'count', count: 0 })
})

Deno.test('a query joins stored and peer branches without losing projection', () => {
  let graph = shop()
  graph.apply([
    { entity: { eid: 'stored' }, book: { price: 12 }, doc: { title: 'one' } },
    { entity: { eid: 'moving' }, doc: { title: 'two' } },
  ])
  let subs = subscriptions(graph)
  let writer = ear(), watcher = ear()
  subs.open(
    watcher.to,
    'near',
    '(.book.price<20|.doc&.browsing.x<10)&*',
  )
  let [first] = watcher.take()
  assertEquals(first.bundles?.map((b) => b.entity.eid), ['stored'])
  assertEquals(first.bundles?.[0].doc, { title: 'one' })

  subs.relay(writer.to, [{
    entity: { eid: 'moving' },
    browsing: { x: 2 },
  }])
  let [joined] = watcher.take()
  assertEquals(joined.bundles?.map((b) => b.entity.eid), ['moving'])
  assertEquals(joined.bundles?.[0].doc, { title: 'two' })
  assertEquals(joined.relay?.[0].browsing, { x: 2 })
})

Deno.test('async peer reads keep successive membership moves in order', async () => {
  let graph = shop()
  graph.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  let release: (() => void)[] = []
  let delayed: Graph = {
    ...graph,
    get: (ids) =>
      new Promise((resolve) =>
        release.push(() => resolve(graph.get(ids) as Bundle[]))
      ),
  }
  let subs = subscriptions(delayed)
  let writer = ear(), watcher = ear()
  subs.open(watcher.to, 'near', '.book&.browsing.x<10')
  watcher.take()
  let first = subs.relay(writer.to, [{
    entity: { eid: 'b1' },
    browsing: { x: 2 },
  }])
  let second = subs.relay(writer.to, [{
    entity: { eid: 'b1' },
    browsing: { x: 3 },
  }])
  let last = subs.relay(writer.to, [{
    entity: { eid: 'b1' },
    browsing: { x: 12 },
  }])
  release.shift()!()
  await first
  await Promise.resolve()
  await second
  await last
  let heard = watcher.take()
  assertEquals(
    heard.map((f) => f.gone?.length ? f.gone : f.relay?.[0].browsing),
    [
      { x: 2 },
      { x: 12 },
      ['b1'],
    ],
  )
})
