/** Live rooms in an app's worker: invitation-only rooms of a few seats, each
 * seat bound to the browser that took it, over the app's store. The worker
 * hosts and joins rooms, rotates the invitation, answers one room-scoped
 * query and socket per seat, and writes an action's batch only when the app's
 * rules accept it. The rules (what a room holds, what an action does, whose
 * turn it is) are the app's: {@link RoomRules}. */
import type { Bundle } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'
import { digest, token } from '@yaks/graph/sha256'
import { workerUpgrade } from '@yaks/workerd/upgrade'
import { roomId, RoomRefused, type Seat } from './seat.ts'

export * from './seat.ts'

/** A door the worker is given: the app's store (`APP`) or its files. */
export type Door = {
  fetch(path: string, init?: RequestInit): Promise<Response>
}
/** The worker's bindings; `ROOM_PAGE` is the file served at `room`, the
 * address an invitation opens (`/room.html` when left out). */
export type RoomEnv = { APP: Door; FILES: Door; ROOM_PAGE?: string }

/** A room as its `game_room` row keeps it: the invitation's digest and the
 * seats in the order they were taken. */
export type Room = { invite: string; seats: string[] }

/** What an app says about its rooms. */
export type RoomRules<A> = {
  /** The query for the rows the room shows its seats, the same on the page
   * (`connectRoom`) and here. Never name `game_room` in it: that row holds
   * the invitation's digest. */
  line: (room: string) => string
  /** The rows a new room starts with beside its `game_room`, such as the
   * first turn; `member` is the host's seat. */
  open?: (member: Seat) => Bundle[]
  /** The rows a seat brings when it is taken; `order` counts from 0, the
   * host's. */
  seat?: (member: Seat, order: number) => Bundle[]
  /** The batch `action` writes, from the room's rows (`line`) and its seats.
   * Throw {@link RoomRefused} to decline it. Guard the turn with `$was`, so
   * of two answers to one turn only the first lands. */
  act: (
    member: Seat,
    seats: string[],
    rows: Bundle[],
    action: A,
    random: () => number,
  ) => Bundle[]
  /** A seat's relayed bundle (a peer component, such as where it points) as
   * the room passes it on, rebuilt from `member`; undefined drops it. Left
   * out, a seat relays nothing. */
  relay?: (member: Seat, bundle: Bundle) => Bundle | undefined
  /** How many seats a room has: 4 when left out. */
  seats?: number
}

let refuse = (status: number, message: string) =>
  Response.json({ error: 'room_action', message }, { status })
let denied = () => refuse(403, 'This room needs an invitation.')
let query = (line: string) => '/query?q=' + encodeURIComponent(line)
let rows = async (store: Door, line: string): Promise<Bundle[]> => {
  let response = await store.fetch(query(line))
  if (!response.ok) throw new Error(`Game room read: HTTP ${response.status}`)
  return await response.json()
}
let apply = (store: Door, bundles: Bundle[]) =>
  store.fetch('/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(bundles),
  })
let body = (req: Request) => req.json().catch(() => null)
let packet = (member: Seat, data = {}) =>
  Response.json({ ...member, ...data }, {
    headers: { 'cache-control': 'no-store' },
  })
let word = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 128

/** The seat a browser holds in a room: the same one every time it comes
 * back. */
export let seatOf = (room: string, browser: string): Seat => ({
  room,
  seat: identityEid('game_seat', [room, browser]),
})

/** The frames a seat's socket may send to the store, rebuilt: the one
 * subscription to `line`, its acks and clock, and the seat's relays as
 * `relay` passes them. Anything else is dropped. Only the store emits stored
 * rows. */
