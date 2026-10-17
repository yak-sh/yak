/// <reference lib="deno.ns" />
// The plumbing: a frame opens a subscription, a commit reaches the socket, and
// — the whole reason this file exists — an object that hibernated between two
// batches still serves the same client, because what it asked for was written
// on the socket rather than kept in the object's memory.

import { assert, assertEquals, assertThrows } from '@std/assert'
import { test, until } from '@yaks/testing'
import { map as queryMap } from '@yaks/query'
import { type Subs, subscriptions as subscribed } from '@yaks/api'
import {
  type Bundle,
  derivedEid,
  type Graph,
  graph,
  type Storage,
} from '@yaks/graph'
import { ram } from '@yaks/ram'
import { pack } from './watches.ts'
import { loadVocab, type Vocab } from '@yaks/vocab'
import type { Frame } from '@yaks/api'
import { durable, shop, store } from './testing.ts'
import { type Sockets, sockets, type Wire } from './sockets.ts'
import { holds } from './holds.ts'

let PERSON = derivedEid('fixture:person')
let TAB = derivedEid('fixture:tab')

// A relay batch or a save's timer, due as soon as what is running settles: the
// pause it would wait in a socket's object is no part of what is checked here.
let soon = (fn: () => void) => {
  let due = true
  queueMicrotask(() => due && fn())
  return () => void (due = false)
}
let subscriptions = (g: Parameters<typeof subscribed>[0]) =>
  subscribed(g, { timer: soon })

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
  let storage: ReturnType<typeof durable> | undefined
  return {
    live,
    // what an incarnation put off: its timers, which run before it can sleep
    owed: [] as (() => void)[],
    // opened by the first socket whose queries outgrow its attachment
    get storage() {
      return storage ??= durable()
    },
    acceptWebSocket: (ws: Wire) => void live.push(ws),
    getWebSockets: () => live,
  }
}

// One object instance over storage that outlives it — a fresh graph, a fresh
// registry, a fresh sink map, exactly what waking up gives you.
let instance = (
  storage: Storage,
  ctx: ReturnType<typeof hibernation>,
  vocab: Vocab = shop,
  report?: (error: Error) => void,
): [Graph, Sockets] => {
  // An object hibernates only once its timers have run, so the incarnation
  // before this one has written what it put off.
  for (let write of ctx.owed.splice(0)) write()
  let g = graph({ storage, vocab })
  return [
    g,
    sockets(subscriptions(g), ctx, report, {
      defer: (write) => void ctx.owed.push(write),
    }),
  ]
}

let ask = (id: string, query: string) =>
  JSON.stringify({ subscribe: query, id })
let send = (live: Sockets, ws: Wire, message: unknown) =>
  live.message(ws, JSON.stringify(message))

test('hibernating clock probes do not recover attachments or touch subscriptions and storage', () => {
  let untouched = new Proxy({}, {
    get: () => {
      throw new Error('clock exchange touched durable state')
    },
  })
  let ws = wire()
  ws.deserializeAttachment = () => {
    throw new Error('clock read attachment')
  }
  let live = sockets(untouched as Subs, {
    storage: untouched as ReturnType<typeof durable>,
    acceptWebSocket: () => {},
    getWebSockets: () => [ws],
  })
  let before = Date.now()
  send(live, ws, { clock: 12.5 })
  let [reply] = ws.sent as unknown as {
    clock: number
    received: number
    sent: number
  }[]
  assertEquals(reply.clock, 12.5)
  assert(reply.received >= before)
  assert(reply.sent >= reply.received && reply.sent <= Date.now())
  assertEquals(ws.writes(), 0)
  ws.closing()
  send(live, ws, { clock: 0 })
  assertEquals(ws.sent.length, 1)
})

// A socket whose snapshot awaits its ACK, with a commit's frame held behind it.
let heldFixture = (() => {
  let ctx = hibernation()
  let [g, live] = instance(ram(shop), ctx)
  let ws = wire()
  ctx.live.push(ws)
  send(live, ws, { subscribe: '.kind=product', id: 'p', acks: true })
  let [first] = ws.sent.splice(0)
  g.apply([{ entity: { eid: 'p1' }, product: { price: 3 } }])
  return { ws, live, first }
})()
test('a hibernating clock reply bypasses a held acknowledgement and preserves it', () => {
  let { ws, live, first } = heldFixture
  assertEquals(ws.sent, [])
  let writes = ws.writes()
  send(live, ws, { clock: 0 })
  assertEquals(ws.sent.length, 1)
  assertEquals((ws.sent[0] as unknown as { clock: number }).clock, 0)
  assertEquals(ws.writes(), writes)
  send(live, ws, { ack: first.ack })
  assertEquals(ws.sent[1].id, 'p')
  assertEquals((ws.sent[1].bundles as Bundle[])[0].entity.eid, 'p1')
})

