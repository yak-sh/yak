// Exterior details for a plan's south-facing front. A mark is a little
// hanging painted board; an awning projects over the entrance. Plans give
// their own colours and emblem while these keep the scale and attachment
// consistent in every dress.
import { type Kit, S } from './kit.ts'

export type Front = {
  mark?: {
    at: number
    icon: string[]
    ink: number
    board?: number
    height?: number
  }
  awning?: {
    at: number
    wide: number
    colors: [number, number]
    height?: number
  }
}

let voxel = (metres: number) => Math.round(metres / S)

export let facade = (k: Kit, { mark, awning }: Front) => {
  let front = (t: number, y: number, d: number, c: number, name: string) => {
    let [x, z] = k.cell('south', t, d)
    k.put(x, y, z, c, name)
  }
  if (awning) {
    let center = voxel(awning.at), wide = voxel(awning.wide)
    let start = center - Math.floor(wide / 2)
    let y = k.floors[0] + (awning.height ?? 11)
    for (let t = start; t < start + wide; t++) {
      for (let d = -1; d >= -4; d--) {
        let c = awning.colors[Math.floor((t - start) / 2) % 2]
        front(t, y + (d <= -3 ? -1 : 0), d, c, 'the awning')
      }
      front(t, y - 2, -4, k.dress.trim, 'the awning fringe')
    }
    for (let t of [start, start + wide - 1]) {
      for (let d = 0; d >= -4; d--) {
        front(t, y - 1, d, k.dress.timber, 'an awning bracket')
      }
    }
  }
  if (mark) {
    let t = voxel(mark.at), y = k.floors[0] + (mark.height ?? 8)
    let board = mark.board ?? k.dress.door
    for (let d = 0; d >= -5; d--) {
      front(t, y + 5, d, k.dress.timber, 'a sign bracket')
    }
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) {
        let c = mark.icon[row][col] == 'X' ? mark.ink : board
        for (let d of [-4, -5]) {
          front(t + col - 2, y + 4 - row, d, c, 'the hanging sign')
        }
      }
    }
  }
}

export let banners = (k: Kit, at: number[], color: number) => {
  for (let m of at) {
    let t = voxel(m), top = k.floors[0] + 14
    for (let y = top; y >= top - 8; y--) {
      for (let u of [t - 1, t, t + 1]) {
        if (y == top - 8 && u != t) continue
        let [x, z] = k.cell('south', u, -1)
        k.put(x, y, z, y == top ? k.dress.timber : color, 'a banner')
      }
    }
  }
}