export let roomFrames = <A>(
  rules: RoomRules<A>,
  member: Seat,
): (data: unknown) => string | undefined => {
  let active: string | undefined
  let line = rules.line(member.room)
  return (data) => {
    if (typeof data !== 'string' || data.length > 4096) return
    let frame
    try {
      frame = JSON.parse(data)
    } catch {
      return
    }
    if (!frame || typeof frame !== 'object') return
    if (
      frame.subscribe === line && word(frame.id) &&
      (!active || active === frame.id)
    ) {
      active = frame.id
      return JSON.stringify({
        id: active,
        subscribe: line,
        acks: true,
        frames: true,
      })
    }
    if (active && frame.unsubscribe === active) {
      let unsubscribe = active
      active = undefined
      return JSON.stringify({ unsubscribe })
    }
    if (word(frame.ack)) return JSON.stringify({ ack: frame.ack })
    if (Number.isFinite(frame.clock)) {
      return JSON.stringify({ clock: frame.clock })
    }
    let sent = Array.isArray(frame.relay) && frame.relay[0]
    let relayed = sent && typeof sent === 'object' &&
      rules.relay?.(member, sent)
    if (relayed) return JSON.stringify({ relay: [relayed] })
  }
}

let socket = async <A>(
  rules: RoomRules<A>,
  request: Request,
  store: Door,
  member: Seat,
): Promise<Response> => {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return new Response(null, { status: 426 })
  }
  let response = await store.fetch('/ws', { headers: { upgrade: 'websocket' } })
  let upstream = (response as Response & {
    webSocket?: WebSocket & { accept(): void }
  }).webSocket
  if (!upstream) throw new Error(`Game room socket: HTTP ${response.status}`)
  let { socket, response: accepted } = workerUpgrade(request)
  let forward = roomFrames(rules, member)
  upstream.addEventListener('message', (event) => {
    if (socket.readyState === 1) socket.send(event.data)
  })
  socket.addEventListener('message', (event) => {
    let frame = forward(event.data)
    if (frame && upstream.readyState === 1) upstream.send(frame)
  })
  let close = () => {
    if (socket.readyState < WebSocket.CLOSED) socket.close?.(1000)
    if (upstream.readyState < WebSocket.CLOSED) upstream.close(1000)
  }
  upstream.addEventListener('close', close)
  socket.addEventListener('close', close)
  upstream.addEventListener('error', close)
  socket.addEventListener('error', close)
  upstream.accept()
  return accepted
}

// A private game's install files, fetchable by a signed-out guest's browser.
let installFiles = new Set([
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
])

/** The app worker's `fetch` for live rooms, by the app's `rules`:
 *
 * - `GET room` serves the room page, the address an invitation opens.
 * - `POST rooms` hosts a room, for the app's owner or an editor.
 * - `POST rooms/<room>/join` takes a seat with the invitation, or comes back
 *   to the browser's seat.
 * - `POST rooms/<room>/invite` gives the host a new invitation; the old one
 *   stops working.
 * - `POST rooms/<room>/action` writes the batch `rules.act` answers.
 * - `GET rooms/<room>/query`, `vocab.json` and `ws` are the seat's page graph
 *   over the room's rows.
 *
 * Every other request answers 404, so the platform serves the app's files.
 * Seats in a room share no more than `line` names and `relay` passes. */
