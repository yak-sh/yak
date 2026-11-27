import type { Bundle } from '@yaks/graph'
import { board } from './board.ts'
import { type Pawn, type Seat } from './room-model.ts'
import { type Battle } from './room-rules.ts'

export let roomView = (canvas: HTMLCanvasElement) => {
  let view = board(canvas)
  return {
    ...view,
    draw(
      rows: Bundle[],
      { party, foes }: Battle,
      _dt: number,
      _elapsed: number,
      member?: Seat,
    ) {
      let seat = member?.seat
      let pawns = party.map((p) => ({
        x: p.x,
        z: p.z,
        own: p.eid === seat,
        down: p.hp <= 0,
      }))
      let cursors = rows.flatMap((row) => {
        let motion = row.play_motion as (Pawn & { seat: string }) | undefined
        return motion && motion.seat !== seat ? [motion] : []
      })
      view.draw(
        pawns.length ? pawns : [{ x: 0, z: 0, own: true }],
        cursors,
        foes.filter((f) => f.hp > 0),
      )
    },
  }
}
