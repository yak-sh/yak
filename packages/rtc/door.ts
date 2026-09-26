// The host half: the door a page reaches Cloudflare Realtime through. It
// answers Realtime's own paths and bodies (sessions/new, tracks/new,
// renegotiate, tracks/close, datachannels/new, GET a session) for one app, so
// Cloudflare's pages apply word for word, and TURN's ICE servers at `ice`. The
// app secret stays here: a page holds nothing but the key its own session was
// opened with.
//
// Realtime has no rooms and no permissions of its own: "A room name, session
// ID, or track name does not establish permission". So the door keeps them,
// as rows in the app's own store. Every session it opens is an `sfu` row there
// while its lease holds, and every session a call names, the caller's own or
// a remote one it subscribes to, must be one of them, so one app never reaches
// another's. A change to a session carries the key the door handed back when
// it opened it (`x-yak-rtc-key`), which a signed-out visitor holds as well as
// a member: the session id alone is no proof, since the `rtc` component
// relays it to every listener.
//
// The lease is a `wake` on the row, one minute out. The page renews it about
// every half minute (`sessions/<id>/renew`, the one path Realtime does not
// have), and each renewal weighs the time it extends the lease by: the remote
// tracks and channels the session receives, each at its rate, counted on the
// host's meter. Cloudflare reports no bytes per session, so the space pays
// this estimate. A lease that lapses fires the wake, and {@link lapse} closes
// the session's tracks at Cloudflare and drops the row.
//
// The host hands the door everything it knows about the caller's world: the
// store, the meter, the rates and the account. The door serves no route
// itself, the way @yaks/egress is handed each call.

import type { Bundle, Comp } from '@yaks/graph'

/** Cloudflare Realtime's API, as documented at
 * developers.cloudflare.com/realtime/sfu/https-api/. */
export let API = 'https://rtc.live.cloudflare.com/v1'

/** How long a lease runs past its last renewal, in milliseconds. */
export let LEASE = 60_000

/** The header a change to a session carries its opener's key in. */
export let KEY = 'x-yak-rtc-key'

/** The account the door speaks for: an SFU app and its secret, and a TURN key
 * and its token where the host has one. */
export type Realtime = {
  app: string
  token: string
  turn?: { key: string; token: string }
  /** Realtime's address, for a test; {@link API} otherwise */
  api?: string
  fetch?: typeof fetch
}

/** What a session costs a second, in dollars, per remote track and per remote
 * DataChannel it receives. */
export type Rates = { track: number; channel: number }

/** The app's store, as far as the door reads and writes it. */
export type Store = {
  read: (query: string) => Promise<Bundle[]>
  write: (bundles: Bundle[]) => Promise<unknown>
}

/** The space's allowance: the sentence that refuses a spend when it is used
 * up, or null, and the count of one that went ahead. */
export type Meter = {
  refused: () => Promise<string | null>
  spend: (dollars: number) => Promise<unknown>
}

/** One call to the door. */
export type Ask = {
  req: Request
  /** the path within the door: `/sessions/new`, `/ice` */
  path: string
  store: Store
  meter: Meter
  realtime: Realtime
  rates: Rates
  /** a label TURN reports usage under (its customIdentifier) */
  label?: string
  /** what went wrong that the caller could not have caused */
  report?: (e: unknown) => void
  now?: () => number
}

/** A refusal, the way every yaks door says one. */
export let refusal = (
  status: number,
  code: string,
  message: string,
): Response =>
  Response.json({ error: { code, message } }, {
    status,
    headers: { 'cache-control': 'no-store' },
  })

let hex = (b: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(b)].map((n) => n.toString(16).padStart(2, '0')).join('')

/** A fresh key for a session's opener. */
let minted = () => hex(crypto.getRandomValues(new Uint8Array(32)))

/** What the row keeps of a key: its SHA-256. */
export let hashed = async (key: string): Promise<string> =>
  hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)))

let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp

/** The row a session's lease is, or undefined for a session this store did
 * not open or whose lease lapsed. */
let leased = async (store: Store, session: string) =>
  (await store.read(`.sfu.session=${JSON.stringify(session)}&?wake`))[0]

/** A remote track or channel as a request body names it. */
type Named = { location?: string; sessionId?: string }

/** The sessions a request body subscribes to: its remote tracks and remote
 * DataChannels. */
export let remotes = (body: unknown): string[] => {
  let b = (body ?? {}) as { tracks?: Named[]; dataChannels?: Named[] }
  let named = [...b.tracks ?? [], ...b.dataChannels ?? []]
  return named.filter((t) => t?.location == 'remote').map((t) =>
    String(t.sessionId ?? '')
  )
}

