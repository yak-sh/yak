/// <reference lib="deno.ns" />
// Presence on the Store, end to end: an app declares a component nobody
// stores, and the object hands it between the people watching.
//
// This is the whole point of the `sync: peers` tier — a value that reaches
// everyone and is kept by no one — so the test is mostly about the ways it
// stops: the writer clears it, a late subscriber still learns it, and a
// connection going away un-says everything it was saying, including across an
// eviction that took the value itself with it. The duration's own clock is
// proven where a clock can be held, in @yaks/api's relay_test.ts.
import { assert, assertEquals } from '@std/assert'
import type { Frame } from '@yaks/api'
import type { Bundle } from '@yaks/graph'
import type { Wire } from '@yaks/durable-object'
import { durable } from '../../packages/durable-object/harness.ts'
import { Store } from './graph.ts'

let wire = () => {
  let sent: Frame[] = []
  let held: unknown = null
  return {
    sent,
    send: (data: string) => void sent.push(JSON.parse(data)),
    serializeAttachment: (v: unknown) => {
      held = JSON.parse(JSON.stringify(v))
    },
    deserializeAttachment: () => held,
  }
}

let state = () => {
  let live: Wire[] = []
  return {
    storage: durable(),
    live,
    acceptWebSocket: (ws: Wire) => void live.push(ws),
    getWebSockets: () => live,
  }
}

let APP = 'a0000000-0000-4000-8000-000000000001'
let ADA = 'b0000000-0000-4000-8000-000000000002'
let CAKE = 'c0000000-0000-4000-8000-000000000003'
let owner = { app: APP, person: ADA, role: 'owner', title: 'Ada' }

// An app's own vocab.json: a recipe it keeps, and where each cook's finger is,
// which it does not keep at all.
let SCHEMA = JSON.stringify({
  $defs: {
    recipe: {
      component: true,
      properties: { serves: { type: 'number' } },
    },
    presence: {
      component: true,
      sync: 'peers',
      durable: 'connection',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        name: { type: 'string' },
      },
    },
  },
})

let headers = (): Record<string, string> => ({
  'x-store': 'ada/cookbook',
  'x-yak-app': owner.app,
  'x-yak-person': owner.person,
  'x-yak-role': owner.role,
  'x-yak-title': owner.title,
})

let post = (store: Store, path: string, body: string | unknown[]) =>
  store.fetch(
    new Request(`http://store${path}`, {
      method: 'POST',
      headers: headers(),
      body: typeof body == 'string' ? body : JSON.stringify(body),
    }),
  )

let get = (store: Store, path: string) =>
  store.fetch(new Request(`http://store${path}`, { headers: headers() }))

// A cookbook with one recipe in it, and two cooks watching it.
let watching = async (ctx = state()) => {
  let store = new Store(ctx)
  assertEquals((await post(store, '/vocab', SCHEMA)).status, 200)
  await post(store, '/apply', [{
    entity: { eid: CAKE },
    doc: { title: 'Lemon drizzle' },
    recipe: { serves: 8 },
  }])
  let watch = () => {
    let ws = wire()
    ctx.live.push(ws)
    store.webSocketMessage(
      ws,
      JSON.stringify({ subscribe: '.recipe!', id: 'r' }),
    )
    ws.sent.length = 0
    return ws
  }
  return { ctx, store, watch }
}

let relay = (ws: { sent: Frame[] }) => ws.sent.flatMap((f) => f.relay ?? [])
let says = (eid: string, comp: Bundle[string]) => [{
  entity: { eid },
  presence: comp,
}]

Deno.test('a finger moves, and only the other cooks hear it', async () => {
  let { store, watch } = await watching()
  let ada = watch(), bert = watch()

  store.webSocketMessage(
    ada,
    JSON.stringify({ relay: says(CAKE, { x: 3, y: 9, name: 'Ada' }) }),
  )
  assertEquals(relay(bert), says(CAKE, { x: 3, y: 9, name: 'Ada' }))
  assertEquals(ada.sent, []) // its own graph already has it

  // And the shop kept none of it: the row reads as it was written.
  let [b] = await (await get(store, '/query?q=.recipe!')).json() as Bundle[]
  assertEquals(b.presence, undefined)
})

Deno.test('a cook who arrives late sees the fingers already on the page', async () => {
  let { store, watch } = await watching()
  let ada = watch()
  store.webSocketMessage(
    ada,
    JSON.stringify({ relay: says(CAKE, { x: 3, y: 9, name: 'Ada' }) }),
  )

  // A cook who subscribes after the move is told it in her opening frame,
  // beside the set — she never saw the write that put it there.
  let cleo = wire()
  store.webSocketMessage(
    cleo,
    JSON.stringify({ subscribe: '.recipe!', id: 'r' }),
  )
  let [first] = cleo.sent
  assertEquals(first.relay, says(CAKE, { x: 3, y: 9, name: 'Ada' }))
})

Deno.test('a cook who leaves takes her finger with her', async () => {
  let { store, watch } = await watching()
  let ada = watch(), bert = watch()
  store.webSocketMessage(
    ada,
    JSON.stringify({ relay: says(CAKE, { x: 3, y: 9, name: 'Ada' }) }),
  )
  bert.sent.length = 0

  store.webSocketClose(ada)
  assertEquals(relay(bert), says(CAKE, null))
})

Deno.test('clearing it is the component set to null, like anywhere else', async () => {
  let { store, watch } = await watching()
  let ada = watch(), bert = watch()
  store.webSocketMessage(
    ada,
    JSON.stringify({ relay: says(CAKE, { x: 3, y: 9, name: 'Ada' }) }),
  )
  bert.sent.length = 0
  store.webSocketMessage(ada, JSON.stringify({ relay: says(CAKE, null) }))
  assertEquals(relay(bert), says(CAKE, null))
})

Deno.test('a finger lost to an eviction is still taken away', async () => {
  let { ctx, store, watch } = await watching()
  let ada = watch(), bert = watch()
  store.webSocketMessage(
    ada,
    JSON.stringify({ relay: says(CAKE, { x: 3, y: 9, name: 'Ada' }) }),
  )

  // The object is evicted. Its memory went with it — the value is gone, and a
  // cook arriving now is told nothing …
  let woken = new Store(ctx)
  let late = wire()
  woken.webSocketMessage(
    late,
    JSON.stringify({ subscribe: '.recipe!', id: 'r' }),
  )
  assert(!late.sent[0].relay)

  // … but the keys rode the attachment, so Ada leaving still un-says it.
  bert.sent.length = 0
  late.sent.length = 0
  woken.webSocketClose(ada)
  assertEquals(relay(bert), says(CAKE, null))
  assertEquals(relay(late), says(CAKE, null))
})

Deno.test('a durable component sent to the relay door is not stored by it', async () => {
  let { store, watch } = await watching()
  let ada = watch(), bert = watch()
  store.webSocketMessage(
    ada,
    JSON.stringify({
      relay: [{ entity: { eid: CAKE }, recipe: { serves: 1 } }],
    }),
  )
  assertEquals(bert.sent, [])
  let [b] = await (await get(store, '/query?q=.recipe!')).json() as Bundle[]
  assertEquals((b.recipe as { serves: number }).serves, 8)
})
