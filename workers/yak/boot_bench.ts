/// <reference lib="deno.ns" />
// What a Store pays when it comes back: its constructor over storage that
// outlived the last incarnation — `#start`, the reshaping and migration
// questions, and `#boot` → `#build` (the vocabulary loaded, the graph and every
// plugin composed, the doors raised). A Durable Object that can hibernate is
// dropped from memory after 10 idle seconds and runs its constructor again on
// the next request, and in production that next call costs ~300 ms more than a
// warm one (Workers traces, 2026-09-24). This is our share of it.
//
// Over the workerd stand-in, as graph_test.ts runs the Store: each object is
// deployed and served once first, so what is timed is a wake — the schema
// stamp already matches and no DDL runs — never a first boot. Runtime work
// (restoring the object, a cold isolate loading the bundle) is outside it.
// Gated by bin/bench-gate.ts, which ratchets each ratio down.
import { durable } from '../../packages/durable-object/harness.ts'
import type { Wire } from '@yaks/durable-object'
import { PLATFORM_STORE } from './door.ts'
import { Store } from './graph.ts'

// One object's state: storage that outlives an incarnation, and the sockets
// the runtime holds for it.
let state = () => {
  let live: Wire[] = []
  return {
    storage: durable(),
    live,
    acceptWebSocket: (ws: Wire) => void live.push(ws),
    getWebSockets: () => live,
  }
}

let send = (
  store: Store,
  path: string,
  head: Record<string, string>,
  body?: unknown,
) =>
  store.fetch(
    new Request(`http://store${path}`, {
      method: body ? 'POST' : 'GET',
      headers: head,
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  )

let ok = async (r: Promise<Response>) => {
  let res = await r
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
}

// An app the size of the demo space's: a couple of words of its own, one of
// them searched, on top of the core every app store speaks.
let APP = 'a0000000-0000-4000-8000-000000000001'
let ADA = 'b0000000-0000-4000-8000-000000000002'
let app = state()
{
  let head = {
    'x-store': 'ada/recipes',
    'x-yak-app': APP,
    'x-yak-access': 'public',
    'x-yak-person': ADA,
    'x-yak-role': 'owner',
  }
  let store = new Store(app)
  await ok(send(store, '/vocab', head, {
    $defs: {
      recipe: {
        component: true,
        properties: {
          serves: { type: 'number' },
          minutes: { type: 'number' },
          steps: { type: 'string', search: true },
        },
      },
      ingredient: {
        component: true,
        properties: {
          recipe: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          amount: { type: 'string' },
        },
      },
    },
  }))
  await ok(send(store, '/apply', head, [{
    entity: { eid: crypto.randomUUID() },
    doc: { title: 'Lemon cake' },
    recipe: { serves: 8, minutes: 50, steps: 'Whisk, fold, bake.' },
  }]))
  await ok(send(store, '/query?q=.recipe', head))
}

// The directory: the one object named for the platform, seeded by its first
// write.
let directory = state()
{
  let store = new Store(directory)
  let person = crypto.randomUUID()
  await ok(send(store, '/apply', {
    'x-store': PLATFORM_STORE,
    'x-yak-person': person,
    'x-yak-role': 'owner',
  }, [
    { entity: { eid: person }, person: {} },
    {
      entity: { eid: '$space' },
      doc: { title: 'ada' },
      space: { slug: 'ada' },
    },
  ]))
  await ok(
    send(store, '/query?q=.space.slug=ada', { 'x-store': PLATFORM_STORE }),
  )
}

Deno.bench('store boot: an app store wakes', () => {
  new Store(app)
})

Deno.bench('store boot: the directory wakes', () => {
  new Store(directory)
})
