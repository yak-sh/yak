// The reusable exterior details a building design can place after its rooms.
// Plans supply their positions, colours and patterns; these operations only
// turn that data into voxels and furniture.
import { banners, facade, type Front } from './facade.ts'
import { type Kit, type Piece, type Side } from './kit.ts'

export type Detail =
  | { kind: 'facade'; front: Front }
  | { kind: 'banners'; at: number[]; color: number }
  | { kind: 'place'; piece: string; at: [number, number]; face?: Side }
  // These two attachments use quarter-metre cells relative to the wall.
  | {
    kind: 'projecting_sign'
    on: Side
    at: number
    height: number
    icon: string[]
    ink: number
    board: number
    iron: number
  }
  | { kind: 'wheel'; on: Side; at: number; height: number; radius: number }

let sign = (
  k: Kit,
  { on, at, height, icon, ink, board, iron }: Extract<
    Detail,
    { kind: 'projecting_sign' }
  >,
) => {
  let y = k.floors[0] + height
  let cell = (d: number, up: number): [number, number, number] => {
    let [x, z] = k.cell(on, at, d)
    return [x, up, z]
  }
  for (let d = -1; d >= -icon[0].length; d--) {
    k.put(...cell(d, y), k.dress.timber, 'the sign')
  }
  for (let d of [-2, -4]) k.put(...cell(d, y - 1), iron, 'the sign')
  icon.forEach((row, r) =>
    [...row].forEach((c, i) =>
      k.put(...cell(-1 - i, y - 2 - r), c == 'X' ? ink : board, 'the sign')
    )
  )
}

let wheel = (
  k: Kit,
  { on, at, height, radius }: Extract<Detail, { kind: 'wheel' }>,
) => {
  let y = k.floors[0] + height
  for (let d of [-2, -4]) {
    for (let t = -radius; t <= radius; t++) {
      for (let h = -radius; h <= radius; h++) {
        let r = Math.hypot(t, h)
        if (r >= radius - 1 && r < radius + 0.4) {
          let [x, z] = k.cell(on, at + t, d)
          k.put(x, y + h, z, k.dress.timber, 'the waterwheel')
        }
      }
    }
  }
  for (let t = -radius + 1; t <= radius - 1; t++) {
    for (let h = -radius + 1; h <= radius - 1; h++) {
      if (
        Math.hypot(t, h) < radius &&
        (t == 0 || h == 0 || Math.abs(t) == Math.abs(h))
      ) {
        let [x, z] = k.cell(on, at + t, -3)
        k.put(x, y + h, z, k.dress.timber, 'the waterwheel')
      }
    }
  }
  for (let d = -1; d >= -5; d--) {
    let [x, z] = k.cell(on, at, d)
    k.put(x, y, z, k.dress.timber, 'the axle')
  }
}

/** Add each exterior detail in the order the design names it. */
export let detail = (k: Kit, d: Detail, pieces: Record<string, Piece>) => {
  if (d.kind == 'facade') facade(k, d.front)
  else if (d.kind == 'banners') banners(k, d.at, d.color)
  else if (d.kind == 'place') {
    let piece = pieces[d.piece]
    if (!piece) throw new Error(`Unknown building piece: ${d.piece}`)
    k.place(piece, d.at, d.face)
  } else if (d.kind == 'projecting_sign') sign(k, d)
  else if (d.kind == 'wheel') wheel(k, d)
  else throw new Error(`Unknown building detail: ${JSON.stringify(d)}`)
}
