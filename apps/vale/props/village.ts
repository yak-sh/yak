// What a village builds, at a quarter of a ground voxel: cottages and a hall,
// the well, the fire, the notice board and the lamps, and the forge, bench and
// cauldron a hero makes things at (craft.ts); and the signpost at the head of
// every road. A village's houses are built of what is to hand where
// it stands: plaster in Mossvale, birch at Birchmere, turf-roofed logs in
// Fernwood, whitewash and slate at Gullwick, driftwood at Driftwood Bay,
// quarried stone at Stonestep.
import { ball, box, key, metal, type Vox } from '../mesh.ts'
import { rand } from '../rand.ts'
import { FOUND, type Kind, type Model, TIMBER } from './kit.ts'

let PLASTER = 0xefe3c8
let ROOFS = [0xc2573e, 0x4f6f9e, 0x8a5a9e, 0x5c8f55]

/** What a house is built of: the colour of its walls at each voxel, the
 * timber framing them, and its roofs, one picked by seed. */
type Build = {
  wall: (x: number, y: number, z: number, seed: number) => number
  frame: number
  roofs: number[]
}

let PLASTERED: Build = { wall: () => PLASTER, frame: TIMBER, roofs: ROOFS }

let house =
  ({ wall: at, frame, roofs }: Build) =>
  (seed: number, w: number, d: number, wall: number): Model => {
    let v: Vox = new Map()
    let roofC = roofs[seed % roofs.length]
    let x0 = -w / 2, x1 = w / 2 - 1, z0 = -d / 2, z1 = d / 2 - 1
    // Stone footing, then walls framed at their corners and eaves.
    box(v, [x0, 0, z0], [x1, 1, z1], FOUND)
    for (let y = 2; y < wall; y++) {
      for (let x = x0; x <= x1; x++) {
        for (let z of [z0, z1]) v.set(key(x, y, z), at(x, y, z, seed))
      }
      for (let z = z0; z <= z1; z++) {
        for (let x of [x0, x1]) v.set(key(x, y, z), at(x, y, z, seed))
      }
    }
    for (let [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
      box(v, [x, 2, z], [x, wall - 1, z], frame)
    }
    box(v, [x0, wall - 1, z0], [x1, wall - 1, z0], frame)
    box(v, [x0, wall - 1, z1], [x1, wall - 1, z1], frame)
    // A door on the south side, and windows either side of it and round the
    // back.
    box(v, [-2, 2, z1], [1, 8, z1], 0x7b5334)
    v.set(key(1, 5, z1 + 1), 0xe5c05a)
    for (let x of [x0 + 3, x1 - 5]) {
      box(v, [x, 5, z1], [x + 2, 7, z1], 0x3b5578)
      box(v, [x, 4, z1 + 1], [x + 2, 4, z1 + 1], frame)
      box(v, [x, 5, z0], [x + 2, 7, z0], 0x3b5578)
    }
    // A gabled roof, stepping in a voxel for every voxel it climbs.
    let half = Math.ceil(d / 2) + 1
    for (let l = 0; l <= half; l++) {
      for (let x = x0 - 1; x <= x1 + 1; x++) {
        let c = l % 3 == 0 ? roofC - 0x101010 : roofC
        v.set(key(x, wall + l, z0 - 1 + l), c)
        v.set(key(x, wall + l, z1 + 1 - l), c)
      }
      for (let z = z0 - 1 + l + 1; z <= z1 + 1 - l - 1; z++) {
        for (let x of [x0, x1]) {
          v.set(key(x, wall + l, z), at(x, wall + l, z, seed))
        }
      }
    }
    box(v, [x1 - 4, wall + 2, z0 + 3], [x1 - 3, wall + half + 2, z0 + 4], FOUND)
    return { vox: v, size: 0.25 }
  }

// Birchmere's: walls of birch logs, white flecked black, roofs of moss.
let BIRCH: Build = {
  wall: (x, y, z, s) =>
    rand(x + z, y, s) < 0.12 ? 0x3a3a36 : y & 1 ? 0xeeeae0 : 0xe0dcd0,
  frame: 0xb8b4a8,
  roofs: [0x5a7a4a, 0x4e6e42, 0x66864e],
}
// Fernwood's: walls of dark logs, roofs of turf.
let TURF: Build = {
  wall: (_x, y) => y & 1 ? 0x5a3e2a : 0x6a4a31,
  frame: 0x3e2a1c,
  roofs: [0x4f7f3a, 0x5a8a42, 0x46743a],
}
// Gullwick's: whitewashed stone, frames painted the blue of the boats, roofs
// of slate.
let WHITEWASH: Build = {
  wall: (x, y, z) => (x + y + z) % 5 ? 0xf4f2ec : 0xe6e4dc,
  frame: 0x3a5a7a,
  roofs: [0x4a5058, 0x3e444c, 0x56606a],
}
// Driftwood Bay's: shacks of grey boards the sea brought in, roofs tarred
// and patched.
let DRIFT: Build = {
  wall: (x, y, z, s) =>
    rand(x + z, (y >> 2) + s, 3) < 0.15
      ? 0x7a6a58
      : (x + z) & 1
      ? 0x9a9488
      : 0x8a847a,
  frame: 0x6a645a,
  roofs: [0x2e2c2a, 0x3a3634, 0x34302c],
}
// Stonestep's: coursed blocks from the quarry, roofs of stone slab.
let STONE: Build = {
  wall: (x, y, z) =>
    y % 3 == 0 ? 0xb8b098 : ((x + z) >> 1) + (y >> 1) & 1 ? 0xc8c0a8 : 0xd4ccb4,
  frame: 0x9a9280,
  roofs: [0x7a7a78, 0x8a8a86, 0x6e6e6c],
}

// A cottage built of `build`.
let cot = (build: Build): Kind => ({
  make: (s) => house(build)(s, 28, 22, 10),
  foot: 4.5,
  span: [7, 5.5],
})

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

// The smith's forge (craft.ts): a stone hearth of glowing coals under its
// hood and chimney, and an anvil on a stump beside it, a hammer laid on it.
let forge = (): Model => {
  let v: Vox = new Map()
  for (let y = 0; y <= 3; y++) {
    box(v, [-7, y, -3], [-1, y, 3], y & 1 ? 0x8a887f : FOUND)
  }
  box(v, [-7, 4, 3], [-1, 10, 3], 0x7a7870)
  box(v, [-7, 11, 0], [-1, 11, 3], 0x6e6c66)
  box(v, [-5, 12, 1], [-3, 16, 3], 0x6e6c66)
  box(v, [-6, 4, -2], [-2, 4, 2], 0x2a2220)
  for (let [x, z] of [[-5, -1], [-4, 1], [-3, 0], [-5, 1], [-3, -2]]) {
    v.set(key(x, 5, z), (x + z) & 1 ? 0xff7a2a : 0xffc050)
  }
  box(v, [2, 0, -1], [4, 3, 1], 0x5a3e2a)
  box(v, [1, 4, -1], [5, 4, 1], metal(0x3a3a40))
  box(v, [2, 5, -1], [4, 6, 1], metal(0x4a4a52))
  box(v, [5, 6, 0], [6, 6, 0], metal(0x4a4a52))
  box(v, [2, 7, 1], [5, 7, 1], TIMBER)
  box(v, [2, 7, 0], [2, 8, 1], metal(0x5a5a62))
  return { vox: v, size: 0.25 }
}

// The joiner's bench: a board on four legs with a shelf under it, a vice at
// one end, a plank being planed, and a saw beside it.
let bench = (): Model => {
  let v: Vox = new Map()
  for (let x of [-5, 5]) {
    for (let z of [-2, 2]) box(v, [x, 0, z], [x, 3, z], 0x7a5236)
  }
  box(v, [-5, 1, -2], [5, 1, 2], 0x8a6240)
  box(v, [-6, 4, -2], [6, 4, 2], 0xb08a5a)
  box(v, [5, 5, -1], [6, 6, 1], metal(0x4a4a52))
  box(v, [-4, 5, -1], [2, 5, 0], 0xe8c890)
  v.set(key(-1, 6, 0), 0x6e4a31)
  box(v, [-2, 6, -1], [0, 6, -1], metal(0x9aa2aa))
  box(v, [3, 5, 1], [4, 5, 2], metal(0xc8ccd0))
  v.set(key(4, 5, 2), 0x6e4a31)
  for (let [x, z] of [[-3, 3], [0, 3], [2, -3], [-6, 3]]) {
    v.set(key(x, 0, z), 0xe8d0a0)
  }
  return { vox: v, size: 0.25 }
}

// The cauldron: a black pot on a ring of stones, a fire under it, and a green
// brew in it.
let cauldron = (): Model => {
  let v: Vox = new Map()
  for (let a = 0; a < 10; a++) {
    let t = (a / 10) * Math.PI * 2
    let x = Math.round(Math.cos(t) * 3.5), z = Math.round(Math.sin(t) * 3.5)
    v.set(key(x, 0, z), a % 3 ? 0x8f8d85 : 0x7a7870)
  }
  box(v, [-2, 0, 0], [2, 0, 0], 0x6e4a31)
  v.set(key(0, 0, 1), 0xff7a2a)
  v.set(key(1, 0, -1), 0xffc050)
  ball(
    v,
    [0, 2, 0],
    2.6,
    (x, y, z) =>
      y < 1
        ? null
        : y == 4
        ? x * x + z * z < 3 ? (x + z) & 1 ? 0x7ae09a : 0x5ac07a : 0x5a5862
        : 0x44424a,
  )
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
  cottage: cot(PLASTERED),
  hall: {
    make: (s) => house(PLASTERED)(s, 36, 28, 12),
    foot: 5.5,
    span: [9, 7],
  },
  birchhouse: cot(BIRCH),
  turfhouse: cot(TURF),
  fisherhouse: cot(WHITEWASH),
  shack: cot(DRIFT),
  stonehouse: cot(STONE),
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
  forge: {
    make: forge,
    girth: 1.2,
    row: 1,
    foot: 2,
    span: [3.6, 1.8],
    glow: { at: [-1, 1.4, 0], size: 3, color: 0xff7a2a },
    aside: true,
  },
  bench: { make: bench, girth: 1, row: 1.2, foot: 1.8, aside: true },
  cauldron: {
    make: cauldron,
    girth: 1.3,
    foot: 1.4,
    glow: { at: [0, 1.3, 0], size: 2.4, color: 0x9fe0a0 },
    aside: true,
  },
}
