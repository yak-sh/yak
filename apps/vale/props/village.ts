// The village's well, fire, notice board, lamps and road signs. Homes and
// workplaces are buildings (buildings.ts), in each land's materials.
import { ball, box, key, type Vox } from '../mesh.ts'
import { FOUND, type Kind, type Model, TIMBER } from './kit.ts'

let well = (): Model => {
  let v: Vox = new Map()
  ball(
    v,
    [0, 0, 0],
    4.2,
    (x, y, z) =>
      y < 0 || y > 3 || Math.hypot(x, z) < 3
        ? null
        : (x + z) & 1
        ? FOUND
        : 0x8a887f,
  )
  box(v, [-2, 0, -2], [1, 1, 1], 0x3d6f8f)
  box(v, [-4, 4, 0], [-4, 10, 0], TIMBER)
  box(v, [3, 4, 0], [3, 10, 0], TIMBER)
  box(v, [-5, 11, -2], [4, 11, 2], 0xc2573e)
  box(v, [-4, 12, -1], [3, 12, 1], 0xb04c36)
  box(v, [-3, 8, 0], [2, 8, 0], TIMBER)
  return { vox: v, size: 0.25 }
}

let fire = (): Model => {
  let v: Vox = new Map()
  for (let a = 0; a < 12; a++) {
    let t = (a / 12) * Math.PI * 2
    let x = Math.round(Math.cos(t) * 5), z = Math.round(Math.sin(t) * 5)
    box(v, [x, 0, z], [x, a % 2, z], a % 3 ? 0x8f8d85 : 0x7a7870)
  }
  box(v, [-3, 0, 0], [3, 0, 0], 0x6e4a31)
  box(v, [0, 1, -3], [0, 1, 3], 0x7a5236)
  return { vox: v, size: 0.25 }
}

// The notice board: a plank between two posts under a little roof. It is
// drawn bare, and a paper is pinned on its south face for each notice it
// holds (papers.ts).
let board = (): Model => {
  let v: Vox = new Map()
  box(v, [-3, 0, 0], [-3, 9, 0], TIMBER)
  box(v, [3, 0, 0], [3, 9, 0], TIMBER)
  box(v, [-4, 4, 0], [4, 9, 0], 0x8a6240)
  box(v, [-4, 10, -1], [4, 10, 1], 0xc2573e)
  return { vox: v, size: 0.25 }
}

let lamp = (): Model => {
  let v: Vox = new Map()
  box(v, [0, 0, 0], [0, 10, 0], 0x4b3a2c)
  box(v, [0, 11, 0], [1, 11, 0], 0x4b3a2c)
  box(v, [1, 9, -1], [2, 10, 0], 0xffd37a)
  return { vox: v, size: 0.25 }
}

// A fingerpost at the head of a road: a timber post on a cairn of stones,
// its arms pointing every way, and a lantern hung from it.
let signpost = (): Model => {
  let v: Vox = new Map()
  box(v, [-1, 0, -1], [1, 1, 1], 0x8f8d85)
  box(v, [0, 2, 0], [0, 12, 0], TIMBER)
  box(v, [-4, 10, 0], [4, 11, 0], 0xb08a5a)
  v.set(key(5, 10, 0), 0xb08a5a)
  box(v, [0, 7, -4], [0, 8, 4], 0xa07c4e)
  v.set(key(0, 7, 5), 0xa07c4e)
  box(v, [0, 13, 0], [0, 13, 0], 0xc2573e)
  box(v, [1, 12, 0], [2, 12, 0], 0x4b3a2c)
  box(v, [2, 10, 0], [2, 11, 0], 0xffd37a)
  v.set(key(-1, 0, 1), 0x6f9a48)
  v.set(key(1, 1, -1), 0x6f9a48)
  return { vox: v, size: 0.25 }
}

export let VILLAGE: Record<string, Kind> = {
  well: { make: well, girth: 1.2, foot: 1.2, span: [2.2, 2.2] },
  fire: { make: fire, girth: 1.2, foot: 1.5, span: [2.6, 2.6] },
  board: { make: board, girth: 0.35, foot: 0.8, span: [2.2, 0.5] },
  lamp: {
    make: lamp,
    girth: 0.35,
    foot: 0.3,
    aside: true,
    glow: { at: [0.5, 2.5, 0], size: 3.2 },
  },
  signpost: { make: signpost, girth: 0.3, foot: 1, aside: true },
}
