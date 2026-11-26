/// <reference lib="deno.ns" />
// An object still on the code it started with answers a newer deploy's caller
// on that code and never restarts for it (running.ts): a restart under a
// deferred deploy comes back on the same code and cuts every call in flight
// (bug f27df94d2b). Here `abort` throws as workerd's does, with the reason as
// the message, so any restart shows; each kind of object is asked at its door.
import { clock, equal, test, until } from '@yaks/testing'
import { installPair, made } from '../../packages/workerd/testing.ts'
import { assert, assertEquals, assertMatch } from '@std/assert'
import { doorOf, fetchOf, storeOf } from './door.ts'
import { backoff } from '@yaks/durable-object/resets'
import { sleep } from '@yaks/fp'
import { refuse } from '@yaks/api'
import { compile } from '@yaks/sql'
import { loadVocab, Unknown } from '@yaks/vocab'
import { parse } from '@yaks/query'
import { Store } from './graph.ts'
import { Wire } from './stream.ts'
import { Builder } from './build.ts'
import type { Env } from './env.ts'
import { learn, skewed, WORKER_VERSION, WORKER_VERSION_AT } from './running.ts'
import { kvStorage, state } from './testing.ts'
import { within } from './defects.ts'
import { answered, KERNEL, metaOf } from './meta.ts'
import { PLATFORM_STORE } from '@yaks/platform/names'
import { type Bundle, mint, token } from '@yaks/graph'
import {
  EPOCH,
  READS,
  readsAnswer,
  servingDirectory,
} from './directory-copy.ts'
import { platformVocab } from './vocab.ts'
import { oneContract } from '@yaks/platform/support-contract-service'
import { walkTo } from './directory.ts'

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

// A store's own door: a newer caller is answered on the code the store has
// (T-150897). Twice on 2026-11-07 the instance after a restart waited 21 and
// 32 s before it ran a line, where Cloudflare's own moves to a new deploy
// started in under a second.
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

