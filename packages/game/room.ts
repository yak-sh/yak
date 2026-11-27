/** Live rooms in a page: host a room, join one with its invitation, invite a
 * friend, and watch the rows the room shows its seats. The app's worker serves
 * the rooms with `rooms` from `@yaks/game/rooms`. */
import type { Client } from '@yaks/client'
import { page, type PageOptions } from './page.ts'
import {
  type Joined,
  roomId,
  roomPath,
  RoomRefused,
  type Seat,
} from './seat.ts'

export * from './seat.ts'

/** POST to the app's room worker. A refusal (any status under 500) throws
 * `RoomRefused` with the worker's words. */
export let postRoom = async <T>(path: string, data?: unknown): Promise<T> => {
  let res = await fetch(new URL(path, document.baseURI), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data ?? {}),
  })
  if (!res.ok) {
    let why = await res.json().catch(() => null)
    let message = why?.message ?? why?.error?.message ??
      `Room: HTTP ${res.status}`
    if (res.status < 500) throw new RoomRefused(message)
    throw new Error(message)
  }
  return res.status === 204 ? undefined as T : await res.json()
}

/** Open a new room with this browser in its first seat, with an invitation. */
export let hostRoom = (): Promise<Joined> => postRoom<Joined>('rooms')

/** Take a seat in `room`, or come back to the one this browser holds. A
 * browser without a seat needs the room's invitation. */
export let joinRoom = (room: string, invite?: string | null): Promise<Joined> =>
  postRoom<Joined>(roomPath(room) + 'join', { invite })

/** The room and invitation a page's address names: `?room=` and
 * `#invite=`. `room` is absent unless it has a room id's form. */
export let linkedRoom = (
  href: string = location.href,
): { room?: string; invite?: string } => {
  let url = new URL(href)
  let room = url.searchParams.get('room') ?? ''
  let invite = new URLSearchParams(url.hash.slice(1)).get('invite')
  return {
    ...roomId(room) ? { room } : {},
    ...invite ? { invite } : {},
  }
}

/** Keep `room` in the page's address, so a reload comes back to it, and drop
 * the invitation from the address bar. */
export let rememberRoom = (room: string): void => {
  let url = new URL(location.href)
  url.searchParams.set('room', room)
  url.hash = ''
  history.replaceState(null, '', url)
}

/** The link that brings a friend into the host's room: the app's `room` page
 * with the room and its invitation, asking the worker for an invitation when
 * `member` holds none. The invitation rides in the fragment, which no server
 * sees. */
export let inviteLink = async (member: Joined): Promise<URL> => {
  member.invite ??=
    (await postRoom<Joined>(roomPath(member.room) + 'invite')).invite
  let url = new URL('room', document.baseURI)
  url.searchParams.set('room', member.room)
  url.hash = new URLSearchParams({ invite: member.invite! }).toString()
  return url
}

/** Open the room's page graph and watch `line`, the rows the room shows its
 * seats; the worker accepts that one subscription. The watch delivers the
 * room as it is, every accepted change, and the whole room again after a
 * reconnect: `watch.ready` once the first rows arrive, `watch.refused` when
 * the room declines. */
export let connectRoom = async (
  { room }: Seat,
  line: string,
  options: PageOptions = {},
): Promise<{ front: Client; watch: ReturnType<Client['watch']> }> => {
  let front = await page({
    api: new URL(roomPath(room), document.baseURI),
    page: false,
    ...options,
  })
  return { front, watch: front.watch(line) }
}
