/// <reference lib="deno.ns" />
// A store still on the code it started with restarts when a newer deploy
// reaches it (running.ts, T-123372), and the caller's retry meets the restart.
// The restart itself is the runtime's: here `abort` throws as workerd's does,
// with the reason as the message, and swaps in the object the runtime would
// start next.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { doorOf, evicted, storeOf } from './door.ts'
import { Store } from './graph.ts'
import { learn, WORKER_VERSION, WORKER_VERSION_AT } from './running.ts'
import { state } from './testing.ts'

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
