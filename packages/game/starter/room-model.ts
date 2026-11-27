import { identityEid } from '@yaks/graph/identity'

export type Room = { invite: string; seats: string[] }
export type Turn = { seat: string; number: number; roll?: number }
export type Pawn = { room: string; x: number; z: number }

export type Seat = { room: string; seat: string }
/** What a player chose; the page adds the turn it was chosen on. */
export type Choice = { kind: 'roll' | 'pass' } | {
  kind: 'move'
  x: number
  z: number
}
export type Action = Choice & { number: number }

export let roomLine = (room: string): string =>
  `(.entity.eid=${room}&.play_turn)|.play_pawn.room=${room}|.play_motion.room=${room}`

export let roomPath = (room: string): string => `rooms/${room}/`

export let roomId = (value: string): boolean =>
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value)

export let motionId = ({ room, seat }: Seat): string =>
  identityEid('starter-motion', [room, seat])