/**
 * What a session receives costs a second: its active remote tracks and
 * channels, each at its rate, as Realtime's own reading of the session says
 * them.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { rate } from './door.ts'
 *
 * let state = {
 *   tracks: [
 *     { location: 'local', status: 'active' },
 *     { location: 'remote', status: 'active' },
 *     { location: 'remote', status: 'inactive' },
 *   ],
 *   dataChannels: [{ location: 'remote', status: 'active' }],
 * }
 * assertEquals(rate(state, { track: 3, channel: 1 }), 4)
 * ```
 */
export let rate = (state: unknown, rates: Rates): number => {
  let s = (state ?? {}) as {
    tracks?: { location?: string; status?: string }[]
    dataChannels?: { location?: string; status?: string }[]
  }
  let live = (xs: { location?: string; status?: string }[] = []) =>
    xs.filter((x) => x.location == 'remote' && x.status != 'inactive').length
  return live(s.tracks) * rates.track + live(s.dataChannels) * rates.channel
}

// The calls on a session, by method and what follows its id: whether the body
// may subscribe to another session, which is what the allowance is asked for.
let CALLS: Record<string, { method: string; subscribes?: boolean }> = {
  'tracks/new': { method: 'POST', subscribes: true },
  'renegotiate': { method: 'PUT' },
  'tracks/close': { method: 'PUT' },
  'tracks/update': { method: 'PUT' },
  'datachannels/new': { method: 'POST', subscribes: true },
  'datachannels/close': { method: 'PUT' },
  '': { method: 'GET' },
}

let SESSION = /^\/sessions\/([A-Za-z0-9_-]+)(?:\/(.*))?$/

/** Answer one call to the door. */
export let answer = async (ask: Ask): Promise<Response> => {
  let { req, path } = ask
  try {
    if (path == '/ice') {
      return req.method == 'POST' ? await ice(ask) : wrongMethod()
    }
    if (path == '/sessions/new') {
      return req.method == 'POST' ? await open(ask) : wrongMethod()
    }
    let m = SESSION.exec(path)
    if (!m) return refusal(404, 'not_found', `no Realtime call at ${path}`)
    let [, session, rest = ''] = m
    if (rest == 'renew') {
      return req.method == 'POST' ? await renew(ask, session) : wrongMethod()
    }
    let call = CALLS[rest]
    if (!call) return refusal(404, 'not_found', `no Realtime call at ${path}`)
    if (req.method != call.method) return wrongMethod()
    return await called(ask, session, rest, call.subscribes ?? false)
  } catch (e) {
    ask.report?.(e)
    return refusal(
      502,
      'unavailable',
      'Cloudflare Realtime could not be reached; try again in a moment',
    )
  }
}

let wrongMethod = () =>
  refusal(405, 'method_not_allowed', 'that method is not answered here')