test('a subscription is answered, and a commit pushes to the socket', () => {
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

test('hibernating sockets refuse oversized and malformed messages without retiring', () => {
  let ctx = hibernation()
  let [g, live] = instance(store(), ctx)
  let ws = wire()
  ctx.live.push(ws)
  live.message(ws, ask('good', '.kind=product'))
  ws.sent.length = 0
  live.message(ws, ask('large', '.product.price=' + '1'.repeat(65536)))
  live.message(ws, '{"id":"broken","subscribe":')
  assertEquals(ws.sent.map((f) => f.id), ['large', 'broken'])
  assert(ws.sent.every((f) => f.refused))
  assertEquals(ws.closed, [])
  g.apply([{ entity: { eid: 'p1' }, product: { price: 3 } }])
  assertEquals(ws.sent.at(-1)!.id, 'good')
})

test('a woken object serves the socket it inherited', () => {
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

test('a woken socket saves and finishes values as its vouched writer', async () => {
  let vocab = loadVocab({
    $defs: {
      hero: { component: true, properties: { name: { type: 'string' } } },
      position: {
        component: true,
        sync: 'peers',
        durable: 'forever',
        save: '.hero',
        properties: { x: { type: 'number' } },
      },
      created: {
        component: true,
        properties: {
          at: { type: 'string', format: 'date-time' },
          by: { type: 'string' },
          via: { type: 'string' },
        },
      },
      updated: {
        component: true,
        properties: {
          at: { type: 'string', format: 'date-time' },
          by: { type: 'string' },
          via: { type: 'string' },
        },
      },
    },
  })
  let storage = store(vocab), ctx = hibernation(), ws = wire()
  ctx.live.push(ws)
  ws.serializeAttachment({ writer: { actor: { by: PERSON, via: TAB } } })
  let [initial, first] = instance(storage, ctx, vocab)
  initial.apply([{ entity: { eid: 'hero' }, hero: { name: 'Hero' } }])
  first.message(ws, ask('hero', '.entity.eid=hero'))
  let [g, woken] = instance(storage, ctx, vocab)
  woken.wake()
  send(woken, ws, {
    relay: [{
      entity: { eid: 'hero' },
      position: { x: 1 },
      $actor: { via: 'forged' },
    }],
  })
  await until(() => (g.get(['hero']) as Bundle[])[0]?.position != null)
  send(woken, ws, { relay: [{ entity: { eid: 'hero' }, position: { x: 2 } }] })
  await woken.close(ws)
  let [row] = g.get(['hero']) as Bundle[]
  assertEquals(row.position, { x: 2 })
  assertEquals((row.updated as { by: string }).by, PERSON)
  assertEquals((row.updated as { via: string }).via, TAB)
})

test('a legacy socket answers reads and reconnects before every relay', () => {
  let ctx = hibernation(), ws = wire()
  ctx.live.push(ws)
  let g = graph({ storage: store(), vocab: shop })
  let subs = subscriptions(g)
  let live = sockets({
    ...subs,
    save: (comp) => comp == 'position' ? '.hero' : null,
  }, ctx)
  send(live, ws, { subscribe: '.entity', id: 'legacy' })
  assertEquals(ws.closed, [])
  assertEquals(ws.sent[0].id, 'legacy')
  send(live, ws, { relay: [{ entity: { eid: 'hero' }, browsing: { x: 1 } }] })
  assertEquals(ws.closed, [[1012, 'writer handshake required']])
})

test('shared cold snapshots keep separate ACKs and live membership', () => {
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

test('acknowledgement survives hibernation and gates later pushes', () => {
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

test('an idle socket advances past snapshots across repeated hibernation', () => {
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

test('a batched socket wakes without replaying snapshots already on the wire', () => {
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

test('a batch stops where the socket attachment cannot remember more snapshots', () => {
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

test('an idle area subscriber hears a mover after hibernation', async () => {
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
  moving.serializeAttachment({
    writer: { actor: { by: PERSON, via: TAB } },
  })
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
  await until(() => idle.sent.at(-1)?.bundles?.[0]?.entity.eid == 'mover')
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

test('repointing a subscription invalidates its earlier snapshot', () => {
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

test('unsubscribing forgets it here and on the socket', () => {
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

test('a closed socket drops its subscriptions', () => {
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

test('a socket closing before its close event does not break a commit', () => {
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

test('wake ignores a closing socket still returned by the runtime', () => {
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

test('a subscription bigger than an attachment survives hibernation', () => {
  let ctx = hibernation(), storage = store()
  let [, live] = instance(storage, ctx)
  let ws = wire()
  ctx.live.push(ws)

  let title = compactTitle
  send(live, ws, {
    subscribe: `.doc.title=${JSON.stringify(title)}`,
    id: 'big',
    acks: true,
  })
  assert(!ws.sent.some((f) => f.refused))
  let first = ws.sent.at(-1)!
  let ref = (ws.deserializeAttachment() as { subref?: string }).subref!
  assert(ref)

  let [g, woken] = instance(storage, ctx)
  assertEquals(Object.keys(holds(ctx.storage).read(ref)), ['big'])
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

test('a burst of watch changes stores its map once', () => {
  let ctx = hibernation(), storage = store(), ws = wire()
  ctx.live.push(ws)
  let stored = 0, exec = ctx.storage.sql.exec.bind(ctx.storage.sql)
  ctx.storage.sql.exec = (query, ...bindings) => {
    if (/^insert into "socket_subscriptions"/.test(query)) stored++
    return exec(query, ...bindings)
  }
  let title = (n: number) => `${compactTitle}${n}`
  let [, live] = instance(storage, ctx)
  for (let n = 0; n < 4; n++) {
    send(live, ws, {
      subscribe: `.doc.title=${JSON.stringify(title(n))}`,
      id: `t${n}`,
    })
  }
  send(live, ws, { unsubscribe: 't0' })
  assertEquals(stored, 0)

  let [g, woken] = instance(storage, ctx)
  assertEquals(stored, 1)
  woken.wake()
  let sent = ws.sent.length
  g.apply([
    { entity: { eid: 'kept' }, doc: { title: title(2) } },
    { entity: { eid: 'dropped' }, doc: { title: title(0) } },
  ])
  assertEquals(
    ws.sent.slice(sent).map((f) => [f.id, f.bundles?.[0].entity.eid]),
    [['t2', 'kept']],
  )
})

test('a lost subscription row retires its socket without blocking other subscribers', () => {
  let storage = store(), ctx = hibernation()
  let [, first] = instance(storage, ctx)
  let stale = wire(), healthy = wire()
  ctx.live.push(stale, healthy)
  send(first, stale, {
    subscribe: `.doc.title=${JSON.stringify(compactTitle)}`,
    id: 'big',
  })
  send(first, healthy, { subscribe: '.kind=product', id: 'p' })
  let ref = (stale.deserializeAttachment() as { subref: string }).subref
  for (let write of ctx.owed.splice(0)) write()
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

test('a frame on a hibernated socket with a lost row closes it', () => {
  let storage = store(), ctx = hibernation(), ws = wire()
  ctx.live.push(ws)
  let [, first] = instance(storage, ctx)
  send(first, ws, {
    subscribe: `.doc.title=${JSON.stringify(compactTitle)}`,
    id: 'big',
  })
  let ref = (ws.deserializeAttachment() as { subref: string }).subref
  for (let write of ctx.owed.splice(0)) write()
  holds(ctx.storage).delete(ref)

  let [, woken] = instance(storage, ctx)
  send(woken, ws, { ack: 'unknown' })
  assertEquals(ws.closed, [[1012, 'subscriptions lost']])
})

test('a hibernated frame includes subscription restore in its scope', () => {
  let ctx = hibernation(), storage = store()
  let [, first] = instance(storage, ctx)
  let ws = wire()
  ctx.live.push(ws)
  first.message(
    ws,
    ask('big', `.doc.title=${JSON.stringify(compactTitle)}`),
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

test('accept answers the upgrade, and refuses a plain request', () => {
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

test('a caller view survives socket acceptance and hibernation', () => {
  let storage = store(), ctx = hibernation(), made = pair()
  let create = () => {
    let g = graph({ storage, vocab: shop })
    g.use({
      name: 'old-reader',
      reads: (opts) => opts.speaks?.shop == 0,
      ask: (_ctx, ast) =>
        queryMap(
          ast,
          (c) =>
            c.kind == 'pred' && c.path.join('.') == 'product.cost'
              ? { ...c, path: ['product', 'price'] }
              : c,
        ),
      answer: (_ctx, rows) =>
        rows.map((b) => {
          if (!b.product) return b
          let { price, ...product } = b.product as Record<string, unknown>
          return { ...b, product: { ...product, cost: price } }
        }),
    })
    return [g, sockets(subscriptions(g), ctx)] as const
  }
  let [g, first] = create()
  g.apply([{ entity: { eid: 'p1' }, product: { price: 3 } }])
  ;(globalThis as Record<string, unknown>).WebSocketPair = function () {
    return made
  }
  try {
    first.accept(
      new Request('https://shop.example/ws', {
        headers: { upgrade: 'websocket' },
      }),
      { speaks: { shop: 0 } },
    )
  } finally {
    delete (globalThis as Record<string, unknown>).WebSocketPair
  }
  first.message(made[1], ask('p', '.product.cost<5'))
  assertEquals(
    (made[1].sent.at(-1)!.bundles?.[0].product as Record<string, unknown>).cost,
    3,
  )
  assert(
    !Object.hasOwn(made[1].sent.at(-1)!.bundles![0].product as object, 'price'),
  )
  made[1].sent.length = 0
  let [wokenGraph, woken] = create()
  woken.wake()
  assertEquals(made[1].sent[0].reset, true)
  assertEquals(
    (made[1].sent[0].bundles?.[0].product as Record<string, unknown>).cost,
    3,
  )
  wokenGraph.apply([{ entity: { eid: 'p1' }, product: { price: 4 } }])
  assertEquals(
    (made[1].sent.at(-1)!.bundles?.[0].product as Record<string, unknown>).cost,
    4,
  )
  wokenGraph.apply([{ entity: { eid: 'p1' }, product: { price: 8 } }])
  assertEquals(made[1].sent.at(-1)!.gone, ['p1'])
})

test('hibernation hydrates saved positions only under surviving socket keys before watches reopen', async () => {
  let vocab = loadVocab({
    $defs: {
      hero: { component: true, properties: { name: { type: 'string' } } },
      position: {
        component: true,
        sync: 'peers',
        durable: 'forever',
        save: '.hero',
        properties: { x: { type: 'number' } },
      },
    },
  })
  let storage = store(vocab), ctx = hibernation(), ws = wire(), watcher = wire()
  ctx.live.push(ws, watcher)
  ws.serializeAttachment({
    writer: {},
    relay: ['held position'],
  })
  watcher.serializeAttachment({ subs: { positions: '.hero .position' } })
  let initial = graph({ storage, vocab })
  initial.apply([
    { entity: { eid: 'held' }, hero: { name: 'Held' }, position: { x: 1 } },
    {
      entity: { eid: 'offline' },
      hero: { name: 'Offline' },
      position: { x: 2 },
    },
  ])
  let g = graph({ storage, vocab })
  let subs = subscriptions({
    ...g,
    get: async (...args) => await g.get(...args),
  })
  let live = sockets(subs, ctx)
  await live.wake()
  assertEquals(watcher.sent[0].bundles?.map((b) => b.entity.eid), ['held'])
  assertEquals(watcher.sent[0].relay?.[0].position, { x: 1 })
  assertEquals((await subs.read('.hero .position')).map((b) => b.entity.eid), [
    'held',
  ])
  await live.close(ws)
  assertEquals(await subs.read('.hero .position'), [])
  assertEquals(
    (await subs.read('.hero .position', { durable: true })).length,
    2,
  )
})

test('cold peer frames register static interests without reading their old snapshots', async () => {
  let vocab = loadVocab([...shop.docs, {
    $defs: {
      cursor: {
        component: true,
        type: 'object',
        sync: 'peers',
        durable: 'connection',
        properties: { x: { type: 'number' } },
      },
    },
  }])
  let storage = store(vocab), ctx = hibernation(), ws = wire()
  ctx.live.push(ws)
  ws.serializeAttachment({ writer: { actor: {} } })
  let [g, first] = instance(storage, ctx, vocab)
  await g.apply([{ entity: { eid: 'p' }, product: { price: 1 } }])
  await first.message(ws, ask('products', '.product'))
  ws.sent.length = 0
  let cold = graph({ storage, vocab }), reads = 0
  let spy: Graph = {
    ...cold,
    read: (q, o) => {
      reads++
      return cold.read(q, o)
    },
  }
  let live = sockets(subscriptions(spy), ctx, undefined, { deferStatic: true })
  await live.message(
    ws,
    JSON.stringify({
      relay: [{ entity: { eid: 'cursor' }, cursor: { x: 1 } }],
    }),
  )
  assertEquals(reads, 0)
  assertEquals(ws.sent, [])
  await cold.apply([{ entity: { eid: 'p' }, product: { price: 9 } }])
  // Drain the same ordered registry after its committed notification.
  await live.message(
    ws,
    JSON.stringify({
      relay: [{ entity: { eid: 'cursor' }, cursor: { x: 2 } }],
    }),
  )
  let reset = ws.sent.find((f) => f.id == 'products')!
  assertEquals(reset.reset, true)
  assertEquals(
    ((reset.bundles as Bundle[])[0].product as { price: number }).price,
    9,
  )
  reads = 0
  await cold.apply([{ entity: { eid: 'p' }, product: { price: 10 } }])
  await live.message(
    ws,
    JSON.stringify({
      relay: [{ entity: { eid: 'cursor' }, cursor: { x: 3 } }],
    }),
  )
  assertEquals(reads, 0)
})

test('deferred cold catalog resets empty after deletion and is never revived after unsubscribe', async () => {
  let vocab = loadVocab([...shop.docs, {
    $defs: {
      cursor: {
        component: true,
        type: 'object',
        sync: 'peers',
        durable: 'connection',
        properties: { x: { type: 'number' } },
      },
    },
  }])
  let storage = store(vocab), ctx = hibernation(), ws = wire()
  ctx.live.push(ws)
  ws.serializeAttachment({ writer: { actor: {} } })
  let [g, first] = instance(storage, ctx, vocab)
  await g.apply([{ entity: { eid: 'p' }, product: { price: 1 } }])
  await first.message(ws, ask('products', '.product'))
  ws.sent.length = 0
  let cold = graph({ storage, vocab }),
    subs = subscriptions(cold),
    live = sockets(subs, ctx, undefined, { deferStatic: true })
  await live.message(
    ws,
    JSON.stringify({ relay: [{ entity: { eid: 'c' }, cursor: { x: 1 } }] }),
  )
  await cold.apply([{ entity: { eid: 'p' }, $delete: true }])
  await subs.snapshot('.product')
  let frame = ws.sent.find((f) => f.id == 'products')!
  assertEquals(frame.reset, true)
  assertEquals(frame.bundles, [])
  ws.sent.length = 0
  await live.message(ws, JSON.stringify({ unsubscribe: 'products' }))
  await cold.apply([{ entity: { eid: 'p' }, product: { price: 2 } }])
  await subs.snapshot('.product')
  assertEquals(ws.sent, [])
})

test('explicit read wake answers a deferred cold catalog immediately', async () => {
  let vocab = loadVocab([...shop.docs, {
    $defs: {
      cursor: {
        component: true,
        type: 'object',
        sync: 'peers',
        durable: 'connection',
        properties: { x: { type: 'number' } },
      },
    },
  }])
  let storage = store(vocab), ctx = hibernation(), ws = wire()
  ctx.live.push(ws)
  ws.serializeAttachment({ writer: { actor: {} } })
  let [g, first] = instance(storage, ctx, vocab)
  await g.apply([{ entity: { eid: 'p' }, product: { price: 1 } }])
  await first.message(ws, ask('products', '.product'))
  ws.sent.length = 0
  let cold = graph({ storage, vocab }),
    live = sockets(subscriptions(cold), ctx, undefined, { deferStatic: true })
  await live.message(
    ws,
    JSON.stringify({ relay: [{ entity: { eid: 'c' }, cursor: { x: 1 } }] }),
  )
  assertEquals(ws.sent, [])
  await live.wake()
  assertEquals(ws.sent[0].id, 'products')
  assertEquals(ws.sent[0].reset, true)
})

test('a deferred cold reset waits for its inherited snapshot ACK without losing the durable edit', async () => {
  let vocab = loadVocab([...shop.docs, {
    $defs: {
      cursor: {
        component: true,
        type: 'object',
        sync: 'peers',
        durable: 'connection',
        properties: { x: { type: 'number' } },
      },
    },
  }])
  let storage = store(vocab), ctx = hibernation(), ws = wire()
  ctx.live.push(ws)
  ws.serializeAttachment({ writer: { actor: {} } })
  let [g, first] = instance(storage, ctx, vocab)
  await g.apply([{ entity: { eid: 'p' }, product: { price: 1 } }])
  await first.message(
    ws,
    JSON.stringify({ subscribe: '.product', id: 'products', acks: true }),
  )
  let ack = ws.sent[0].ack!
  assertEquals(typeof ack, 'string')
  ws.sent.length = 0
  let cold = graph({ storage, vocab }),
    subs = subscriptions(cold),
    live = sockets(subs, ctx, undefined, { deferStatic: true })
  await live.message(
    ws,
    JSON.stringify({ relay: [{ entity: { eid: 'c' }, cursor: { x: 1 } }] }),
  )
  assertEquals(ws.sent, [])
  await cold.apply([{ entity: { eid: 'p' }, product: { price: 7 } }])
  await subs.snapshot('.product')
  assertEquals(ws.sent, [])
  await live.message(ws, JSON.stringify({ ack }))
  assertEquals(ws.sent.length, 1)
  assertEquals(ws.sent[0].reset, true)
  assertEquals(
    ((ws.sent[0].bundles as Bundle[])[0].product as { price: number }).price,
    7,
  )
})

for (let person of ['bob', null]) {
  let storage = store(), ctx = hibernation(), ws = wire()
  let g = graph({ storage, vocab: shop }),
    seen: (string | null | undefined)[] = []
  g.apply([{ entity: { eid: 'private' }, product: { price: 3 } }])
  g.use({
    name: 'socket-person',
    reads: (read) => read.person !== undefined,
    answer: ({ opts }, rows) => {
      seen.push(opts.person)
      return rows
    },
  })
  ws.serializeAttachment({
    writer: { actor: person ? { by: person } : null },
    subs: { products: '.product' },
  })
  ctx.live.push(ws)
  let live = sockets(subscriptions(g), ctx, undefined, {
    read: (read, writer) => ({ ...read, person: writer?.actor?.by ?? null }),
  })
  test(`legacy hibernated ${person ?? 'guest'} watches recover authenticated read identity`, () => {
    live.wake()
    live.message(ws, ask('again', '.product'))
    assert(seen.length >= 2)
    assertEquals(new Set(seen), new Set([person]))
  })
}

let deltaFixture = (() => {
  let storage = ram(shop), ctx = hibernation(), ws = wire()
  ctx.live.push(ws)
  holds(ctx.storage).write('baseline', {
    old: '.doc.title=old',
    kept: '.kind=product',
  })
  ws.serializeAttachment({
    subref: 'baseline',
    subdelta: {
      old: null,
      newer: '.doc.title=new',
      ['__proto__']: '.doc.title=proto',
    },
  })
  let [g, live] = instance(storage, ctx)
  live.wake()
  return { storage, ctx, ws, g, live }
})()
test('a woken socket applies stored watch additions and removals', () => {
  let { ws, g } = deltaFixture
  assertEquals(ws.sent.map((f) => f.id), ['kept', 'newer', '__proto__'])
  ws.sent.length = 0
  g.apply([
    { entity: { eid: 'old' }, doc: { title: 'old' } },
    { entity: { eid: 'new' }, doc: { title: 'new' } },
    { entity: { eid: 'proto' }, doc: { title: 'proto' } },
  ])
  assertEquals(
    ws.sent.map((f) => [f.id, f.bundles?.map((b) => b.entity.eid)]),
    [
      ['newer', ['new']],
      ['__proto__', ['proto']],
    ],
  )
})
test('changing a decoded watch map preserves its remaining interests', () => {
  let { storage, ctx, ws, live } = deltaFixture
  send(live, ws, { unsubscribe: 'newer' })
  let [, woken] = instance(storage, ctx)
  ws.sent.length = 0
  woken.wake()
  assertEquals(ws.sent.map((f) => f.id), ['kept', '__proto__'])
})

// A socket whose attachment holds its watches as a stored map and a packed
// change to it: `old` removed, `current` added.
let packedFixture = () => {
  let storage = ram(shop), ctx = hibernation(), ws = wire()
  ctx.live.push(ws)
  holds(ctx.storage).write('packed', { old: '.doc.title=old' })
  ws.serializeAttachment({
    subref: 'packed',
    subdelta: pack({ old: null, current: '.kind=product' }),
  })
  let [g, live] = instance(storage, ctx)
  return { ws, g, live }
}

let packed = packedFixture()
test('compressed watch changes restore their exact interests', () => {
  let { ws, live } = packed
  live.wake()
  assertEquals(ws.sent.map((f) => f.id), ['current'])
})

let unpacked = packedFixture()
unpacked.live.wake()
unpacked.ws.sent.length = 0
test('a watch restored from compressed changes hears what it selects', () => {
  let { ws, g } = unpacked
  g.apply([{ entity: { eid: 'p' }, product: { price: 1 } }])
  assertEquals(ws.sent.map((f) => [f.id, f.bundles?.[0].entity.eid]), [
    ['current', 'p'],
  ])
})

let watched = (queries: Record<string, string>) => {
  let storage = ram(shop), ctx = hibernation(), ws = wire()
  ctx.live.push(ws)
  let written = 0, reads = 0, exec = ctx.storage.sql.exec.bind(ctx.storage.sql)
  ctx.storage.sql.exec = (sql, ...bindings) => {
    if (/^insert into "socket_subscriptions"/.test(sql)) written++
    if (/^select.*"socket_subscriptions"/.test(sql)) reads++
    return exec(sql, ...bindings)
  }
  let [, live] = instance(storage, ctx)
  for (let [id, subscribe] of Object.entries(queries)) {
    send(live, ws, { subscribe, id })
  }
  for (let write of ctx.owed.splice(0)) write()
  return { storage, ctx, ws, live, written: () => written, reads: () => reads }
}

let namedFixture = (() => {
  let ready = watched(Object.fromEntries([
    ['constructor', '.doc.title=old'],
    ['__proto__', '.doc.title=old'],
    ['static', `.doc.title="${'base'.repeat(700)}"`],
  ]))
  let { storage, ctx, ws, live } = ready
  send(live, ws, { unsubscribe: 'constructor' })
  send(live, ws, { subscribe: '.doc.title=latest', id: '__proto__' })
  let [g, woken] = instance(storage, ctx)
  ws.sent.length = 0
  woken.wake()
  return { ...ready, g }
})()
test('prototype-named watches retain replacements and removals after hibernation', () => {
  let { ws, g } = namedFixture
  assertEquals(ws.sent.map((f) => f.id), ['__proto__', 'static'])
  ws.sent.length = 0
  g.apply([
    { entity: { eid: 'old' }, doc: { title: 'old' } },
    { entity: { eid: 'new' }, doc: { title: 'latest' } },
  ])
  assertEquals(
    ws.sent.map((f) => [f.id, f.bundles?.map((b) => b.entity.eid)]),
    [
      ['__proto__', ['new']],
    ],
  )
})

let serialFixture = (() => {
  let storage = ram(shop), ctx = hibernation(), ws = wire()
  ctx.live.push(ws)
  let [, live] = instance(storage, ctx)
  send(live, ws, {
    subscribe: `.doc.title="${'base'.repeat(700)}"`,
    id: 'static',
    acks: true,
  })
  for (let write of ctx.owed.splice(0)) write()
  send(live, ws, {
    subscribe: `.doc.title="${'x'.repeat(1100)}"`,
    id: 'moving',
    acks: true,
  })
  let ids = ['static', 'moving']
  for (let n = 0; n < 10; n++) {
    let id = `watch-${n}-${'a'.repeat(30)}`
    ids.push(id)
    send(live, ws, { subscribe: '.product', id, acks: true })
  }
  return { ws, live, ids }
})()
test('serial snapshot acknowledgements fit the attachment through their complete chain', () => {
  let { ws, live, ids } = serialFixture
  for (let n = 0; n < ids.length; n++) {
    send(live, ws, { ack: ws.sent[n].ack })
  }
  assertEquals(ws.sent.map((f) => f.id), ids)
  assert(ws.sent.every((f) => !f.refused))
})

let firstTitle = `first${'a'.repeat(3000)}`
let latestTitle = `latest${'b'.repeat(3000)}`
let movingFixture = (() => {
  let ready = watched(Object.fromEntries(
    Array.from({ length: 6 }, (_, n) => [
      `static${n}`,
      `.doc.title="${String(n).repeat(600)}"`,
    ]),
  ))
  let { storage, ctx, ws, live } = ready
  send(live, ws, { unsubscribe: 'static0' })
  send(live, ws, { subscribe: `.doc.title="${firstTitle}"`, id: 'moving0' })
  for (let write of ctx.owed.splice(0)) write()
  send(live, ws, { unsubscribe: 'moving0' })
  send(live, ws, { subscribe: `.doc.title="${latestTitle}"`, id: 'moving1' })
  let [g, woken] = instance(storage, ctx)
  ws.sent.length = 0
  woken.wake()
  return { ...ready, g, woken }
})()
test('small moving watches survive hibernation without backing reads or writes', () => {
  let { ws, g, written, reads } = movingFixture
  assertEquals(written(), 0)
  assertEquals(reads(), 0)
  assertEquals(ws.sent.map((f) => f.id), [
    'static1',
    'static2',
    'static3',
    'static4',
    'static5',
    'moving1',
  ])
  ws.sent.length = 0
  g.apply([
    { entity: { eid: 'old' }, doc: { title: firstTitle } },
    { entity: { eid: 'current' }, doc: { title: latestTitle } },
  ])
  assertEquals(
    ws.sent.map((f) => [f.id, f.bundles?.map((b) => b.entity.eid)]),
    [
      ['moving1', ['current']],
    ],
  )
})

let compactTitle = (() => {
  let n = 123456789
  return Array.from({ length: 6000 }, () => {
    n ^= n << 13
    n ^= n >>> 17
    n ^= n << 5
    return 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[
      (n >>> 0) % 62
    ]
  }).join('')
})()
let compactFixture = (() => {
  let ready = watched({
    static: `.doc.title="${'base'.repeat(800)}"`,
    moving: '.doc.title=old',
  })
  let { storage, ctx, ws } = ready
  let [, woken] = instance(storage, ctx)
  woken.wake()
  let query = `.doc.title="${compactTitle}"`
  send(woken, ws, { subscribe: query, id: 'moving' })
  send(woken, ws, { subscribe: '.doc.title=small', id: 'extra' })
  let [g, later] = instance(storage, ctx)
  ws.sent.length = 0
  later.wake()
  return { ...ready, g, later }
})()
test('a watch change beyond attachment space compacts then keeps later deltas', () => {
  let { ctx, ws, g, later, written } = compactFixture
  assertEquals(written(), 1)
  assertEquals(ws.sent.map((f) => f.id), ['static', 'moving', 'extra'])
  ws.sent.length = 0
  g.apply([{ entity: { eid: 'changed' }, doc: { title: compactTitle } }])
  assertEquals(
    ws.sent.map((f) => [f.id, f.bundles?.map((b) => b.entity.eid)]),
    [
      ['moving', ['changed']],
    ],
  )
  send(later, ws, { unsubscribe: 'extra' })
  for (let write of ctx.owed.splice(0)) write()
  assertEquals(written(), 1)
})

// Authorization is a host policy; socket plumbing must check it at delivery,
// not merely when a writer relays or the subscription is initially restored.
let authorizedFixture = () => {
  let ctx = hibernation(), ws = wire()
  let g = graph({ storage: store(shop), vocab: shop })
  let allowed = true, broken = false, checks = 0
  let closed = new Promise<void>((resolve) => {
    let close = ws.close
    ws.close = (code, reason) => {
      close(code, reason)
      resolve()
    }
  })
  ctx.live.push(ws)
  ws.serializeAttachment({ writer: { actor: { by: PERSON } } })
  let live = sockets(subscriptions(g), ctx, undefined, {
    authorize: () => {
      checks++
      return broken
        ? Promise.reject(Error('authority unavailable'))
        : Promise.resolve(allowed)
    },
    defer: (write) => void ctx.owed.push(write),
  })
  return {
    ws,
    closed,
    g,
    live,
    checks: () => checks,
    revoke: () => allowed = false,
    fail: () => broken = true,
  }
}
let authorizedFixtures = await (async () => {
  let delivery = authorizedFixture(), ack = authorizedFixture()
  let restore = authorizedFixture(), failure = authorizedFixture()
  for (let f of [delivery, failure]) {
    await f.live.message(f.ws, ask('p', '.product'))
    await until(() => f.ws.sent.length == 1)
  }
  await send(ack.live, ack.ws, { subscribe: '.product', id: 'p', acks: true })
  await until(() => ack.ws.sent.length == 1)
  return { delivery, ack, restore, failure }
})()

test('socket delivery reauthorizes an existing subscription after revocation', async () => {
  let f = authorizedFixtures.delivery
  f.ws.sent.length = 0
  f.revoke()
  await f.g.apply([{ entity: { eid: 'p1' }, product: { price: 3 } }])
  await f.closed
  assertEquals(f.ws.sent, [])
  assertEquals(f.ws.closed, [[1012, 'authorization handshake required']])
})

test('socket ACK-released frames reauthorize after the earlier read', async () => {
  let f = authorizedFixtures.ack
  let token = (f.ws.sent[0] as Frame & { ack: string }).ack
  assert(token)
  await f.g.apply([{ entity: { eid: 'p1' }, product: { price: 7 } }])
  assertEquals(f.ws.sent.length, 1)
  f.revoke()
  await send(f.live, f.ws, { ack: token })
  await f.closed
  assertEquals(f.ws.sent.length, 1)
})

test('socket restoration fails closed before reading revoked watches', async () => {
  let f = authorizedFixtures.restore
  f.ws.serializeAttachment({
    subs: { p: '.product' },
    writer: { actor: { by: PERSON } },
  })
  f.revoke()
  await f.live.wake()
  assertEquals(f.ws.sent, [])
  assertEquals(f.ws.closed, [[1012, 'authorization handshake required']])
})

test('socket delivery fails closed when current authority throws', async () => {
  let f = authorizedFixtures.failure
  f.fail()
  await f.g.apply([{ entity: { eid: 'p1' }, product: { price: 9 } }])
  await f.closed
  assertEquals(f.ws.sent.length, 1)
})

let pendingAuthorization = (() => {
  let ctx = hibernation(), ws = wire()
  let g = graph({ storage: store(shop), vocab: shop })
  ctx.live.push(ws)
  let release!: (ok: boolean) => void
  let entered!: () => void
  let checking = new Promise<void>((r) => entered = r)
  let checks = 0
  let live = sockets(subscriptions(g), ctx, undefined, {
    authorize: () =>
      ++checks == 1 ? true : new Promise<boolean>((r) => {
        release = r
        entered()
      }),
  })
  return { ws, live, checking, release: (ok: boolean) => release(ok) }
})()
test('socket delivery cannot send after close while authorization is pending', async () => {
  let { ws, live, checking, release } = pendingAuthorization
  await live.message(ws, ask('p', '.product'))
  await checking
  ws.closing()
  await live.close(ws)
  release(true)
  for (let n = 0; n < 16; n++) await Promise.resolve()
  assertEquals(ws.sent, [])
})
