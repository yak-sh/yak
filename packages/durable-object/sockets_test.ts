/// <reference lib="deno.ns" />
// The plumbing: a frame opens a subscription, a commit reaches the socket, and
// — the whole reason this file exists — an object that hibernated between two
// batches still serves the same client, because what it asked for was written
// on the socket rather than kept in the object's memory.

import { assert, assertEquals, assertThrows } from '@std/assert'
import { until } from '@yaks/testing'
import { subscriptions } from '@yaks/api'
import { type Bundle, type Graph, graph } from '@yaks/graph'
import { loadVocab, type Vocab } from '@yaks/vocab'
import type { Frame } from '@yaks/api'
import { durable, shop, store } from './testing.ts'
import { type Sockets, sockets, type Wire } from './sockets.ts'
import { holds } from './holds.ts'

// A socket, faked: what it was sent, and the attachment it carries across a
// hibernation.
let wire = () => {
  let sent: (Frame & { frames?: Frame[] })[] = []
  let closed: [number | undefined, string | undefined][] = []
  let held: unknown = null
  let writes = 0
  let state = 1
  return {
    sent,
    closed,
    writes: () => writes,
    get readyState() {
      return state
    },
    closing: () => state = 2,
    send: (data: string) => {
      if (state != 1) {
        throw new TypeError("Can't call WebSocket send() after close().")
      }
      sent.push(JSON.parse(data))
    },
    close: (code?: number, reason?: string) => {
      state = 2
      closed.push([code, reason])
    },
    serializeAttachment: (value: unknown) => {
      writes++
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
    storage: durable(),
    acceptWebSocket: (ws: Wire) => void live.push(ws),
    getWebSockets: () => live,
  }
}

// One object instance over storage that outlives it — a fresh graph, a fresh
// registry, a fresh sink map, exactly what waking up gives you.
let instance = (
  storage: ReturnType<typeof store>,
  ctx: ReturnType<typeof hibernation>,
  vocab: Vocab = shop,
  report?: (error: Error) => void,
): [Graph, Sockets] => {
  let g = graph({ storage, vocab })
  return [g, sockets(subscriptions(g), ctx, report)]
}

let ask = (id: string, query: string) =>
  JSON.stringify({ subscribe: query, id })
let send = (live: Sockets, ws: Wire, message: unknown) =>
  live.message(ws, JSON.stringify(message))

Deno.test('a subscription is answered, and a commit pushes to the socket', () => {
  let ctx = hibernation()
  let [g, live] = instance(store(), ctx)
  let ws = wire()
  ctx.live.push(ws)

  live.message(ws, ask('p', '.kind=product'))
  assertEquals(ws.sent, [{ id: 'p', bundles: [], transientReset: [] }])

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
  assertEquals(
    ws.sent,
    [{ id: 'p', bundles: [], transientReset: [], reset: true }],
    'the set again, on waking',
  )

  g.apply([{ entity: { eid: 'p1' }, product: { price: 3 } }])
  assertEquals((ws.sent.at(-1)!.bundles as Bundle[])[0].entity.eid, 'p1')
})

Deno.test('shared cold snapshots keep separate ACKs and live membership', () => {
  let storage = store(), ctx = hibernation()
  let [g, first] = instance(storage, ctx)
  g.apply([{ entity: { eid: 'p1' }, product: { price: 3 } }])
  let clients = Array.from({ length: 4 }, wire)
  ctx.live.push(...clients)
  for (let ws of clients) {
    send(first, ws, { subscribe: '.kind=product', id: 'p', acks: true })
    send(first, ws, { ack: ws.sent.at(-1)!.ack })
    ws.sent.length = 0
  }

  let [wokenGraph, woken] = instance(storage, ctx)
  woken.wake()
  let tokens = clients.map((ws) => {
    let [frame] = ws.sent
    assertEquals(frame.reset, true)
    assertEquals(frame.bundles?.map((b) => b.entity.eid), ['p1'])
    assert(typeof frame.ack == 'string')
    return frame.ack
  })
  assertEquals(new Set(tokens).size, clients.length)

  wokenGraph.apply([{ entity: { eid: 'p2' }, product: { price: 5 } }])
  assertEquals(clients.map((ws) => ws.sent.length), [1, 1, 1, 1])
  for (let [i, ws] of clients.entries()) {
    send(woken, ws, { ack: tokens[i] })
    assertEquals(ws.sent.at(-1)?.bundles?.[0].entity.eid, 'p2')
  }
})

Deno.test('acknowledgement survives hibernation and gates later pushes', () => {
  let storage = store()
  let ctx = hibernation()
  let [, first] = instance(storage, ctx)
  let ws = wire()
  ctx.live.push(ws)
  first.message(
    ws,
    JSON.stringify({
      subscribe: '.kind=product',
      id: 'p',
      acks: true,
    }),
  )
  let initial = ws.sent.at(-1)!
  assert(typeof initial.ack == 'string')
  assertEquals(ws.deserializeAttachment(), {
    subs: { p: '.kind=product' },
    acks: true,
    owed: initial.ack,
    seen: ['p'],
  })

  let [g, woken] = instance(storage, ctx)
  ws.sent.length = 0
  woken.wake()
  assertEquals(ws.sent, [])
  g.apply([{ entity: { eid: 'p1' }, product: { price: 3 } }])
  assertEquals(ws.sent, [])
  woken.message(ws, JSON.stringify({ ack: initial.ack }))
  assertEquals((ws.sent.at(-1)!.bundles as Bundle[])[0].entity.eid, 'p1')
  let change = ws.sent.at(-1)!
  send(woken, ws, { ack: change.ack })
  let [, later] = instance(storage, ctx)
  later.wake()
  assertEquals(ws.sent.at(-1)?.reset, true)
})

Deno.test('an idle socket advances past snapshots across repeated hibernation', () => {
  let storage = store(), ctx = hibernation(), ws = wire()
  ctx.live.push(ws)
  let [, first] = instance(storage, ctx)
  send(first, ws, { subscribe: '.kind=product', id: 'products', acks: true })
  send(first, ws, { subscribe: '.doc', id: 'docs', acks: true })
  let firstFrame = ws.sent.at(-1)!
  assertEquals(firstFrame.id, 'products')
  assert(typeof firstFrame.ack == 'string')

  let [, second] = instance(storage, ctx)
  second.wake()
  assertEquals(ws.sent.length, 1)
  send(second, ws, { ack: firstFrame.ack })
  let secondFrame = ws.sent.at(-1)!
  assertEquals(secondFrame.id, 'docs')
  assert(typeof secondFrame.ack == 'string')

  let [g, third] = instance(storage, ctx)
  third.wake()
  assertEquals(ws.sent.length, 2)
  send(third, ws, { ack: secondFrame.ack })
  assertEquals(ws.sent.length, 2)
  g.apply([{ entity: { eid: 'p1' }, product: { price: 3 } }])
  let change = ws.sent.at(-1)!
  assertEquals(change.id, 'products')
  assertEquals((change.bundles as Bundle[])[0].entity.eid, 'p1')
})

Deno.test('a batched socket wakes without replaying snapshots already on the wire', () => {
  let storage = store(), ctx = hibernation(), ws = wire()
  ctx.live.push(ws)
  let [, first] = instance(storage, ctx)
  for (let id of ['a', 'b', 'c']) {
    send(first, ws, {
      subscribe: '.kind=product',
      id,
      acks: true,
      frames: true,
    })
  }
  let initial = ws.sent[0]
  assertEquals(initial.frames?.map((f) => f.id), ['a'])
  send(first, ws, { ack: initial.ack })
  let batch = ws.sent[1]
  assertEquals(batch.frames?.map((f) => f.id), ['b', 'c'])
  assertEquals((ws.deserializeAttachment() as { seen: string[] }).seen, [
    'b',
    'c',
  ])

  let [, woken] = instance(storage, ctx)
  woken.wake()
  assertEquals(ws.sent.length, 2)
  send(woken, ws, { ack: batch.ack })
  assertEquals(ws.sent[2].frames?.map((f) => f.id), ['a'])
  assertEquals(ws.sent[2].frames?.[0].reset, true)
})

Deno.test('a batch stops where the socket attachment cannot remember more snapshots', () => {
  let storage = store(), ctx = hibernation(), ws = wire()
  ctx.live.push(ws)
  let [, live] = instance(storage, ctx)
  for (let n = 0; n < 30; n++) {
    let id = `${n}-${'x'.repeat(90)}`
    send(live, ws, { subscribe: '.kind=product', id, acks: true, frames: true })
  }
  send(live, ws, { ack: ws.sent[0].ack })
  let group = ws.sent[1]
  assert((group.frames?.length ?? 0) > 1)
  assert((group.frames?.length ?? 0) < 29)
  assertEquals(
    (ws.deserializeAttachment() as { seen: string[] }).seen,
    group.frames?.map((f) => f.id),
  )
})

Deno.test('an idle area subscriber hears a mover after hibernation', async () => {
  let vocab = loadVocab({
    $defs: {
      product: {
        component: true,
        properties: { price: { type: 'number' } },
      },
      position: {
        component: true,
        sync: 'peers',
        durable: 'connection',
        properties: { x: { type: 'number' } },
      },
    },
  })
  let storage = store(vocab), ctx = hibernation()
  let [g, first] = instance(storage, ctx, vocab)
  g.apply([{ entity: { eid: 'mover' }, product: { price: 3 } }])
  let idle = wire(), moving = wire()
  ctx.live.push(idle, moving)
  send(first, idle, {
    subscribe: '.product&.position.x=0...10',
    id: 'near',
    acks: true,
  })
  let initial = idle.sent.at(-1)!
  send(first, idle, { ack: initial.ack })
  send(first, moving, {
    relay: [{ entity: { eid: 'mover' }, position: { x: 2 } }],
  })
  let joined = idle.sent.at(-1)!
  assertEquals(joined.bundles?.[0].entity.eid, 'mover')

  let [, woken] = instance(storage, ctx, vocab)
  woken.wake()
  send(woken, moving, {
    relay: [{ entity: { eid: 'mover' }, position: { x: 3 } }],
  })
  assertEquals(idle.sent.at(-1), joined)
  send(woken, idle, { ack: joined.ack })
  let reset = idle.sent.at(-1)!
  assertEquals(reset.reset, true)
  send(woken, idle, { ack: reset.ack })
  await until(() => idle.sent.length >= 4)
  let latest = idle.sent.at(-1)!
  assertEquals(latest.relay?.[0].position, { x: 3 })
  assert(typeof latest.ack == 'string') // the membership join is replayed
  send(woken, idle, { ack: latest.ack })
  let writes = idle.writes()
  send(woken, moving, {
    relay: [{ entity: { eid: 'mover' }, position: { x: 4 } }],
  })
  await until(() => idle.sent.length >= 5)
  let peer = idle.sent.at(-1)!
  assertEquals(peer.relay?.[0].position, { x: 4 })
  assertEquals(peer.ack, undefined)
  assertEquals(idle.writes(), writes)
})

Deno.test('repointing a subscription invalidates its earlier snapshot', () => {
  let storage = store(), ctx = hibernation(), ws = wire()
  ctx.live.push(ws)
  let [, first] = instance(storage, ctx)
  send(first, ws, { subscribe: '.kind=product', id: 'one', acks: true })
  let old = ws.sent.at(-1)!
  send(first, ws, { subscribe: '.doc', id: 'one', acks: true })
  let [, woken] = instance(storage, ctx)
  woken.wake()
  send(woken, ws, { ack: old.ack })
  assertEquals(ws.sent.length, 2)
  assertEquals(ws.sent.at(-1)?.reset, true)
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

Deno.test('a socket closing before its close event does not break a commit', () => {
  let ctx = hibernation()
  let [g, live] = instance(store(), ctx)
  let ws = wire()
  ctx.live.push(ws)
  live.message(ws, ask('p', '.kind=product'))
  ws.closing()

  g.apply([{ entity: { eid: 'p1' }, product: { price: 3 } }])
  live.message(ws, ask('q', '.kind=product'))
  assertEquals(ws.sent.length, 1)
  live.close(ws)
})

Deno.test('wake ignores a closing socket still returned by the runtime', () => {
  let storage = store(), ctx = hibernation(), ws = wire()
  ctx.live.push(ws)
  let [, first] = instance(storage, ctx)
  first.message(ws, ask('p', '.kind=product'))
  first.close(ws)
  ws.close(1000, 'deleted')

  let [g, woken] = instance(storage, ctx)
  woken.wake()
  g.apply([{ entity: { eid: 'p1' }, product: { price: 3 } }])
  assertEquals(ws.sent.length, 1)
})

Deno.test('a subscription bigger than an attachment survives hibernation', () => {
  let ctx = hibernation(), storage = store()
  let [, live] = instance(storage, ctx)
  let ws = wire()
  ctx.live.push(ws)

  let title = 'x'.repeat(3000)
  send(live, ws, {
    subscribe: `.doc.title=${JSON.stringify(title)}`,
    id: 'big',
    acks: true,
  })
  assert(!ws.sent.some((f) => f.refused))
  let first = ws.sent.at(-1)!
  let ref = (ws.deserializeAttachment() as { subref?: string }).subref!
  assert(ref)
  assertEquals(Object.keys(holds(ctx.storage).read(ref)), ['big'])

  let [g, woken] = instance(storage, ctx)
  woken.wake()
  assertEquals(ws.sent.length, 1, 'the first snapshot still needs its ACK')
  g.apply([{ entity: { eid: 'p1' }, doc: { title } }])
  assertEquals(ws.sent.length, 1, 'the push waits for the ACK')
  send(woken, ws, { ack: first.ack })
  assertEquals(ws.sent.at(-1)?.bundles?.[0].entity.eid, 'p1')

  send(woken, ws, { unsubscribe: 'big' })
  assertThrows(() => holds(ctx.storage).read(ref), Error, 'missing')
  assertEquals((ws.deserializeAttachment() as { subs?: object }).subs, {})

  send(woken, ws, {
    subscribe: `.doc.title=${JSON.stringify(title)}`,
    id: 'again',
    acks: true,
  })
  let later = (ws.deserializeAttachment() as { subref?: string }).subref!
  assert(later)
  woken.close(ws)
  assertThrows(() => holds(ctx.storage).read(later), Error, 'missing')
  assertEquals(
    (ws.deserializeAttachment() as { subref?: string }).subref,
    undefined,
  )
})

Deno.test('a lost subscription row retires its socket without blocking other subscribers', () => {
  let storage = store(), ctx = hibernation()
  let [, first] = instance(storage, ctx)
  let stale = wire(), healthy = wire()
  ctx.live.push(stale, healthy)
  send(first, stale, {
    subscribe: `.doc.title=${JSON.stringify('x'.repeat(3000))}`,
    id: 'big',
  })
  send(first, healthy, { subscribe: '.kind=product', id: 'p' })
  let ref = (stale.deserializeAttachment() as { subref: string }).subref
  holds(ctx.storage).delete(ref)

  let errors: Error[] = []
  let [g, woken] = instance(storage, ctx, shop, (error) => errors.push(error))
  woken.wake()
  assertEquals(stale.closed, [[1012, 'subscriptions lost']])
  assertEquals(errors.map((error) => error.message), [
    `socket subscriptions missing: ${ref}`,
  ])
  assertEquals(
    (stale.deserializeAttachment() as { subref?: string }).subref,
    undefined,
  )
  assertEquals(healthy.sent.at(-1)?.reset, true)
  let sent = stale.sent.length
  g.apply([{ entity: { eid: 'p1' }, product: { price: 3 } }])
  assertEquals(stale.sent.length, sent)
  assertEquals(healthy.sent.at(-1)?.bundles?.[0].entity.eid, 'p1')

  // The runtime may still enumerate a socket while its close is in flight.
  let [, later] = instance(storage, ctx)
  later.wake()
  assertEquals(stale.closed.length, 1)
})

Deno.test('a frame on a hibernated socket with a lost row closes it', () => {
  let storage = store(), ctx = hibernation(), ws = wire()
  ctx.live.push(ws)
  let [, first] = instance(storage, ctx)
  send(first, ws, {
    subscribe: `.doc.title=${JSON.stringify('x'.repeat(3000))}`,
    id: 'big',
  })
  let ref = (ws.deserializeAttachment() as { subref: string }).subref
  holds(ctx.storage).delete(ref)

  let [, woken] = instance(storage, ctx)
  send(woken, ws, { ack: 'unknown' })
  assertEquals(ws.closed, [[1012, 'subscriptions lost']])
})

Deno.test('a hibernated frame includes subscription restore in its scope', () => {
  let ctx = hibernation(), storage = store()
  let [, first] = instance(storage, ctx)
  let ws = wire()
  ctx.live.push(ws)
  first.message(
    ws,
    ask('big', `.doc.title=${JSON.stringify('x'.repeat(3000))}`),
  )
  let [, woken] = instance(storage, ctx)
  let exec = ctx.storage.sql.exec.bind(ctx.storage.sql)
  let active = ''
  let seen: string[] = []
  ctx.storage.sql.exec = (query, ...bindings) => {
    seen.push(active)
    return exec(query, ...bindings)
  }
  woken.message(
    ws,
    JSON.stringify({ ack: 'unknown' }),
    (kind, work) => {
      active = kind
      try {
        work()
      } finally {
        active = ''
      }
    },
  )
  assert(seen.length > 0)
  assertEquals(seen, Array(seen.length).fill('ack'))
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
