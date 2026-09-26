// What a village builds, at a quarter of a ground voxel: cottages and a hall,
// the well, the fire, the notice board and the lamps; and the signpost at the
// head of every road.
import { ball, box, key, type Vox } from '../mesh.ts'
import { FOUND, type Kind, type Model, TIMBER } from './kit.ts'

let PLASTER = 0xefe3c8
let ROOFS = [0xc2573e, 0x4f6f9e, 0x8a5a9e, 0x5c8f55]

let house = (seed: number, w: number, d: number, wall: number): Model => {
  let v: Vox = new Map()
  let roofC = ROOFS[seed % ROOFS.length]
  let x0 = -w / 2, x1 = w / 2 - 1, z0 = -d / 2, z1 = d / 2 - 1
  // Stone footing, then plaster walls framed in timber.
  box(v, [x0, 0, z0], [x1, 1, z1], FOUND)
  for (let y = 2; y < wall; y++) {
    for (let x = x0; x <= x1; x++) {
      for (let z of [z0, z1]) v.set(key(x, y, z), PLASTER)
    }
    for (let z = z0; z <= z1; z++) {
      for (let x of [x0, x1]) v.set(key(x, y, z), PLASTER)
    }
  }
  for (let [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
    box(v, [x, 2, z], [x, wall - 1, z], TIMBER)
  }
  box(v, [x0, wall - 1, z0], [x1, wall - 1, z0], TIMBER)
  box(v, [x0, wall - 1, z1], [x1, wall - 1, z1], TIMBER)
  // A door on the south side, and windows either side of it and round the back.
  box(v, [-2, 2, z1], [1, 8, z1], 0x7b5334)
  v.set(key(1, 5, z1 + 1), 0xe5c05a)
  for (let x of [x0 + 3, x1 - 5]) {
    box(v, [x, 5, z1], [x + 2, 7, z1], 0x3b5578)
    box(v, [x, 4, z1 + 1], [x + 2, 4, z1 + 1], TIMBER)
    box(v, [x, 5, z0], [x + 2, 7, z0], 0x3b5578)
  }
  // A gabled roof, stepping in a voxel for every voxel it climbs.
  let half = Math.ceil(d / 2) + 1
  for (let l = 0; l <= half; l++) {
    for (let x = x0 - 1; x <= x1 + 1; x++) {
      v.set(key(x, wall + l, z0 - 1 + l), l % 3 == 0 ? roofC - 0x101010 : roofC)
      v.set(key(x, wall + l, z1 + 1 - l), l % 3 == 0 ? roofC - 0x101010 : roofC)
    }
    for (let z = z0 - 1 + l + 1; z <= z1 + 1 - l - 1; z++) {
      for (let x of [x0, x1]) v.set(key(x, wall + l, z), PLASTER)
    }
  }
  box(v, [x1 - 4, wall + 2, z0 + 3], [x1 - 3, wall + half + 2, z0 + 4], FOUND)
  return { vox: v, size: 0.25 }
}

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

let board = (): Model => {
  let v: Vox = new Map()
  box(v, [-3, 0, 0], [-3, 9, 0], TIMBER)
  box(v, [3, 0, 0], [3, 9, 0], TIMBER)
  box(v, [-4, 4, 0], [4, 9, 0], 0x8a6240)
  box(v, [-3, 6, 1], [-1, 8, 1], 0xf4ecd6)
  box(v, [1, 5, 1], [2, 7, 1], 0xf4ecd6)
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
  cottage: { make: (s) => house(s, 28, 22, 10), foot: 4.5, span: [7, 5.5] },
  hall: { make: (s) => house(s, 36, 28, 12), foot: 5.5, span: [9, 7] },
  well: { make: well, girth: 1.2, foot: 1.2, span: [2.2, 2.2] },
  fire: { make: fire, girth: 1.2, foot: 1.5, span: [2.6, 2.6] },
  board: { make: board, girth: 0.35, foot: 0.8, span: [2.2, 0.5] },
  lamp: {
    make: lamp,
    girth: 0.35,
    foot: 0.3,
    glow: { at: [0.5, 2.5, 0], size: 3.2 },
  },
  signpost: { make: signpost, girth: 0.3, foot: 1 },
}
