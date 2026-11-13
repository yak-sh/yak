/// <reference lib="deno.ns" />
// An object's edge, where the runtime meets it: each incarnation is a new
// `Durable` over state that outlives it — its storage, and the sockets the
// runtime held while it was evicted. A held socket is served by every
// incarnation, a door whose storage fails is answered and comes back, and the
// planner statistics an install owes are the alarm's to work off and the next
// incarnation's to keep.

import { test, until } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { subscriptions } from '@yaks/api'
import { derivedEid, graph } from '@yaks/graph'
import { by, scan } from '@yaks/sql'
import { installed, meta, SCHEMA } from '@yaks/sqlite/meta'
import { loadVocab, type Vocab } from '@yaks/vocab'
import { Durable } from './object.ts'
import type { Wire } from './sockets.ts'
import { driver } from './sql.ts'
import { storage as bind } from './store.ts'
import { durable } from './testing.ts'

// One object's state: storage, and the sockets the runtime holds for it.
let state = () => {
  let live: Wire[] = []
  return {
    storage: durable(),
    live,
    acceptWebSocket: (ws: Wire) => void live.push(ws),
    getWebSockets: () => live,
  }
}
type State = ReturnType<typeof state>

// An object whose store is bound over `ctx` to `vocab` and installed as it
// opens: it applies a write at its door, serves its sockets, and its alarm
// analyzes what the install owed. It keeps what it reported, how often it
// opened, and its store once open.
let object = (ctx: State, vocab: Vocab) => {
  let reported: string[] = [], opens = 0
  let store: ReturnType<typeof bind> | undefined
  let made = new Durable(ctx, {
    open: () => {
      opens++
      let s = store = bind(ctx.storage, vocab)
      s.install()
      let g = graph({ storage: s, vocab })
      return Promise.resolve({
        serve: async (request: Request) => {
          await g.apply(await request.json())
          return new Response('ok')
        },
        subs: subscriptions(g, { timer: soon }),
        works: { statistics: () => (s.analyze(), null) },
      })
    },
    report: (_e, entry) => void reported.push(entry),
    alarm: { now: () => 1000 },
  })
  return { made, reported, opens: () => opens, store: () => store! }
}

// A relay batch's flush, due once what is running settles.
let soon = (fn: () => void) => {
  let due = true
  queueMicrotask(() => due && fn())
  return () => void (due = false)
}

let apply = (o: Durable, bundles: unknown) =>
  o.fetch(
    new Request('https://do/', {
      method: 'POST',
      body: JSON.stringify(bundles),
    }),
  )

// A socket the runtime holds: what it was sent, how it closed, and the
// attachment it carries across an eviction.
let wire = (held: unknown = null) => {
  let sent: { id?: string; bundles?: { entity: { eid: string } }[] }[] = []
  let closed: number[] = []
  return {
    sent,
    closed,
    readyState: 1,
    send: (data: string) => void sent.push(JSON.parse(data)),
    close: (code?: number) => void closed.push(code ?? 0),
    serializeAttachment: (value: unknown) =>
      void (held = JSON.parse(JSON.stringify(value))),
    deserializeAttachment: () => held,
    held: () => held as { relay?: string[] },
  }
}

let ADA = derivedEid('incarnation:ada')
let TAB = derivedEid('incarnation:tab')
let cursors = loadVocab({
  $defs: {
    product: { component: true, properties: { price: { type: 'number' } } },
    cursor: {
      component: true,
      sync: 'peers',
      durable: 'connection',
      properties: { x: { type: 'number' } },
    },
  },
})

