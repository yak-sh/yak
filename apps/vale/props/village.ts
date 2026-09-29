// The village's well, fire, notice board, lamps and road signs. Homes and
// workplaces are buildings (buildings.ts), in each land's materials.
import { ball, box, key, type Vox } from '../mesh.ts'
import { DRESSES } from '../buildings/dress.ts'
import type { Dress, Paint } from '../buildings/kit.ts'
import { FOUND, type Kind, type Model, TIMBER } from './kit.ts'

let color = (p: Paint, x: number, y: number, z: number, s: number) =>
  typeof p == 'number' ? p : p(x, y, z, s)

// A fenced kitchen garden, with an opening from the lane and beds of herbs.
let garden = (d: Dress, seed: number): Model => {
  let v: Vox = new Map()
  for (let x of [-8, -4, 0, 4, 8]) {
    for (let z of [-6, 6]) box(v, [x, 0, z], [x, 3, z], d.timber)
  }
  for (let z of [-2, 2]) {
    for (let x of [-8, 8]) box(v, [x, 0, z], [x, 3, z], d.timber)
  }
  for (let z of [-6, 6]) {
    if (z < 0) box(v, [-8, 2, z], [8, 2, z], d.timber)
    else {
      box(v, [-8, 2, z], [-2, 2, z], d.timber)
      box(v, [2, 2, z], [8, 2, z], d.timber)
    }
  }
  for (let x of [-8, 8]) box(v, [x, 2, -6], [x, 2, 6], d.timber)
  for (let x of [-5, 1]) {
    box(v, [x, 0, -3], [x + 3, 0, 3], color(d.stone, x, 0, 0, seed))
    for (let z = -2; z <= 2; z += 2) {
      box(v, [x + 1, 1, z], [x + 2, 2, z], z & 2 ? 0x6f9a48 : 0x8fae54)
    }
  }
  return { vox: v, size: 0.25 }
}

// A market table under a roof in the same timber and roof colour as its land.
let stall = (d: Dress, seed: number): Model => {
  let v: Vox = new Map(), stone = color(d.stone, 0, 0, 0, seed)
  for (let x of [-5, 5]) {
    for (let z of [-4, 4]) {
      box(v, [x, 0, z], [x, 9, z], d.timber)
      box(v, [x - 1, 0, z - 1], [x + 1, 0, z + 1], stone)
    }
  }
  box(v, [-5, 5, -3], [5, 5, 2], color(d.floor, 0, 0, 0, seed))
  box(v, [-6, 10, -5], [6, 10, 5], d.roofs[seed % d.roofs.length])
  box(v, [-4, 6, -2], [-2, 6, 0], 0xc59a55)
  box(v, [1, 6, -2], [3, 6, 0], 0x6f9a48)
  return { vox: v, size: 0.25 }
}

// A fieldstone retaining wall, laid where a plot's lower side meets a slope.
let retaining = (d: Dress, seed: number): Model => {
  let v: Vox = new Map()
  for (let y = 0; y < 4; y++) {
    for (let x = -4; x <= 4; x++) {
      box(v, [x, y, 0], [x, y, 0], color(d.stone, x, y, 0, seed))
    }
  }
  return { vox: v, size: 0.25 }
}

let well = (): Model => {
  let v: Vox = new Map()
  ball(
    v,
    [0, 0, 0],
    4.2,
    (x, y, z) =>
      y < 0 || y > 3 || Math.hypot(x, z) < 2.8
        ? null
        : [FOUND, 0x8a887f, 0xaaa79c][Math.abs(x * 7 + y * 3 + z * 11) % 3],
  )
  for (let x = -2; x <= 2; x++) {
    for (let z = -2; z <= 2; z++) {
      if (Math.hypot(x, z) < 2.5) v.set(key(x, 1, z), 0x3d6f8f)
    }
  }
  // The frame starts in the stone curb. The axle reaches both uprights.
  for (let x of [-4, 4]) {
    box(v, [x - 1, 0, -1], [x + 1, 1, 1], 0x87857c)
    box(v, [x, 2, 0], [x, 11, 0], TIMBER)
  }
  box(v, [-4, 8, 0], [4, 8, 0], 0x785338)
  box(v, [0, 3, 0], [0, 7, 0], 0xb4996d)
  box(v, [-1, 2, -1], [1, 3, 1], 0x684a32)
  box(v, [-1, 3, -1], [1, 3, 1], 0x98714b)
  box(v, [-5, 12, 0], [5, 12, 0], 0x67442e)
  for (let z = -4; z <= 4; z++) {
    let y = 13 - Math.abs(z)
    box(v, [-5, y, z], [5, y, z], Math.abs(z) & 1 ? 0xb04c36 : 0xc2573e)
    if (Math.abs(z) > 1) {
      for (let x of [-4, 4]) {
        v.set(key(x, y, z - Math.sign(z)), 0x67442e)
      }
    }
  }
  return { vox: v, size: 0.25 }
}

