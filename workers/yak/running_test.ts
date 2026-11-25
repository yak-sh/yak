/// <reference lib="deno.ns" />
// A store still on the code it started with restarts when a newer deploy
// reaches it (running.ts, T-123372), and the caller's retry meets the restart.
// The restart itself is the runtime's: here `abort` throws as workerd's does,
// with the reason as the message. The decision is `owed`, tested on a bare
// object; each kind of object is checked once to ask it at its door.
import { clock, equal, test, until } from '@yaks/testing'
import { installPair, made } from '../../packages/workerd/testing.ts'
import { assert, assertEquals, assertMatch, assertRejects } from '@std/assert'
import { doorOf, fetchOf, storeOf } from './door.ts'
import { evicted } from '@yaks/durable-object'
import { Store } from './graph.ts'
import { Wire } from './stream.ts'
import { Builder } from './build.ts'
import type { Env } from './env.ts'
import {
  learn,
  owed,
  ran,
  WORKER_VERSION,
  WORKER_VERSION_AT,
} from './running.ts'
import { kvStorage, state } from './testing.ts'
import { within } from './defects.ts'
import { KERNEL } from './meta.ts'
import { PLATFORM_STORE } from '@yaks/platform/names'

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
// The restart a caller on `v` is owed, run.
let restart = (h: Headers, mine: typeof A, ctx: Parameters<typeof owed>[2]) =>
  Promise.resolve(owed(h, mine, ctx)?.())
let object = () => {
  let r = restartable()
  return { ...r, ctx: { storage: kvStorage(), abort: r.abort } }
}

test('an object on an older deploy restarts once for a newer caller', async () => {
  let o = object()
  // The request in flight fails in the runtime's own words, which every
  // caller already retries on.
  let e = await assertRejects(() => restart(from(B), A, o.ctx))
  assert(evicted(e))
  assertEquals(o.restarts.length, 1)
  // Started again on the same older code, it is where the runtime means it to
  // be, and serves the newer caller rather than restarting forever.
  await restart(from(B), A, o.ctx)
  assertEquals(o.restarts.length, 1)
})

test('an older caller, the same deploy, or no version never restarts it', async () => {
  let o = object()
  for (let v of [A, B, undefined]) await restart(from(v), B, o.ctx)
  assertEquals(o.restarts, [])
})

// A store's own door: a newer caller is answered on the code the store has,
// and only a refusal restarts it (T-150897). Twice on 2026-11-07 the instance
// after a restart waited 21 and 32 s before it ran a line, where Cloudflare's
// own moves to a new deploy started in under a second.
let older = (o: ReturnType<typeof object>, CLOCK = clock()) =>
  new Store(Object.assign(state(), { abort: o.abort }) as never, {
    CF_VERSION_METADATA: A,
    CLOCK,
  })
let asked = (path: string, method = 'GET') =>
  new Request(`http://store${path}`, {
    method,
    headers: { ...Object.fromEntries(from(B)), 'x-yak-kernel': '1' },
    body: method == 'POST' ? '{}' : undefined,
  })

test("a store answers a newer caller's read and write on the code it has, and keeps running", async () => {
  let o = object(), time = clock()
  let store = older(o, time)
  let read = await store.fetch(asked('/restore'))
  assertEquals(await read.json(), { from: 'at-0', to: '' })
  let wrote = await store.fetch(
    new Request('http://store/apply', {
      method: 'POST',
      headers: { ...Object.fromEntries(from(B)), 'x-yak-kernel': '1' },
      body: JSON.stringify([{ entity: { eid: crypto.randomUUID() } }]),
    }),
  )
  assertEquals(wrote.status, 200, await wrote.clone().text())
  await time.advance(60_000)
  assertEquals(o.restarts, [])
})

