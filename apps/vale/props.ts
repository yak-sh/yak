// What stands on the ground: trees, rocks, flowers, the village, and the
// portals between levels. Each is a small voxel model built by hand out of
// balls and boxes, meshed once per variant and copied wherever a level places
// one (terrain.ts `props`).
import {
  ball,
  blob,
  box,
  key,
  type Out,
  out,
  type Vec,
  type Vox,
} from './mesh.ts'
import { noise, rand, stream } from './rand.ts'

type Model = { vox: Vox; size: number }

let pickOf = <T>(r: () => number, xs: T[]) => xs[Math.floor(r() * xs.length)]

// A canopy: a lumpy ball, lighter toward the sun.
let canopy = (
  v: Vox,
  c: Vec,
  r: number,
  greens: number[],
  seed: number,
) =>
  ball(v, c, r, (x, y, z) => {
    let dx = x - c[0], dy = y - c[1], dz = z - c[2]
    let n = noise(x * 0.7 + seed, z * 0.7 + y * 0.3, seed)
    if (dx * dx + dy * dy + dz * dz > r * r * 0.6 && n < 0.3) return null
    let lift = dy / r
    return greens[lift > 0.35 ? 2 : lift > -0.3 ? 1 : 0]
  })

let oak = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 4 + Math.floor(r() * 3)
  box(v, [0, 0, 0], [0, tall, 0], 0x7a5236)
  box(v, [0, 0, 1], [0, 1, 1], 0x6e4a31)
  let greens = pickOf(r, [
    [0x4d9340, 0x62ad4c, 0x7cc45a],
    [0x4a8a3c, 0x5c9f45, 0x74b851],
    [0x5a9a3a, 0x77b646, 0x98cc59],
  ])
  canopy(v, [0, tall + 2, 0], 3.2 + r(), greens, seed % 97)
  canopy(v, [2, tall + 1, 1], 2.2, greens, seed % 89)
  canopy(v, [-2, tall + 1, -1], 2.2, greens, seed % 83)
  return { vox: v, size: 0.5 }
}

let pine = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 9 + Math.floor(r() * 4)
  box(v, [0, 0, 0], [0, 2, 0], 0x6b4a33)
  let dark = pickOf(r, [0x3d7447, 0x356b43, 0x44804d])
  for (let y = 2; y < tall; y++) {
    let t = (y - 2) / (tall - 2)
    let rad = (1 - t) * 3.2 + (y % 2) * 0.5
    ball(v, [0, y, 0], rad, (x, yy, z) => {
      if (yy != y) return null
      let edge = Math.hypot(x, z) > rad - 1
      return edge && y > tall - 3 && seed % 3 == 0
        ? 0xf1f4f6
        : edge
        ? dark
        : 0x2f5f3c
    })
  }
  v.set(key(0, tall, 0), dark)
  return { vox: v, size: 0.5 }
}

let birch = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 6 + Math.floor(r() * 3)
  for (let y = 0; y <= tall; y++) {
    v.set(key(0, y, 0), rand(y, seed) < 0.25 ? 0x4b4640 : 0xebe6da)
  }
  canopy(v, [0, tall + 1, 0], 2.6, [0x8fbf4f, 0xa6d15e, 0xc4e27a], seed % 71)
  return { vox: v, size: 0.5 }
}

let rock = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let greys = [0x8f8e86, 0xa3a198, 0x7f7e77]
  let lumps = 1 + Math.floor(r() * 3)
  for (let i = 0; i < lumps; i++) {
    let c: Vec = [Math.floor(r() * 3 - 1), 0, Math.floor(r() * 3 - 1)]
    ball(
      v,
      c,
      1.2 + r() * 1.1,
      (x, y, z) =>
        y < 0
          ? null
          : y >= 1 && noise(x, z, seed) > 0.55
          ? 0x6f9a48
          : greys[(x + y + z) & 1 ? 0 : (x * 7 + z) % 3 == 0 ? 2 : 1],
    )
  }
  return { vox: v, size: 0.5 }
}

let BLOOMS = [0xf6f1e4, 0xf5d451, 0xf08aa8, 0x8fb4f2, 0xe8745a, 0xc59af0]

