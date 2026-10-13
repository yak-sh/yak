/// <reference lib="deno.ns" />
// A store still on the code it started with restarts when a newer deploy
// reaches it (running.ts, T-123372), and the caller's retry meets the restart.
// The restart itself is the runtime's: here `abort` throws as workerd's does,
// with the reason as the message, and swaps in the object the runtime would
// start next.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { doorOf, fetchOf, storeOf } from './door.ts'
import { evicted } from './resets.ts'
import { Store } from './graph.ts'
import { Wire } from './stream.ts'
import { Builder } from './build.ts'
import type { Env } from './env.ts'
import { learn, WORKER_VERSION, WORKER_VERSION_AT } from './running.ts'
import { kvStorage, state } from './testing.ts'

let A = { id: 'a', timestamp: '2026-10-12T16:00:00Z' }
let B = { id: 'b', timestamp: '2026-10-12T16:30:00Z' }

// One object's storage, and whatever incarnation of it is running: each
// restart starts the next on `next`'s version, as the runtime would.
let object = (first: typeof A, next: typeof A = first) => {
  let ctx = state()
  let restarts: string[] = []
  let born = (meta: typeof A): Store =>
    new Store(
      Object.assign(ctx, {
        abort: (reason?: string) => {
          restarts.push(reason ?? '')
          live = born(next)
          throw new Error(reason)
        },
      }),
      { CF_VERSION_METADATA: meta },
    )
  let live = born(first)
  let ask = (from?: typeof A) =>
    live.fetch(
      new Request('http://store/restore', {
        headers: {
          'x-store': 'ada/cookbook',
          ...from
            ? { [WORKER_VERSION]: from.id, [WORKER_VERSION_AT]: from.timestamp }
            : {},
        },
      }),
    )
  return {
    ctx,
    restarts,
    ask,
    get live() {
      return live
    },
  }
}

test('a store on an older deploy restarts once for a newer caller', async () => {
  let o = object(A)
  // The request in flight fails in the runtime's own words, which every
  // caller already retries on.
  let e = await assertRejects(() => o.ask(B))
  assert(evicted(e))
  assertEquals(o.restarts.length, 1)
  // Started again on the same older code, it is where the runtime means it to
  // be, and serves the newer caller rather than restarting forever.
  assertEquals((await o.ask(B)).status, 404)
  assertEquals(o.restarts.length, 1)
})

test('an older caller, the same deploy, or no version never restarts it', async () => {
  let o = object(B)
  for (let from of [A, B, undefined]) await o.ask(from)
  assertEquals(o.restarts, [])
})

test("a caller's door stamps its deploy, and a request's own claim is dropped", async () => {
  learn(B)
  let sent: Headers[] = []
  let door = doorOf((req) => {
    sent.push(req.headers)
    return Promise.resolve(new Response('ok'))
  }, 'ada/cookbook')
  await door('/restore', {
    headers: {
      [WORKER_VERSION]: 'forged',
      [WORKER_VERSION_AT]: '2099-01-01T00:00:00Z',
    },
  })
  assertEquals(sent[0].get(WORKER_VERSION), B.id)
  assertEquals(sent[0].get(WORKER_VERSION_AT), B.timestamp)
})

test('a store says the version it runs and the deploy it restarted for', async () => {
  let o = object(A)
  await assertRejects(() => o.ask(B))
  let inspected = await o.live.fetch(
    new Request('http://store/inspect', {
      headers: { 'x-store': 'ada/cookbook', 'x-yak-kernel': '1' },
    }),
  )
  assertEquals((await inspected.json()).running, {
    version: { id: A.id, at: A.timestamp },
    restartedFor: { id: B.id, at: B.timestamp },
  })
})

test('a call that reaches a store on the old deploy is answered by the new one', async () => {
  learn(B)
  let o = object(A, B)
  let ns = {
    idFromName: (name: string) => name,
    get: () => ({ fetch: (req: Request) => o.live.fetch(req) }),
  }
  let answer = await storeOf(ns, 'ada/cookbook')('/restore')
  assertEquals(answer.status, 404)
  assertEquals(o.restarts.length, 1)
})

// The Wire and the Builder are reached through `fetchOf`, which stamps the
// caller's deploy the way a store's door does (T-123489). Each is one
// incarnation here; `abort` throws as workerd's does.
let restartable = () => {
  let restarts: string[] = []
  let abort = (reason?: string) => {
    restarts.push(reason ?? '')
    throw new Error(reason)
  }
  return { restarts, abort }
}

let through = (object: { fetch(req: Request): Promise<Response> }) =>
  fetchOf({ idFromName: (n: string) => n, get: () => object }, 'ada')

test('a Wire on an older deploy restarts once for a newer caller', async () => {
  learn(B)
  let r = restartable()
  let wire = new Wire({ storage: kvStorage(), abort: r.abort }, {
    CF_VERSION_METADATA: A,
  })
  let roster = () =>
    new Request('http://wire/roster', {
      method: 'POST',
      body: JSON.stringify({ session: 's', version: 'v', names: [] }),
    })
  // The request in flight fails in the runtime's own words, and the caller's
  // retry is served: started again on the same older code, the object is
  // where the runtime means it to be.
  assertEquals((await through(wire)(roster)).status, 200)
  assertEquals(r.restarts.length, 1)
  assert(evicted(new Error(r.restarts[0])))
})

test('an idle Builder restarts for a newer caller, a watched one keeps its code', async () => {
  learn(B)
  let at = () => {
    let r = restartable()
    let ctx = Object.assign(state(), { abort: r.abort })
    let env: Partial<Env> = { CF_VERSION_METADATA: A }
    return { ...r, ctx, builder: new Builder(ctx, env as Env) }
  }
  let ask = () => new Request('http://builder/nowhere')
  let idle = at()
  assertEquals((await through(idle.builder)(ask)).status, 404)
  assertEquals(idle.restarts.length, 1)
  // A page's socket is never cut for a deploy that is only passing through.
  let watched = at()
  watched.ctx.acceptWebSocket({} as never)
  assertEquals((await through(watched.builder)(ask)).status, 404)
  assertEquals(watched.restarts, [])
})