// Realtime itself, with the app's secret.
let realtime = (r: Realtime, method: string, path: string, body?: unknown) =>
  (r.fetch ?? fetch)(`${r.api ?? API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${r.token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

// Realtime's answer, passed back as it came: its status and its JSON.
let relayed = async (res: Response, more: Record<string, unknown> = {}) => {
  let body = await res.json().catch(() => null)
  if (res.status >= 500) throw new Error(`Realtime ${res.status}`)
  return Response.json(
    body && typeof body == 'object' ? { ...body, ...more } : body,
    { status: res.status, headers: { 'cache-control': 'no-store' } },
  )
}

let body = async (req: Request): Promise<unknown> => {
  let text = await req.text()
  if (!text) return undefined
  return JSON.parse(text)
}

let iso = (ms: number) => new Date(ms).toISOString()

// sessions/new: a session at Realtime, and its row here with a lease a minute
// out. The key goes back to the opener once and is kept only as its hash.
let open = async (ask: Ask) => {
  let no = await ask.meter.refused()
  if (no) return refusal(429, 'limit', no)
  let sent = await body(ask.req).catch(() => null)
  if (sent === null) return refusal(400, 'bad_request', 'the body is not JSON')
  let res = await realtime(
    ask.realtime,
    'POST',
    `/apps/${ask.realtime.app}/sessions/new`,
    sent,
  )
  if (!res.ok) return await relayed(res)
  let opened = await res.json() as { sessionId?: string }
  if (!opened.sessionId) throw new Error('Realtime opened no session')
  let key = minted()
  let now = (ask.now ?? Date.now)()
  await ask.store.write([{
    entity: { eid: crypto.randomUUID() },
    sfu: { session: opened.sessionId, key: await hashed(key) },
    wake: {
      at: iso(now + LEASE),
      note: 'close the Realtime session when its lease ends',
    },
  }])
  return Response.json({ ...opened, key }, {
    status: res.status,
    headers: { 'cache-control': 'no-store' },
  })
}

// The row of a session the caller opened, or the refusal that says why not.
let owned = async (ask: Ask, session: string) => {
  let row = await leased(ask.store, session)
  if (!row) {
    return refusal(
      404,
      'not_found',
      `no open session ${session} here; its lease may have ended`,
    )
  }
  let key = ask.req.headers.get(KEY) ?? ''
  if (!key || await hashed(key) != comp(row, 'sfu').key) {
    return refusal(403, 'not_yours', `session ${session} was opened by another`)
  }
  return row
}

// A call on one session: the caller's own, subscribing only to sessions this
// store holds, and asking the allowance before it subscribes.
let called = async (
  ask: Ask,
  session: string,
  rest: string,
  subscribes: boolean,
) => {
  let row = await owned(ask, session)
  if (row instanceof Response) return row
  let sent = ask.req.method == 'GET'
    ? undefined
    : await body(ask.req).catch(() => null)
  if (sent === null) return refusal(400, 'bad_request', 'the body is not JSON')
  let them = subscribes ? remotes(sent) : []
  for (let other of new Set(them)) {
    if (!other || !await leased(ask.store, other)) {
      return refusal(404, 'not_found', `no open session ${other} here`)
    }
  }
  if (them.length) {
    let no = await ask.meter.refused()
    if (no) return refusal(429, 'limit', no)
  }
  let tail = rest ? `/${rest}` : ''
  return await relayed(
    await realtime(
      ask.realtime,
      ask.req.method,
      `/apps/${ask.realtime.app}/sessions/${session}${tail}`,
      sent,
    ),
  )
}

// A renewal: the lease a minute out from now, and what the session receives
// weighed over the time that adds.
let renew = async (ask: Ask, session: string) => {
  let row = await owned(ask, session)
  if (row instanceof Response) return row
  let no = await ask.meter.refused()
  if (no) return refusal(429, 'limit', no)
  let res = await realtime(
    ask.realtime,
    'GET',
    `/apps/${ask.realtime.app}/sessions/${session}`,
  )
  if (!res.ok) return await relayed(res)
  let now = (ask.now ?? Date.now)()
  let was = Date.parse(String(comp(row, 'wake').at ?? '')) || now
  let until = now + LEASE
  let seconds = Math.max(0, until - Math.max(was, now)) / 1000
  let dollars = rate(await res.json(), ask.rates) * seconds
  if (dollars > 0) await ask.meter.spend(dollars)
  await ask.store.write([{
    entity: { eid: row.entity.eid },
    wake: { at: iso(until) },
  }])
  return Response.json({ until: iso(until) }, {
    headers: { 'cache-control': 'no-store' },
  })
}

// TURN's ICE servers, for as long as a session is likely to last.
let ice = async (ask: Ask) => {
  let turn = ask.realtime.turn
  if (!turn) {
    return Response.json({
      iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
    })
  }
  let res = await realtime(
    { ...ask.realtime, token: turn.token },
    'POST',
    `/turn/keys/${turn.key}/credentials/generate-ice-servers`,
    { ttl: 4 * 3600, ...(ask.label ? { customIdentifier: ask.label } : {}) },
  )
  return await relayed(res)
}

/**
 * A lease that lapsed: every track and channel still open on the session
 * closed at Realtime, so nothing more is received on it or sent from it, and
 * the row dropped. Run when the row's wake fires. A session Realtime no
 * longer knows has nothing to close.
 */
export let lapse = async (
  r: Realtime,
  store: Store,
  row: Bundle,
): Promise<void> => {
  let session = String(comp(row, 'sfu').session ?? '')
  if (session) {
    let res = await realtime(r, 'GET', `/apps/${r.app}/sessions/${session}`)
    if (res.ok) {
      let state = await res.json() as {
        tracks?: { mid?: string; status?: string }[]
      }
      let mids = (state.tracks ?? []).filter((t) =>
        t.mid && t.status != 'inactive'
      ).map((t) => ({ mid: t.mid }))
      if (mids.length) {
        await realtime(
          r,
          'PUT',
          `/apps/${r.app}/sessions/${session}/tracks/close`,
          { tracks: mids, force: true },
        )
      }
    }
  }
  await store.write([{ entity: { eid: row.entity.eid }, $delete: true }])
}
