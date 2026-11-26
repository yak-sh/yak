import type { Bundle } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'
import { digest, token } from '@yaks/graph/sha256'
import {
  type Action,
  type Pawn,
  type Room,
  roomId,
  roomLine,
  type Seat,
  type Turn,
} from './room-model.ts'
import { act, ActionRefused, spawn } from './room-rules.ts'
import { roomSocket } from './room-wire.ts'

type Door = { fetch(path: string, init?: RequestInit): Promise<Response> }
type Env = { APP: Door; FILES: Door; ROOM_PAGE?: string }

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

let seatOf = (room: string, browser: string): Seat => ({
  room,
  seat: identityEid('starter-seat', [room, browser]),
})

let open = async (store: Door, browser: string): Promise<Response> => {
  let member = seatOf(crypto.randomUUID(), browser)
  let { room, seat } = member
  let invite = crypto.randomUUID()
  let written = await apply(store, [{
    entity: { eid: room },
    play_room: { invite: await digest(invite), seats: [seat] },
    play_turn: { seat, number: 1 },
  }, spawn(room, seat, 0)])
  return written.ok ? packet(member, { invite, host: true }) : written
}

let roomAt = (store: Door, room: string) =>
  rows(store, `.entity.eid=${room}&.play_room&?play_turn`).then(([row]) => row)

let join = async (store: Door, member: Seat, invitation: unknown) => {
  let { room, seat } = member
  for (let attempt = 0; attempt < 3; attempt++) {
    let row = await roomAt(store, room)
    let state = row?.play_room as Room | undefined
    if (!state) return denied()
    if (state.seats.includes(seat)) {
      return packet(member, { host: state.seats[0] === seat })
    }
    if (
      typeof invitation !== 'string' || !roomId(invitation) ||
      await digest(invitation) !== state.invite
    ) {
      return denied()
    }
    if (state.seats.length >= 4) return refuse(409, 'This room is full.')
    let written = await apply(store, [{
      entity: { eid: room },
      play_room: { seats: [...state.seats, seat] },
      $was: { play_room: { seats: token(state.seats) } },
    }, spawn(room, seat, state.seats.length)])
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
    play_room: { invite: await digest(invite) },
  }])
  return written.ok ? packet(member, { invite, host: true }) : written
}

let action = async (
  req: Request,
  store: Door,
  member: Seat,
  seats: string[],
  turn: Turn,
) => {
  let sent = await body(req) as Action | null
  if (!sent) return refuse(400, 'Choose an action.')
  let [pawn] = await rows(
    store,
    `.entity.eid=${member.seat}&.play_pawn.room=${member.room}`,
  )
  try {
    let bundles = act(
      member,
      seats,
      turn,
      pawn.play_pawn as Pawn,
      sent,
      () => 1 + Math.floor(Math.random() * 6),
    )
    let result = await apply(store, bundles)
    if (result.ok) {
      await result.body?.cancel()
      return new Response(null, { status: 204 })
    }
    return result
  } catch (error) {
    if (error instanceof ActionRefused) return refuse(409, error.message)
    throw error
  }
}

let installFiles = new Set([
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
])

export let rooms = async (req: Request, env: Env): Promise<Response> => {
  let { pathname, origin } = new URL(req.url)
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
  if (req.headers.get('origin') && req.headers.get('origin') !== origin) {
    return denied()
  }
  let browser = req.headers.get('x-yak-person') ?? req.headers.get('x-yak-via')
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
  let row = await roomAt(env.APP, room)
  let state = row?.play_room as Room | undefined
  if (!state?.seats.includes(member.seat)) return denied()
  if (door === 'vocab.json' && req.method === 'GET') {
    return env.APP.fetch('/vocab.json')
  }
  if (door === 'query' && req.method === 'GET') {
    return env.APP.fetch(query(roomLine(room)))
  }
  if (door === 'ws' && req.method === 'GET') {
    return roomSocket(req, env.APP, member)
  }
  if (door === 'action' && req.method === 'POST') {
    return action(req, env.APP, member, state.seats, row.play_turn as Turn)
  }
  if (
    door === 'invite' && req.method === 'POST' && state.seats[0] === member.seat
  ) {
    return rotate(env.APP, member)
  }
  return refuse(405, 'Choose a room action.')
}

export default { fetch: rooms }