export let rooms = <A>(rules: RoomRules<A>) => {
  let most = rules.seats ?? 4
  let roomAt = (store: Door, room: string) =>
    rows(store, `.entity.eid=${room}&.game_room`).then(([row]) =>
      row?.game_room as Room | undefined
    )

  let open = async (store: Door, browser: string) => {
    let member = seatOf(crypto.randomUUID(), browser)
    let invite = crypto.randomUUID()
    let written = await apply(store, [
      {
        entity: { eid: member.room },
        game_room: { invite: await digest(invite), seats: [member.seat] },
      },
      ...rules.open?.(member) ?? [],
      ...rules.seat?.(member, 0) ?? [],
    ])
    return written.ok ? packet(member, { invite, host: true }) : written
  }

  let join = async (store: Door, member: Seat, invitation: unknown) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      let state = await roomAt(store, member.room)
      if (!state) return denied()
      if (state.seats.includes(member.seat)) {
        return packet(member, { host: state.seats[0] === member.seat })
      }
      if (
        typeof invitation !== 'string' || !roomId(invitation) ||
        await digest(invitation) !== state.invite
      ) return denied()
      if (state.seats.length >= most) return refuse(409, 'This room is full.')
      let written = await apply(store, [{
        entity: { eid: member.room },
        game_room: { seats: [...state.seats, member.seat] },
        $was: { game_room: { seats: token(state.seats) } },
      }, ...rules.seat?.(member, state.seats.length) ?? []])
      if (written.ok) return packet(member, { host: false })
      if (written.status !== 409) return written
      await written.body?.cancel()
    }
    return refuse(409, 'The room changed. Join again.')
  }

  let rotate = async (store: Door, member: Seat) => {
    let invite = crypto.randomUUID()
    let written = await apply(store, [{
      entity: { eid: member.room },
      game_room: { invite: await digest(invite) },
    }])
    return written.ok ? packet(member, { invite, host: true }) : written
  }

  let action = async (
    req: Request,
    store: Door,
    member: Seat,
    seats: string[],
  ) => {
    let sent = await body(req) as A | null
    if (!sent) return refuse(400, 'Choose an action.')
    let room = await rows(store, rules.line(member.room))
    try {
      let result = await apply(
        store,
        rules.act(member, seats, room, sent, Math.random),
      )
      if (!result.ok) return result
      await result.body?.cancel()
      return new Response(null, { status: 204 })
    } catch (error) {
      if (error instanceof RoomRefused) return refuse(409, error.message)
      throw error
    }
  }

  return async (req: Request, env: RoomEnv): Promise<Response> => {
    let { pathname } = new URL(req.url)
    let slug = req.headers.get('x-yak-app')
    let mount = req.headers.get('x-yak-mount') ?? (slug ? `/${slug}/` : '/')
    let path = pathname.startsWith(mount)
      ? pathname.slice(mount.length - 1)
      : pathname
    if (path === '/room' && req.method === 'GET') {
      return env.FILES.fetch(env.ROOM_PAGE ?? '/room.html')
    }
    if (installFiles.has(path) && ['GET', 'HEAD'].includes(req.method)) {
      let file = await env.FILES.fetch(path, { method: req.method })
      let headers = new Headers(file.headers)
      headers.set('access-control-allow-origin', '*')
      return new Response(file.body, { status: file.status, headers })
    }
    // The platform checks the origin before dispatch. Open draft links use
    // their scoped ticket instead of a cookie and have an opaque origin.
    let browser = req.headers.get('x-yak-person') ??
      req.headers.get('x-yak-via')
    if (path === '/rooms' && req.method === 'POST') {
      return browser &&
          ['owner', 'editor'].includes(req.headers.get('x-yak-role') ?? '')
        ? open(env.APP, browser)
        : refuse(403, 'Sign in as an app editor to host.')
    }
    let route = /^\/rooms\/([^/]+)\/(join|invite|action|query|vocab\.json|ws)$/
      .exec(path)
    if (!route) return new Response(null, { status: 404 })
    let [, room, door] = route
    if (!browser || !roomId(room)) return denied()
    let member = seatOf(room, browser)
    if (door === 'join' && req.method === 'POST') {
      return join(env.APP, member, (await body(req))?.invite)
    }
    let state = await roomAt(env.APP, room)
    if (!state?.seats.includes(member.seat)) return denied()
    if (door === 'vocab.json' && req.method === 'GET') {
      return env.APP.fetch('/vocab.json')
    }
    if (door === 'query' && req.method === 'GET') {
      return env.APP.fetch(query(rules.line(room)))
    }
    if (door === 'ws' && req.method === 'GET') {
      return socket(rules, req, env.APP, member)
    }
    if (door === 'action' && req.method === 'POST') {
      return action(req, env.APP, member, state.seats)
    }
    if (
      door === 'invite' && req.method === 'POST' &&
      state.seats[0] === member.seat
    ) return rotate(env.APP, member)
    return refuse(405, 'Choose a room action.')
  }
}