test('an older store returns a stale write conflict without restarting', async () => {
  let o = object()
  let store = older(o)
  let eid = mint()
  let write = (title: string, was?: string | null) =>
    store.fetch(
      new Request('http://store/apply', {
        method: 'POST',
        headers: { ...Object.fromEntries(from(B)), ...KERNEL },
        body: JSON.stringify([{
          entity: { eid },
          doc: { title },
          ...was === undefined ? {} : { $was: { doc: { title: was } } },
        }]),
      }),
    )
  assertEquals((await write('current')).status, 200)
  let stale = await write('next', token('older'))
  let { error, current } = await stale.json()
  assertEquals([stale.status, error, current, o.restarts], [
    409,
    'Stale',
    'current',
    [],
  ])
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

test('a call the older code has no door for is skew its caller sends again, and the store keeps running', async () => {
  let o = object()
  let answer = await older(o).fetch(asked('/nowhere'))
  let { error, retryable } = await answer.json()
  assertEquals([answer.status, error, retryable, o.restarts], [
    503,
    'Skewed',
    true,
    [],
  ])
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

test('a call the old deploy refuses is answered by the new one once the runtime moves the store', async () => {
  learn(B)
  let o = object()
  let old = older(o), sent = 0
  // The runtime moves the store onto the new code between the first send and
  // the resend; the old incarnation never restarts itself.
  let next = {
    fetch: () => Promise.resolve(new Response('', { status: 404 })),
  }
  let ns = {
    idFromName: (name: string) => name,
    get: () => sent++ ? next : old,
  }
  let answer = await storeOf(ns, 'ada/cookbook', undefined, unpaused)(
    '/nowhere',
    { method: 'POST', body: '{}' },
  )
  assertEquals([answer.status, sent, o.restarts], [404, 2, []])
})

// The Wire and the Builder are reached through `fetchOf`, which stamps the
// caller's deploy the way a store's door does (T-123489). Each is one
// incarnation here.
let through = (object: { fetch(req: Request): Promise<Response> }) =>
  fetchOf({ idFromName: (n: string) => n, get: () => object }, 'ada', unpaused)

test('a Wire on an older deploy serves a newer caller without restarting', async () => {
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
  assertEquals((await through(wire)(roster)).status, 200)
  assertEquals(r.restarts, [])
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

// A Worker on a newer deploy than its Store (T-140262), whose code update the
// runtime defers. A write naming a word the older code does not know is no
// mistake of the caller's: the store answers a failure the caller's door
// sends again, and the caller reports what the newer code says or, with none,
// that the store stayed behind.
// A store behind its caller, which refuses a word only the caller's deploy
// declares; the next incarnation answers `next`, or with none, the runtime
// keeps the older code. Answers what the caller got, and what the tracker
// heard.
let behind = async (next?: Response) => {
  learn(B)
  let reports: unknown[] = []
  let o = object()
  let ctx = Object.assign(state(), { abort: o.abort })
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

let space = mint(), app = mint(), hostname = mint(), contract = mint()
let host = 'crayons.example'
let serves = `.hostnames_serves.hostname.name=${host}`
let domain = `(.hostname.name=${host})|(.app&${serves})|` +
  `(.space&(${serves}|.apps${serves}))`
let v = platformVocab()
let withoutSupport = loadVocab(v.docs.map((doc) => ({
  ...doc,
  $defs: Object.fromEntries(
    Object.entries(doc.$defs ?? {}).filter(([word]) =>
      !word.startsWith('support_contract')
    ),
  ),
})))
let updated = new Store(state(PLATFORM_STORE), {
  CF_VERSION_METADATA: B,
  CLOCK: clock(),
})
let seeded = await updated.fetch(
  new Request('http://store/apply', {
    method: 'POST',
    headers: { 'x-store': PLATFORM_STORE, ...KERNEL },
    body: JSON.stringify([
      { entity: { eid: space }, space: { slug: 'crayons', store: 'crayons' } },
      { entity: { eid: app }, app: { slug: 'coloring', space, version: 1 } },
      {
        entity: { eid: hostname },
        hostname: { name: host, serves: app, space },
      },
      {
        entity: { eid: contract },
        support_contract: { space, monthly: 120, start: '2026-11-01' },
      },
    ]),
  }),
)
assertEquals(seeded.status, 200, await seeded.text())

// The previous Directory's batch body has one status per line. Only its
// single query route sends the deployment-skew envelope on the wire.
let rollout = (
  read: (q: string) => Response,
  time?: ReturnType<typeof clock>,
) => {
  learn(B)
  let old = true, paths: string[] = []
  let previous = async (req: Request) => {
    let { pathname, searchParams } = new URL(req.url)
    paths.push(pathname)
    if (!old || (time?.now() ?? 0) >= 16_000) return updated.fetch(req)
    if (pathname == READS) {
      return readsAnswer(searchParams.getAll('q').map(read))
    }
    let answer = read(searchParams.get('q')!)
    let lag = await skewed(req.headers, A, answer)
    if (!lag) return answer
    let { name, message, retryable, running, caller, refusal } = lag
    return Response.json({
      error: name,
      message,
      retryable,
      running,
      caller,
      refusal,
    }, {
      status: 503,
    })
  }
  let door = storeOf(
    {
      idFromName: (name) => name,
      get: () => ({ fetch: previous }),
    },
    PLATFORM_STORE,
    undefined,
    (ms) => {
      if (time) return sleep(ms, undefined, time)
      old = false
      return Promise.resolve()
    },
  )
  let via = servingDirectory(
    {
      fetch: (req) => {
        let { pathname, search } = new URL(req.url)
        return door(pathname + search, req, KERNEL)
      },
    },
    time && {
      time,
      copy: {
        begin: () => Promise.resolve(0),
        finish: () => Promise.resolve(true),
        put: () => Promise.resolve(true),
        get: () => Promise.resolve(null),
      },
    },
  )
  let ask = (q: string) =>
    via.fetch(
      new Request(`http://store/query?q=${encodeURIComponent(q)}`),
    )
  let rows = async (q: string): Promise<Bundle[]> => {
    let answer = await ask(q)
    if (!answer.ok) throw await answered(answer)
    return await answer.json()
  }
  return { rows, ask, paths }
}

test('a custom-domain lookup waits through the older reverse-association compiler refusal', async () => {
  // The refusal the CrayonBloom request received from the old compiler.
  let { paths, rows } = rollout(() => refuse(new Unknown('hostnames_serves')))
  let found = await within({}, {}, () => rows(domain))
  assertEquals(
    found.map((row) => row.entity.eid).sort(),
    [space, app, hostname].sort(),
  )
  assertEquals(paths, ['/query', '/query'])
})

test('Billing reads the support contract through a batch during a Directory rollout', async () => {
  let time = clock()
  let { paths, rows, ask } = rollout((q) => {
    try {
      compile(parse(q), withoutSupport)
      return Response.json([{ entity: { eid: space } }], {
        headers: { [EPOCH]: '0' },
      })
    } catch (e) {
      return refuse(e)
    }
  }, time)
  let [bill, good, unknown] = await within({}, {}, () =>
    [
      oneContract(rows, walkTo('crayons', space), '2026-11-25'),
      rows('.space'),
      ask('.unheard_of'),
    ] as const)
  let [known, typo] = await Promise.all([good, unknown])
  assertEquals(time.now(), 0)
  for (let pause of backoff.pauses) await time.advance(pause)
  let support = await bill
  assertEquals(
    [support?.eid, support?.left, known[0]?.entity.eid, typo.status],
    [
      contract,
      120,
      space,
      400,
    ],
  )
  assertEquals(paths[0], READS)
  assert(paths.slice(1).every((path) => path == '/query'))
})

test('the trusted Directory read that wakes a restored app carries the kernel vouch across deploys', async () => {
  learn(B)
  let old = older(object()), sent = 0
  let door = storeOf(
    {
      idFromName: (name) => name,
      get: () => ({ fetch: (req) => (sent++, old.fetch(req)) }),
    },
    PLATFORM_STORE,
    undefined,
    unpaused,
  )
  assertEquals(await metaOf(door).query('.space', { trusted: true }), [])
  assertEquals(sent, 1)
})

test('a trusted query without the kernel vouch is refused once across a rollout', async () => {
  learn(B)
  let old = older(object())
  let no = { error: 'Refused', message: 'trusted queries require the kernel' }
  let legacy = () =>
    Promise.resolve(Response.json({
      error: 'Skewed',
      message:
        `Durable Object on an older deploy refused a caller on a newer one: ${no.message}`,
      retryable: true,
      refusal: { status: 400, body: no },
    }, { status: 503 }))
  for (let first of [(req: Request) => old.fetch(req), legacy]) {
    let sent = 0
    let door = storeOf(
      {
        idFromName: (name) => name,
        get: () => ({ fetch: (req) => (sent++, first(req)) }),
      },
      PLATFORM_STORE,
      undefined,
      unpaused,
    )
    let answer = await door('/query?q=.space&trusted=1')
    assertEquals([sent, answer.status, await answer.json()], [1, 400, no])
  }
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