test('a held socket is served by every cold incarnation, each opening once', async () => {
  let ctx = state()
  let watcher = wire()
  let mover = wire({ writer: { actor: { by: ADA, via: TAB } } })
  ctx.live.push(watcher, mover)
  let first = object(ctx, cursors)
  await first.made.webSocketMessage(
    watcher,
    JSON.stringify({ subscribe: '.product', id: 'p' }),
  )
  // Each incarnation is evicted after its frames: no request brings it
  // back, only the held sockets' next frame.
  let opens = [first.opens()]
  for (let i = 0; i < 3; i++) {
    let cold = object(ctx, cursors)
    for (let j = 0; j < 2; j++) {
      await cold.made.webSocketMessage(
        mover,
        JSON.stringify({
          relay: [{ entity: { eid: ADA }, cursor: { x: i * 2 + j } }],
        }),
      )
    }
    opens.push(cold.opens())
  }
  assertEquals(opens, [1, 1, 1, 1])
  assertEquals([watcher.closed, mover.closed], [[], []])
  assertEquals(mover.held().relay?.length, 1)
  // What the watcher asked was kept on its socket: a write at the next
  // incarnation's door reaches it.
  await apply(object(ctx, cursors).made, [{
    entity: { eid: 'p1' },
    product: { price: 3 },
  }])
  await until(() => watcher.sent.at(-1)?.bundles?.[0]?.entity.eid == 'p1')
})

test('a door whose storage fails is answered, reported, and comes back a second on', async () => {
  let ctx = state(), failing = false
  let exec = ctx.storage.sql.exec
  ctx.storage.sql.exec = (query, ...bindings) => {
    if (failing) throw new Error('SQLITE_IOERR: storage unavailable')
    return exec(query, ...bindings)
  }
  let { made, reported, store } = object(ctx, cursors)
  let product = (eid: string) => [{ entity: { eid }, product: { price: 1 } }]
  assertEquals((await apply(made, product('a'))).status, 200)
  failing = true
  assertEquals((await apply(made, product('b'))).status, 503)
  assertEquals([reported, await ctx.storage.getAlarm()], [['fetch'], 2000])
  failing = false
  assertEquals((await apply(made, product('c'))).status, 200)
  assertEquals(store().read('.product').map((b) => b.entity.eid).sort(), [
    'a',
    'c',
  ])
})

// A recipe store's words, its rating indexed or not.
let recipes = (indexed = false) =>
  loadVocab({
    $defs: {
      recipe: {
        component: true,
        properties: { rating: { type: 'number', index: indexed } },
      },
      note: { component: true, properties: { label: { type: 'string' } } },
    },
  })

test("the statistics an install owes are the alarm's, and the next incarnation keeps them", async () => {
  let ctx = state(), d = driver(ctx.storage)
  let statistics = (tbl: string) =>
    scan(d, 'sqlite_stat1', by({ tbl }), ['idx', 'stat'])
  let rows = (tbl: string) =>
    Number(String(statistics(tbl)[0]?.stat).split(' ')[0])
  // An incarnation of the store over `vocab`, its alarm rung; it answers a
  // write to its store.
  let wake = async (vocab = recipes()) => {
    let o = object(ctx, vocab)
    await o.made.alarm()
    let s = o.store()
    return (comp: string, ...eids: string[]) =>
      s.tx((tx) =>
        tx.patch(eids.map((eid) => ({
          entity: { eid },
          ...comp == 'recipe'
            ? { recipe: { rating: 1 } }
            : { note: { label: 'kept' } },
        })))
      )
  }
  let write = await wake()
  await write('recipe', 'one', 'two')
  // An installation from before receipts: complete statistics and a plain
  // schema fingerprint. The next incarnation adopts them rather than
  // analyzing again.
  d.query({ t: 'analyze' })
  meta(d).set(SCHEMA, installed(d)!)
  let legacy = statistics('recipe')
  assertEquals(rows('recipe'), 2)
  await write('recipe', 'three')
  write = await wake()
  assertEquals(statistics('recipe'), legacy)
  await write('recipe', 'four')
  write = await wake()
  assertEquals(statistics('recipe'), legacy)

  // A table empty when last analyzed is owed once it holds rows, then kept.
  let bytes = ctx.storage.sql.databaseSize
  await write('note', 'one')
  write = await wake()
  let populated = statistics('note')
  assertEquals(rows('note'), 1)
  await write('note', 'two')
  write = await wake()
  assertEquals(statistics('note'), populated)
  assert(ctx.storage.sql.databaseSize < bytes * 10)

  // A new index is analyzed by the alarm of the deploy that made it.
  write = await wake(recipes(true))
  let indexed = statistics('recipe')
  assert(indexed.some((row) => row.idx != null))
  assertEquals(rows('recipe'), 4)
  await write('recipe', 'five')
  await wake(recipes(true))
  assertEquals(statistics('recipe'), indexed)
})