// The uptime probe's query at 23:22:39Z: the kernel's door read a store still
// on the old deploy, which restarted behind its answer, and the door's resend
// waited 21 s for the new instance (T-150814, T-150897).
test("the kernel's read of a store on the old deploy is answered by it, sent once", async () => {
  learn(B)
  let o = object(), time = clock(), sent = 0
  let old = older(o, time)
  let ns = {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: (req: Request) => (sent++, old.fetch(req)),
    }),
  }
  let answer = await storeOf(ns, 'ada/cookbook', undefined, unpaused)(
    '/restore',
    {},
    KERNEL,
  )
  assertEquals(await answer.json(), { from: 'at-0', to: '' })
  await time.advance(60_000)
  assertEquals([sent, o.restarts.length], [1, 0])
})

test('a read the older code has no door for restarts the store at once', async () => {
  let o = object()
  let e = await assertRejects(() => older(o).fetch(asked('/nowhere')))
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
  await assertRejects(() => restart(from(B), A, o.ctx))
  assertEquals(await ran(A, o.ctx.storage), {
    version: { id: A.id, at: A.timestamp },
    restartedFor: { id: B.id, at: B.timestamp },
  })
})

test('a call the old deploy refuses is answered by the new one', async () => {
  learn(B)
  let o = object()
  let old = older(o)
  // The runtime starts the next incarnation on the new code, which answers.
  let next = {
    fetch: () => Promise.resolve(new Response('', { status: 404 })),
  }
  let ns = {
    idFromName: (name: string) => name,
    get: () => o.restarts.length ? next : old,
  }
  let answer = await storeOf(ns, 'ada/cookbook', undefined, unpaused)(
    '/nowhere',
    { method: 'POST', body: '{}' },
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
  let wire = new Wire(Object.assign(state('', false), { abort: r.abort }), {
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
let idle = builder(), operating = builder()
// A page watching the Operator (build.ts `#accept`).
let socket = (held: unknown) => ({ deserializeAttachment: () => held })
operating.sockets.push(socket({ person: 'ada', operator: true }))
let ask = () => new Request('http://builder/nowhere')

test('a Builder watched by an Operator page serves a newer caller without resetting the connection', async () => {
  learn(B)
  assertEquals((await through(operating.instance)(ask)).status, 404)
  assertEquals(operating.restarts.length, 0)
})

test('an idle Builder leaves its version update to the runtime', async () => {
  learn(B)
  assertEquals((await through(idle.instance)(ask)).status, 404)
  assertEquals(idle.restarts.length, 0)
})

// A Worker on a newer deploy than its Store (T-140262): the store restarted
// for that deploy and the runtime started it again on its older code, as
// Cloudflare's deferred code updates do. A write naming a word the older code
// does not know is no mistake of the caller's: the store answers a failure
// the caller's door sends again, and the caller reports what the newer code
// says or, with none, that the store stayed behind.
// A store behind its caller after restarting for it, which refuses a word
// only the caller's deploy declares; the next incarnation answers `next`,
// or with none, the runtime keeps starting it on the older code. Answers
// what the caller got, and what the tracker heard.
let behind = async (next?: Response) => {
  learn(B)
  let reports: unknown[] = []
  let o = object()
  let ctx = Object.assign(state(), { abort: o.abort })
  await ctx.storage.put('restarted for', { id: B.id, at: B.timestamp })
  let old = new Store(ctx as never, { CF_VERSION_METADATA: A })
  let reached = 0
  let ns = {
    idFromName: (name: string) => name,
    get: () => reached++ && next ? { fetch: () => Promise.resolve(next) } : old,
  }
  let answer = await within(
    {
      ERRORS: {
        send: (rows: unknown[]) => (reports.push(...rows), Promise.resolve()),
      },
    } as never,
    {},
    () =>
      storeOf(ns, 'ada/cookbook', undefined, unpaused)('/apply', {
        method: 'POST',
        headers: { 'x-yak-kernel': '1' },
        body: JSON.stringify([{
          entity: { eid: crypto.randomUUID() },
          release_remake: { app: 'a', source: 's' },
        }]),
      }),
  )
  assertEquals([reached > 1, o.restarts], [true, []])
  return {
    status: answer.status,
    said: await answer.text(),
    reports: JSON.stringify(reports),
  }
}

test('a refusal from a store behind its caller is sent again, and reports nothing when the newer code takes it', async () => {
  let { status, reports } = await behind(Response.json({ ok: true }))
  assertEquals([status, reports], [200, '[]'])
})

test("a refusal the newer code repeats is the caller's own, answered plainly and reported as nothing", async () => {
  let { status, reports } = await behind(
    Response.json({ error: 'Refused', message: 'unknown prop: .zzqx' }, {
      status: 400,
    }),
  )
  assertEquals([status, reports], [400, '[]'])
})

test('a store still behind after every resend answers its refusal as a refusal, and reports it under the word it refused', async () => {
  let { status, said, reports } = await behind()
  assertEquals(status, 400)
  assertMatch(reports, /"fault":"behind:\/apply \.release_remake"/)
  assertMatch(said, /release_remake/)
})

let directoryBehind = async (
  q: string,
  first: (req: Request) => Promise<Response>,
  next = first,
) => {
  learn(B)
  let sends = 0, reports: unknown[] = []
  let ns = {
    idFromName: (name: string) => name,
    get: () => ({ fetch: sends++ ? next : first }),
  }
  let answer = await within(
    {
      ERRORS: {
        send: (rows: unknown[]) => (reports.push(...rows), Promise.resolve()),
      },
    } as never,
    {},
    () =>
      storeOf(ns, PLATFORM_STORE, undefined, unpaused)(
        `/query?q=${encodeURIComponent(q)}`,
        {},
        KERNEL,
      ),
  )
  return { sends, status: answer.status, body: await answer.json(), reports }
}

test('an older directory’s query refusal is returned without retrying when the current vocabulary confirms it', async () => {
  let o = object()
  let old = older(o)
  for (
    let [query, code, words] of [
      ['.comped&.order=comped', 'Unsupported', '.order=comped.until'],
      ['.operator_request', 'Unknown', '.operator_request'],
    ]
  ) {
    let { sends, status, body, reports } = await directoryBehind(
      query,
      (req) => old.fetch(req),
    )
    assertEquals([sends, status, body.error, reports], [1, 400, code, []])
    assert(body.message.includes(words), body.message)
  }
  assertEquals(o.restarts, [])
})

test('a projection fixed in the newer query compiler still retries across deploys', async () => {
  let { sends, status, body, reports } = await directoryBehind(
    '.comped&.fields=comped',
    () =>
      Promise.resolve(Response.json({
        error: 'Skewed',
        message:
          'Durable Object on an older deploy refused a caller on a newer one: comped',
        retryable: true,
        refusal: {
          status: 400,
          body: {
            error: 'Unsupported',
            feature: 'a component where a property belongs',
          },
        },
      }, { status: 503 })),
    () => Promise.resolve(Response.json([{ comped: { until: '2026-12-01' } }])),
  )
  assertEquals([sends, status, body, reports], [2, 200, [{
    comped: { until: '2026-12-01' },
  }], []])
})

test("a refused subscription on a newer caller's directory socket leaves the socket and the directory running", async () => {
  let undo = installPair()
  try {
    let o = object(), time = clock()
    let store = older(o, time)
    made.length = 0
    let upgraded = await store.fetch(
      new Request('http://store/person/ws', {
        headers: {
          ...Object.fromEntries(from(B)),
          ...KERNEL,
          'x-store': PLATFORM_STORE,
          'x-yak-person': crypto.randomUUID(),
          upgrade: 'websocket',
        },
      }),
    )
    equal(upgraded.status, 101, await upgraded.text())
    let ws = made[0][1]
    await store.webSocketMessage(
      ws,
      JSON.stringify({ subscribe: '.unheard_of', id: 'u' }),
    )
    await until(() => ws.sent.some((f) => f.refused), { label: 'refused' })
    let read = await store.fetch(asked('/query?q=.space'))
    equal(read.status, 200, await read.text())
    await time.advance(60_000)
    equal(o.restarts, [])
  } finally {
    undo()
  }
})
