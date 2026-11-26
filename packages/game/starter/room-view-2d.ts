import type { Bundle } from '@yaks/graph'
import { board } from './board.ts'
import { type Pawn, type Seat } from './room-model.ts'

export let roomView = (canvas: HTMLCanvasElement) => {
  let view = board(canvas)
  return {
    ...view,
    draw(rows: Bundle[], _dt: number, member?: Seat) {
      let seat = member?.seat
      let pawns = rows.flatMap((row) =>
        row.play_pawn
          ? [{ ...row.play_pawn as Pawn, own: row.entity.eid === seat }]
          : []
      )
      let cursors = rows.flatMap((row) => {
        let motion = row.play_motion as (Pawn & { seat: string }) | undefined
        return motion && motion.seat !== seat ? [motion] : []
      })
      view.draw(pawns.length ? pawns : [{ x: 0, z: 0, own: true }], cursors)
    },
  }
}
