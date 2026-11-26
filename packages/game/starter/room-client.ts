import { page, type PageOptions } from '@yaks/game/page'
import { roomLine, roomPath, type Seat } from './room-model.ts'

export type Joined = Seat & { host: boolean; invite?: string }

export class RoomRefused extends Error {}

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

// Both initial state and later updates use this watch. The sync client keeps
// its query and resubscribes whenever this room's socket reconnects.
export let connectRoom = async (
  { room }: Seat,
  options: PageOptions = {},
) => {
  let front = await page({
    api: new URL(roomPath(room), document.baseURI),
    page: false,
    ...options,
  })
  return { front, watch: front.watch(roomLine(room)) }
}
