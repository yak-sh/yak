import type { Bundle } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import type { Action, Pawn, Seat, Turn } from './room-model.ts'

export class ActionRefused extends Error {}

export let spawn = (room: string, seat: string, order: number): Bundle => ({
  entity: { eid: seat },
  play_pawn: { room, x: order * 2 - 3, z: 3 },
})

// The app owns movement, dice, turn order and the rows committed together.
export let act = (
  { room, seat }: Seat,
  seats: string[],
  turn: Turn,
  pawn: Pawn,
  action: Action,
  die: () => number,
): Bundle[] => {
  if (turn.seat !== seat) throw new ActionRefused('Wait for your turn.')
  if (action.number !== turn.number) {
    throw new ActionRefused('The turn changed. Try again.')
  }
  let bundles: Bundle[] = []
  let next = { ...turn, number: turn.number + 1 }
  next.seat = seats[(seats.indexOf(seat) + 1) % seats.length]
  switch (action.kind) {
    case 'roll':
      next.roll = die()
      break
    case 'pass':
      break
    case 'move': {
      let { dx, dz } = action
      if (
        !Number.isInteger(dx) || !Number.isInteger(dz) ||
        Math.abs(dx) + Math.abs(dz) !== 1
      ) throw new ActionRefused('Choose one neighboring tile.')
      let x = pawn.x + dx, z = pawn.z + dz
      if (Math.abs(x) > 11 || Math.abs(z) > 11) {
        throw new ActionRefused('That tile is outside the field.')
      }
      bundles.push({ entity: { eid: seat }, play_pawn: { x, z } })
      break
    }
    default:
      throw new ActionRefused('Choose a move, roll, or pass.')
  }
  bundles.push({
    entity: { eid: room },
    play_turn: next,
    $was: {
      play_turn: { number: token(turn.number) },
      play_room: { seats: token(seats) },
    },
  })
  return bundles
}
