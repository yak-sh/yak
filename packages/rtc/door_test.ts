/// <reference lib="deno.ns" />
// The door, through its one interface: a request in, a response out, against
// an app's store (@yaks/ram) and a Realtime that answers the way Cloudflare's
// schema says it does.

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { wakeDoc } from '@yaks/wake/vocab'
import { answer, KEY, lapse, LEASE, type Realtime } from './door.ts'
import { rtcDoc } from './vocab.ts'

let T0 = Date.parse('2026-09-26T12:00:00Z')

let of = (b: Bundle, name: string) => (b[name] ?? {}) as Comp

// deno-lint-ignore no-explicit-any
type Sent = { method: string; path: string; auth: string; body: any }

// Realtime: sessions it opened, what each receives, and every call it heard.
let cloud = () => {
  let sent: Sent[] = []
  let n = 0
  let receiving: Record<string, { mid: string; location: string }[]> = {}
  let answered = (url: string | URL | Request, init: RequestInit = {}) => {
    let path = new URL(String(url)).pathname.replace('/v1', '')
    let body = init.body ? JSON.parse(String(init.body)) : undefined
    let auth = new Headers(init.headers).get('authorization') ?? ''
    sent.push({ method: init.method ?? 'GET', path, auth, body })
    if (path.endsWith('/sessions/new')) {
      return Response.json({ sessionId: `s${++n}` }, { status: 201 })
    }
    if (path.includes('/generate-ice-servers')) {
      let iceServers = [{ urls: 'turn:x' }]
      return Response.json({ iceServers }, { status: 201 })
    }
    let [, id, rest] = /sessions\/([^/]+)\/?(.*)$/.exec(path) ?? []
    if (!rest && init.method == 'GET') {
      let tracks = receiving[id] ?? []
      return Response.json({
        tracks: tracks.map((t) => ({ ...t, status: 'active' })),
      })
    }
    return Response.json({ tracks: body?.tracks ?? [] })
  }
  let realtime: Realtime = {
    app: 'app1',
    token: 'secret',
    turn: { key: 'k1', token: 'turn-secret' },
    api: 'https://rtc.test/v1',
    fetch: (url, init) => Promise.resolve(answered(url, init)),
  }
  return { sent, receiving, realtime }
}

let vocab = loadVocab([wakeDoc, rtcDoc])