let flower = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let c = pickOf(r, BLOOMS)
  let n = 1 + Math.floor(r() * 3)
  for (let i = 0; i < n; i++) {
    let x = Math.floor(r() * 4) - 2, z = Math.floor(r() * 4) - 2
    let tall = 2 + Math.floor(r() * 3)
    box(v, [x, 0, z], [x, tall, z], 0x4f8f3c)
    for (let [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      v.set(key(x + dx, tall + 1, z + dz), c)
    }
    v.set(key(x, tall + 1, z), 0xf7d64a)
  }
  return { vox: v, size: 0.125 }
}

let tuft = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let blades = 3 + Math.floor(r() * 3)
  for (let i = 0; i < blades; i++) {
    let x = Math.floor(r() * 4) - 2, z = Math.floor(r() * 4) - 2
    let tall = 1 + Math.floor(r() * 3)
    box(v, [x, 0, z], [x, tall, z], pickOf(r, [0x6fae4d, 0x7fbe57, 0x5f9e45]))
  }
  return { vox: v, size: 0.125 }
}

let mushroom = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let cap = pickOf(r, [0xd9493a, 0xc9803f, 0xe7c26a])
  box(v, [0, 0, 0], [0, 2, 0], 0xf1eadb)
  box(v, [-1, 3, -1], [1, 3, 1], cap)
  v.set(key(0, 4, 0), cap)
  v.set(key(1, 3, 1), 0xfbf6ea)
  return { vox: v, size: 0.125 }
}

// The village, at a quarter of a ground voxel.
let PLASTER = 0xefe3c8, TIMBER = 0x6a4b33, FOUND = 0x9c9a91
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

// A portal to another level: two mossy stone pillars and a lintel, with the
// way through left open for the glow world.ts hangs in it.
let portal = (): Model => {
  let v: Vox = new Map()
  let stone = [0x8f8d85, 0xa3a198, 0x7f7e77]
  for (let x of [-6, 5]) {
    for (let y = 0; y < 15; y++) {
      for (let dx = 0; dx < 2; dx++) {
        for (let z = -1; z <= 0; z++) {
          v.set(key(x + dx, y, z), stone[(x + dx + y + z) & 1 ? 0 : y % 3])
        }
      }
    }
    box(v, [x - 1, 0, -2], [x + 2, 1, 1], 0x7a7870)
  }
  box(v, [-7, 15, -1], [6, 16, 0], 0x9a988f)
  box(v, [-5, 17, -1], [4, 17, 0], 0x6f9a48)
  for (let x of [-7, -3, 2, 6]) v.set(key(x, 15 + (x & 1), 1), 0x6f9a48)
  box(v, [-1, 14, 0], [0, 14, 0], 0x9ad8ff)
  return { vox: v, size: 0.25 }
}

let BUILD: Record<string, (seed: number) => Model> = {
  portal,
  oak,
  pine,
  birch,
  rock,
  flower,
  tuft,
  mushroom,
  cottage: (s) => house(s, 28, 22, 10),
  hall: (s) => house(s, 36, 28, 12),
  well,
  fire,
  board,
  lamp,
}

/** How many shapes of each kind the vale grows: a prop is one of them. */
let VARIANTS: Record<string, number> = {
  oak: 6,
  pine: 5,
  birch: 4,
  rock: 6,
  flower: 8,
  tuft: 6,
  mushroom: 3,
}

let meshed = new Map<string, Out>()

/** A prop's triangles, placed with the middle of its base at the origin. */
export let model = (kind: string, seed: number): Out => {
  let variant = VARIANTS[kind] ? seed % VARIANTS[kind] : seed
  let id = `${kind}:${variant}`
  let o = meshed.get(id)
  if (o) return o
  let { vox, size } = BUILD[kind](variant * 7919 + 17)
  o = blob(out(), vox, size, [-size / 2, 0, -size / 2])
  meshed.set(id, o)
  return o
}

// What a vertex carries besides where it is: copied as it stands.
let COPIED: ('nrm' | 'col' | 'uv' | 'rim' | 'bw')[] = [
  'nrm',
  'col',
  'uv',
  'rim',
  'bw',
]

/** Copy triangles into `into`, moved by `at`. */
export let place = (into: Out, from: Out, at: Vec) => {
  let base = into.pos.length / 3
  for (let i = 0; i < from.pos.length; i += 3) {
    into.pos.push(
      from.pos[i] + at[0],
      from.pos[i + 1] + at[1],
      from.pos[i + 2] + at[2],
    )
  }
  for (let name of COPIED) {
    let src = from[name], dst = into[name]
    for (let i = 0; i < src.length; i++) dst.push(src[i])
  }
  for (let i of from.idx) into.idx.push(i + base)
}
