/// <reference lib="deno.ns" />
// The door, through its one interface: a request in, a response out, against
// an app's store (@yaks/ram) and a Realtime that answers the way Cloudflare's
// schema says it does.

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

// An app's store, a meter with its allowance, and a door over both.
let app = (allowance = Infinity) => {
  let vocab = loadVocab([wakeDoc, rtcDoc])
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
    spend: (d: number) => Promise.resolve(spent += d),
  }
  let rt = cloud()
  let now = T0
  let call = async (
    method: string,
    path: string,
    body?: unknown,
    key?: string,
  ) => {
    let res = await answer({
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
    return { status: res.status, body: await res.json() }
  }
  let open = async () => (await call('POST', '/sessions/new')).body
  return {
    g,
    rt,
    call,
    open,
    store,
    get spent() {
      return spent
    },
    wait: (ms: number) => void (now += ms),
    sfu: async () => await g.read('.sfu&?wake'),
  }
}

Deno.test('opening a session keeps it here under a lease, and hands its key back once', async () => {
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

Deno.test('a session opens at the ceiling as a refusal, and nothing at Realtime', async () => {
  let a = app(0)
  let { status, body } = await a.call('POST', '/sessions/new')
  assertEquals(status, 429)
  assertEquals(body.error, { code: 'limit', message: 'the allowance is spent' })
  assertEquals(a.rt.sent, [])
})

Deno.test('a change to a session carries the key it was opened with', async () => {
  let a = app()
  let s = await a.open()
  let offer = { sessionDescription: { type: 'offer', sdp: 'v=0' } }
  let tracks = [{ location: 'local', mid: '0', trackName: 'voice' }]
  assertEquals(
    (await a.call('POST', '/sessions/s1/tracks/new', { ...offer, tracks }))
      .body.error.code,
    'not_yours',
  )
  assertEquals(
    (await a.call('POST', '/sessions/s1/tracks/new', { ...offer, tracks }, 'x'))
      .status,
    403,
  )
  let { status } = await a.call(
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

Deno.test('a session subscribes only to sessions this store holds, and not at the ceiling', async () => {
  let a = app(1)
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

Deno.test('a renewal moves the lease, and weighs what the session receives over the time it adds', async () => {
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

Deno.test('a lapsed lease closes what the session still has open, and forgets it', async () => {
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

Deno.test('ICE servers come from TURN, asked with its own token', async () => {
  let a = app()
  let { status, body } = await a.call('POST', '/ice')
  assertEquals(status, 201)
  assertEquals(body.iceServers, [{ urls: 'turn:x' }])
  let [sent] = a.rt.sent
  assertEquals(sent.path, '/turn/keys/k1/credentials/generate-ice-servers')
  assertEquals(sent.auth, 'Bearer turn-secret')
})