// An app's store, a meter with its allowance, and a door over both.
let app = (allowance = Infinity) => {
  let g = graph({ storage: ram(vocab), vocab })
  let store = {
    read: async (q: string) => await g.read(q),
    // the host writes as itself: `sfu` is no client's to write
    write: async (bs: Bundle[]) => await g.apply(bs, { trusted: true }),
  }
  let spent = 0
  let meter = {
    refused: () =>
      Promise.resolve(spent >= allowance ? 'the allowance is spent' : null),
    reserve: (dollars: number) => {
      if (spent + dollars > allowance) {
        return Promise.resolve('the allowance is spent')
      }
      spent += dollars
      return Promise.resolve({
        settle: (cost: number) => Promise.resolve(spent += cost - dollars),
      })
    },
  }
  let rt = cloud()
  let now = T0
  let send = async (
    method: string,
    path: string,
    body?: unknown,
    key?: string,
  ) => {
    return await answer({
      req: new Request(`https://a.test/api/rtc${path}`, {
        method,
        headers: key ? { [KEY]: key } : {},
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      path,
      store,
      meter,
      realtime: rt.realtime,
      rates: { track: 1, channel: 0.5 },
      now: () => now,
    })
  }
  let call = async (...args: Parameters<typeof send>) => {
    let res = await send(...args)
    return { status: res.status, body: await res.json() }
  }
  let open = async () => (await call('POST', '/sessions/new')).body
  return {
    g,
    rt,
    call,
    send,
    open,
    store,
    get spent() {
      return spent
    },
    wait: (ms: number) => void (now += ms),
    sfu: async () => await g.read('.sfu&?wake'),
  }
}

test('opening a session keeps it here under a lease, and hands its key back once', async () => {
  let a = app()
  let { status, body } = await a.call('POST', '/sessions/new')
  assertEquals(status, 201)
  assertEquals(body.sessionId, 's1')
  assert(body.key.length >= 32)
  let [row] = await a.sfu()
  assertEquals(of(row, 'sfu').session, 's1')
  assert(of(row, 'sfu').key != body.key)
  assertEquals(of(row, 'wake').at, new Date(T0 + LEASE).toISOString())
  assertEquals(a.rt.sent[0].auth, 'Bearer secret')
})

test('a session opens at the ceiling as a refusal, and nothing at Realtime', async () => {
  let a = app(0)
  let { status, body } = await a.call('POST', '/sessions/new')
  assertEquals(status, 429)
  assertEquals(body.error, { code: 'limit', message: 'the allowance is spent' })
  assertEquals(a.rt.sent, [])
})

// Open this client's session once; the test exercises changes through the door.
let changing = app()
let changingSession = await changing.open()
let offer = { sessionDescription: { type: 'offer', sdp: 'v=0' } }
let tracks = [{ location: 'local', mid: '0', trackName: 'voice' }]
let noKey = await changing.call('POST', '/sessions/s1/tracks/new', {
  ...offer,
  tracks,
})
let wrongKey = await changing.send(
  'POST',
  '/sessions/s1/tracks/new',
  { ...offer, tracks },
  'x',
)
test('a change to a session carries the key it was opened with', async () => {
  let a = changing
  let s = changingSession
  assertEquals(noKey.body.error.code, 'not_yours')
  assertEquals(wrongKey.status, 403)
  let { status } = await a.send(
    'POST',
    '/sessions/s1/tracks/new',
    { ...offer, tracks },
    s.key,
  )
  assertEquals(status, 200)
  let last = a.rt.sent.at(-1)!
  assertEquals(last.path, '/apps/app1/sessions/s1/tracks/new')
  assertEquals(last.body, { ...offer, tracks })
})

test('a session subscribes only to sessions this store holds, and not at the ceiling', async () => {
  let a = app(60)
  let me = await a.open()
  await a.open()
  let hear = (sessionId: string) =>
    a.call('POST', '/sessions/s1/tracks/new', {
      tracks: [{ location: 'remote', sessionId, trackName: 'voice' }],
    }, me.key)
  assertEquals((await hear('elsewhere')).status, 404)
  assertEquals((await hear('s2')).status, 200)
  a.rt.receiving.s1 = [{ mid: '1', location: 'remote' }]
  a.wait(30_000)
  await a.call('POST', '/sessions/s1/renew', undefined, me.key)
  assertEquals((await hear('s2')).body.error.code, 'limit')
})

test('a renewal moves the lease, and weighs what the session receives over the time it adds', async () => {
  let a = app()
  let me = await a.open()
  a.rt.receiving.s1 = [
    { mid: '0', location: 'local' },
    { mid: '1', location: 'remote' },
    { mid: '2', location: 'remote' },
  ]
  a.wait(30_000)
  let { status, body } = await a.call(
    'POST',
    '/sessions/s1/renew',
    undefined,
    me.key,
  )
  assertEquals(status, 200)
  let until = new Date(T0 + 30_000 + LEASE).toISOString()
  assertEquals(body, { until })
  assertEquals(of((await a.sfu())[0], 'wake').at, until)
  // two remote tracks at a dollar a second, for the thirty seconds added
  assertEquals(a.spent, 60)
})

test('a lapsed lease closes what the session still has open, and forgets it', async () => {
  let a = app()
  await a.open()
  a.rt.receiving.s1 = [{ mid: '3', location: 'remote' }]
  let [row] = await a.sfu()
  await lapse(a.rt.realtime, a.store, row)
  assertEquals(a.rt.sent.at(-1)!.path, '/apps/app1/sessions/s1/tracks/close')
  assertEquals(a.rt.sent.at(-1)!.body, { tracks: [{ mid: '3' }], force: true })
  assertEquals(await a.sfu(), [])
  let key = 'any'
  assertEquals(
    (await a.call('POST', '/sessions/s1/renew', undefined, key)).status,
    404,
  )
})

test('ICE servers come from TURN, asked with its own token', async () => {
  let a = app()
  let { status, body } = await a.call('POST', '/ice')
  assertEquals(status, 201)
  assertEquals(body.iceServers, [{ urls: 'turn:x' }])
  let [sent] = a.rt.sent
  assertEquals(sent.path, '/turn/keys/k1/credentials/generate-ice-servers')
  assertEquals(sent.auth, 'Bearer turn-secret')
})

let capped = app(29)
let cappedSession = await capped.open()
let cappedUntil = of((await capped.sfu())[0], 'wake').at
capped.rt.receiving.s1 = [{ mid: '1', location: 'remote' }]
capped.wait(30_000)

test('a renewal cannot extend a lease past the remaining dollars', async () => {
  let res = await capped.call(
    'POST',
    '/sessions/s1/renew',
    undefined,
    cappedSession.key,
  )
  assertEquals(res.status, 429)
  assertEquals(capped.spent, 0)
  assertEquals(of((await capped.sfu())[0], 'wake').at, cappedUntil)
})

let subscribing = app(29)
let subscribingSession = await subscribing.open()
await subscribing.open()
subscribing.wait(30_000)

test('a subscription pays its existing lease before reaching Realtime', async () => {
  let before = subscribing.rt.sent.length
  let res = await subscribing.call('POST', '/sessions/s1/tracks/new', {
    tracks: [{ location: 'remote', sessionId: 's2', trackName: 'voice' }],
  }, subscribingSession.key)
  assertEquals(res.status, 429)
  assertEquals(subscribing.spent, 0)
  assertEquals(subscribing.rt.sent.length, before)
})

let prepaid = app(60)
let prepaidSession = await prepaid.open()
await prepaid.open()
prepaid.wait(30_000)

test('subscription and renewal each pay only their own lease seconds', async () => {
  let res = await prepaid.call('POST', '/sessions/s1/tracks/new', {
    tracks: [{ location: 'remote', sessionId: 's2', trackName: 'voice' }],
  }, prepaidSession.key)
  assertEquals(res.status, 200)
  assertEquals(prepaid.spent, 30)
  prepaid.rt.receiving.s1 = [{ mid: '1', location: 'remote' }]
  res = await prepaid.call(
    'POST',
    '/sessions/s1/renew',
    undefined,
    prepaidSession.key,
  )
  assertEquals(res.status, 200)
  assertEquals(prepaid.spent, 60)
})

let concurrent = app(60)
let concurrentSession = await concurrent.open()
await concurrent.open()

test('concurrent subscriptions share the dollars left for their leases', async () => {
  let subscribe = () =>
    concurrent.call('POST', '/sessions/s1/tracks/new', {
      tracks: [{ location: 'remote', sessionId: 's2', trackName: 'voice' }],
    }, concurrentSession.key)
  let results = await Promise.all([subscribe(), subscribe()])
  assertEquals(results.map((r) => r.status).sort(), [200, 429])
  assertEquals(concurrent.spent, 60)
})

let rejected = app(60)
let rejectedSession = await rejected.open()
await rejected.open()
let rejectedFetch = rejected.rt.realtime.fetch!
rejected.rt.realtime.fetch = (url, init) =>
  String(url).endsWith('/tracks/new')
    ? Promise.resolve(
      Response.json({ errorCode: 'bad_track' }, { status: 400 }),
    )
    : rejectedFetch(url, init)

test('a subscription Realtime refuses releases its lease dollars', async () => {
  let res = await rejected.call('POST', '/sessions/s1/tracks/new', {
    tracks: [{ location: 'remote', sessionId: 's2', trackName: 'voice' }],
  }, rejectedSession.key)
  assertEquals(res.status, 400)
  assertEquals(rejected.spent, 0)
})

let renewals = app(60)
let renewalsSession = await renewals.open()
renewals.rt.receiving.s1 = [{ mid: '1', location: 'remote' }]
renewals.wait(30_000)

test('concurrent renewals charge a lease extension once', async () => {
  let renew = () =>
    renewals.call('POST', '/sessions/s1/renew', undefined, renewalsSession.key)
  let results = await Promise.all([renew(), renew()])
  assertEquals(results.map((r) => r.status), [200, 200])
  assertEquals(renewals.spent, 30)
})
