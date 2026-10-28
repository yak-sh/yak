/// <reference lib="deno.ns" />
// A store still on the code it started with restarts when a newer deploy
// reaches it (running.ts, T-123372), and the caller's retry meets the restart.
// The restart itself is the runtime's: here `abort` throws as workerd's does,
// with the reason as the message. The decision is `behind`, tested on a bare
// object; each kind of object is checked once to ask it at its door.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { doorOf, fetchOf, storeOf } from './door.ts'
import { evicted } from '@yaks/durable-object'
import { Store } from './graph.ts'
import { Wire } from './stream.ts'
import { Builder } from './build.ts'
import type { Env } from './env.ts'
import {
  behind,
  learn,
  ran,
  WORKER_VERSION,
  WORKER_VERSION_AT,
} from './running.ts'
import { kvStorage, state } from './testing.ts'

let A = { id: 'a', timestamp: '2026-10-12T16:00:00Z' }
let B = { id: 'b', timestamp: '2026-10-12T16:30:00Z' }

let from = (v?: typeof A) =>
  new Headers(
    v ? { [WORKER_VERSION]: v.id, [WORKER_VERSION_AT]: v.timestamp } : {},
  )

// The restarts an object asked for, and the slice of its state that asks.
let restartable = () => {
  let restarts: string[] = []
  let abort = (reason?: string) => {
    restarts.push(reason ?? '')
    throw new Error(reason)
  }
  return { restarts, abort }
}
// Retry decisions are exercised here, not the runtime's randomized pause: a
// resend waits out none.
let unpaused = () => Promise.resolve()
let object = () => {
  let r = restartable()
  return { ...r, ctx: { storage: kvStorage(), abort: r.abort } }
}

test('an object on an older deploy restarts once for a newer caller', async () => {
  let o = object()
  // The request in flight fails in the runtime's own words, which every
  // caller already retries on.
  let e = await assertRejects(() => behind(from(B), A, o.ctx))
  assert(evicted(e))
  assertEquals(o.restarts.length, 1)
  // Started again on the same older code, it is where the runtime means it to
  // be, and serves the newer caller rather than restarting forever.
  await behind(from(B), A, o.ctx)
  assertEquals(o.restarts.length, 1)
})

test('an older caller, the same deploy, or no version never restarts it', async () => {
  let o = object()
  for (let v of [A, B, undefined]) await behind(from(v), B, o.ctx)
  assertEquals(o.restarts, [])
})

test('a store restarts at its door before it does anything for a newer caller', async () => {
  let o = object()
  let store = new Store(o.ctx as never, { CF_VERSION_METADATA: A })
  let e = await assertRejects(() =>
    store.fetch(new Request('http://store/restore', { headers: from(B) }))
  )
  assert(evicted(e))
  assertEquals(o.restarts.length, 1)
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

test('an object says the version it runs and the deploy it restarted for', async () => {
  let o = object()
  await assertRejects(() => behind(from(B), A, o.ctx))
  assertEquals(await ran(A, o.ctx.storage), {
    version: { id: A.id, at: A.timestamp },
    restartedFor: { id: B.id, at: B.timestamp },
  })
})

test('a call that reaches a store on the old deploy is answered by the new one', async () => {
  learn(B)
  let o = object()
  let old = new Store(o.ctx as never, { CF_VERSION_METADATA: A })
  // The runtime starts the next incarnation on the new code, which answers.
  let next = {
    fetch: () => Promise.resolve(new Response('', { status: 404 })),
  }
  let ns = {
    idFromName: (name: string) => name,
    get: () => o.restarts.length ? next : old,
  }
  let answer = await storeOf(ns, 'ada/cookbook', undefined, unpaused)(
    '/restore',
  )
  assertEquals(answer.status, 404)
  assertEquals(o.restarts.length, 1)
})

// The Wire and the Builder are reached through `fetchOf`, which stamps the
// caller's deploy the way a store's door does (T-123489). Each is one
// incarnation here.
let through = (object: { fetch(req: Request): Promise<Response> }) =>
  fetchOf({ idFromName: (n: string) => n, get: () => object }, 'ada', unpaused)

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

// Each behavior gets its own incarnation; constructing it is fixture work.
let builder = () => {
  let r = restartable()
  let sockets: unknown[] = []
  let ctx = Object.assign(state('', false), {
    abort: r.abort,
    getWebSockets: () => sockets,
  })
  return {
    ...r,
    sockets,
    instance: new Builder(ctx, { CF_VERSION_METADATA: A } as Env),
  }
}
let watched = builder(), idle = builder()
watched.sockets.push({})
let ask = () => new Request('http://builder/nowhere')

test('a watched Builder keeps its code for a newer caller', async () => {
  learn(B)
  assertEquals((await through(watched.instance)(ask)).status, 404)
  assertEquals(watched.restarts, [])
})

test('an idle Builder restarts for a newer caller', async () => {
  learn(B)
  assertEquals((await through(idle.instance)(ask)).status, 404)
  assertEquals(idle.restarts.length, 1)
})
