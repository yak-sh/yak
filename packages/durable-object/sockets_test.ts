/// <reference lib="deno.ns" />
// The plumbing: a frame opens a subscription, a commit reaches the socket, and
// — the whole reason this file exists — an object that HIBERNATED between two
// batches still serves the same client, because what it asked for was written
// on the socket rather than kept in the object's memory.

import { assert, assertEquals } from '@std/assert'
import { subscriptions } from '@yaks/api'
import { type Bundle, type Graph, graph } from '@yaks/graph'
import type { Frame } from '@yaks/api'
import { shop, store } from './harness.ts'
import { type Sockets, sockets, type Wire } from './sockets.ts'

// A socket, faked: what it was sent, and the attachment it carries across a
// hibernation.
let wire = () => {
  let sent: Frame[] = []
  let held: unknown = null
  return {
    sent,
    send: (data: string) => void sent.push(JSON.parse(data)),
    serializeAttachment: (value: unknown) => {
      held = JSON.parse(JSON.stringify(value))
    },
    deserializeAttachment: () => held,
  }
}

// The object's socket registry, faked: the runtime holds these across a
// hibernation, which is why a woken object can find them again.
let hibernation = () => {
  let live: Wire[] = []
  return {
    live,
    acceptWebSocket: (ws: Wire) => void live.push(ws),
    getWebSockets: () => live,
  }
}

// One object instance over storage that outlives it — a fresh graph, a fresh
// registry, a fresh sink map, exactly what waking up gives you.
let instance = (
  storage: ReturnType<typeof store>,
  ctx: ReturnType<typeof hibernation>,
): [Graph, Sockets] => {
  let g = graph({ storage, vocab: shop })
  return [g, sockets(subscriptions(g), ctx)]
}

let ask = (id: string, query: string) =>
  JSON.stringify({ subscribe: query, id })

Deno.test('a subscription is answered, and a commit pushes to the socket', () => {
  let ctx = hibernation()
  let [g, live] = instance(store(), ctx)
  let ws = wire()
  ctx.live.push(ws)

  live.message(ws, ask('p', '.kind=product'))
  assertEquals(ws.sent, [{ id: 'p', bundles: [] }])

  g.apply([{ entity: { eid: 'p1' }, product: { price: 3 } }])
  let last = ws.sent.at(-1)!
  assertEquals(last.id, 'p')
  assertEquals((last.bundles as Bundle[])[0].entity.eid, 'p1')
})

Deno.test('a woken object serves the socket it inherited', () => {
  let storage = store()
  let ctx = hibernation()
  let [, first] = instance(storage, ctx)
  let ws = wire()
  ctx.live.push(ws)
  first.message(ws, ask('p', '.kind=product'))
  ws.sent.length = 0

  // The object is evicted: the graph, the registry and the sink map are gone.
  // The socket, and what it asked for, are not.
  let [g, woken] = instance(storage, ctx)
  woken.wake()
  assertEquals(ws.sent, [{ id: 'p', bundles: [] }], 'the set again, on waking')

  g.apply([{ entity: { eid: 'p1' }, product: { price: 3 } }])
  assertEquals((ws.sent.at(-1)!.bundles as Bundle[])[0].entity.eid, 'p1')
})

Deno.test('unsubscribing forgets it here and on the socket', () => {
  let ctx = hibernation()
  let [g, live] = instance(store(), ctx)
  let ws = wire()
  ctx.live.push(ws)
  live.message(ws, ask('p', '.kind=product'))
  live.message(ws, JSON.stringify({ unsubscribe: 'p' }))
  ws.sent.length = 0

  g.apply([{ entity: { eid: 'p1' }, product: { price: 3 } }])
  assertEquals(ws.sent, [])
  assertEquals(ws.deserializeAttachment(), { subs: {} })
})

Deno.test('a closed socket drops its subscriptions', () => {
  let ctx = hibernation()
  let [g, live] = instance(store(), ctx)
  let ws = wire()
  ctx.live.push(ws)
  live.message(ws, ask('p', '.kind=product'))
  live.close(ws)
  ws.sent.length = 0

  g.apply([{ entity: { eid: 'p1' }, product: { price: 3 } }])
  assertEquals(ws.sent, [])
})

Deno.test('a subscription too big to survive hibernation is refused', () => {
  let ctx = hibernation()
  let [g, live] = instance(store(), ctx)
  let ws = wire()
  ctx.live.push(ws)

  live.message(ws, ask('big', `.title~=${'x'.repeat(3000)}`))
  assertEquals(ws.sent.at(-1)!.refused?.error, 'RangeError')

  g.apply([{ entity: { eid: 'p1' }, doc: { title: 'x' } }])
  assert(!ws.sent.some((f) => f.bundles?.length), 'it was closed, not kept')
})

// The runtime's socket factory is a global, so a test can stand in for it.
let pair = () => ({ 0: 'client', 1: wire() })

Deno.test('accept answers the upgrade, and refuses a plain request', () => {
  let ctx = hibernation()
  let [, live] = instance(store(), ctx)
  let made = pair()
  ;(globalThis as Record<string, unknown>).WebSocketPair = function () {
    return made
  }

  let no = live.accept(new Request('https://shop.example/ws'))
  assertEquals(no.status, 405)
  assertEquals(ctx.live.length, 0)

  let yes = live.accept(
    new Request('https://shop.example/ws', {
      headers: { upgrade: 'websocket' },
    }),
  )
  assertEquals(yes.status, 101)
  // Handed to the runtime, not accepted in this isolate: that is hibernation.
  assertEquals(ctx.live.length, 1, "the server half is the runtime's to hold")
  assertEquals(ctx.live[0], made[1])
  delete (globalThis as Record<string, unknown>).WebSocketPair
})
