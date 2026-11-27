import { identityEid } from '@yaks/graph/identity'

export type Room = { invite: string; seats: string[] }
/** Whose turn it is, how many actions the room has taken, and the tiles the
 * player may still walk this turn. */
export type Turn = { seat: string; number: number; steps: number }
/** A player's piece. `life` counts revives: health is the hits on this life. */
export type Pawn = {
  room: string
  name: string
  x: number
  z: number
  life: number
}
export type Foe = { room: string; kind: string; x: number; z: number }
/** One roll in the health ledger: who struck whom, on which life, the d6
 * rolled against the number it needed, the damage (0 on a miss), and its
 * place in the room's ledger. */
export type Hit = {
  room: string
  target: string
  by: string
  life: number
  dmg: number
  roll: number
  need: number
  number: number
}

export type Seat = { room: string; seat: string }
/** What a player chose; the page adds the turn it was chosen on. */
export type Choice =
  | { kind: 'pass' }
  | { kind: 'move'; x: number; z: number }
  | { kind: 'strike'; foe: string }
  | { kind: 'revive'; seat: string }
export type Action = Choice & { number: number }

export let roomLine = (room: string): string =>
  `(.entity.eid=${room}&.play_turn)|.play_pawn.room=${room}|.play_foe.room=${room}|.play_hit.room=${room}|.play_motion.room=${room}`

export let roomPath = (room: string): string => `rooms/${room}/`

export let roomId = (value: string): boolean =>
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value)

export let motionId = ({ room, seat }: Seat): string =>
  identityEid('starter-motion', [room, seat])