let fire = (): Model => {
  let v: Vox = new Map()
  for (let a = 0; a < 10; a++) {
    let t = (a / 10) * Math.PI * 2
    let x = Math.round(Math.cos(t) * 3), z = Math.round(Math.sin(t) * 3)
    box(
      v,
      [x, 0, z],
      [x, a % 3 == 0 ? 1 : 0, z],
      [0x77756d, 0x939087, 0xaaa69a][a % 3],
    )
  }
  box(v, [-2, 0, -1], [2, 1, -1], 0x65452e)
  box(v, [-2, 0, 1], [2, 1, 1], 0x805838)
  box(v, [-1, 1, -2], [-1, 2, 2], 0x6b482f)
  box(v, [1, 1, -2], [1, 2, 2], 0x795136)
  box(v, [0, 0, 0], [0, 1, 0], 0xff9a36)
  box(v, [0, 2, 0], [0, 2, 0], 0xffc25b)
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

// One finger points down the named road. The diagonal board is built along
// northeast; the placed prop turns either board toward its destination.
let signpost = (diagonal = false): Model => {
  let v: Vox = new Map()
  box(v, [-1, 0, -1], [1, 1, 1], 0x8f8d85)
  box(v, [0, 2, 0], [0, 12, 0], TIMBER)
  if (diagonal) {
    for (let i = 0; i < 4; i++) {
      box(v, [i, 10, -i], [i + 1, 11, 1 - i], 0xb08a5a)
    }
    v.set(key(4, 10, -4), 0xb08a5a)
  } else {
    box(v, [-1, 10, 0], [4, 11, 0], 0xb08a5a)
    v.set(key(5, 10, 0), 0xb08a5a)
  }
  box(v, [0, 13, 0], [0, 13, 0], 0xc2573e)
  box(v, [-2, 9, 0], [-1, 9, 0], 0x4b3a2c)
  box(v, [-2, 7, 0], [-2, 8, 0], 0xffd37a)
  v.set(key(-1, 0, 1), 0x6f9a48)
  v.set(key(1, 1, -1), 0x6f9a48)
  return { vox: v, size: 0.25 }
}

export let VILLAGE: Record<string, Kind> = {
  well: { make: well, girth: 1.2, foot: 1.2, span: [2.2, 2.2] },
  fire: { make: fire, solid: true, foot: 1.5, span: [2.6, 2.6] },
  board: { make: board, girth: 0.35, foot: 0.8, span: [2.2, 0.5] },
  lamp: {
    make: lamp,
    girth: 0.35,
    foot: 0.3,
    aside: true,
    glow: { at: [0.5, 2.5, 0], size: 3.2 },
  },
  signpost: { make: () => signpost(), girth: 0.3, foot: 1, aside: true },
  'signpost.diagonal': {
    make: () => signpost(true),
    girth: 0.3,
    foot: 1,
    aside: true,
  },
  ...Object.fromEntries(
    Object.entries(DRESSES).flatMap(([name, dress]) => [
      [`garden.${name}`, {
        make: (s: number) => garden(dress, s),
        span: [4.25, 3.25],
        foot: 2.4,
      }],
      [`stall.${name}`, {
        make: (s: number) => stall(dress, s),
        span: [3.25, 2.75],
        foot: 2,
      }],
      [`retaining.${name}`, {
        make: (s: number) => retaining(dress, s),
        span: [2.25, 0.25],
      }],
    ]),
  ) as Record<string, Kind>,
}
