// The props of the frost: spruce heavy with snow, snowy rock, glacier ice;
// and each level's own: Frostmoor's rimed heather, stunted pines and the ice
// the cutters stack; Rimeholt's spruce white with rime, its longhouses, its
// stockade and woodpiles; Frostpine's great spruce and the woodcutters'
// stumps; Icefall's frozen fall; Whitepeak's cairn and flags on the top and
// the hut in the high snow.
import { ball, box, key, type Vox } from '../mesh.ts'
import { noise, stream } from '../rand.ts'
import { boulders, type Kind, type Model, pickOf, TIMBER } from './kit.ts'

let SNOW = 0xf1f4f6

// A spruce, its needles one of `darks`, snow on every other tier, `tall` to
// `tall` + 3 voxels of `size` metres.
let spruceOf =
  (darks: number[], rime: number, tall: number, size: number) =>
  (seed: number): Model => {
    let r = stream(seed), v: Vox = new Map()
    let top = tall + Math.floor(r() * 4)
    box(v, [0, 0, 0], [0, 2, 0], 0x6b4a33)
    let dark = pickOf(r, darks)
    for (let y = 2; y < top; y++) {
      let t = (y - 2) / (top - 2)
      let rad = (1 - t) * (top / 3) + (y % 2) * 0.6
      ball(v, [0, y, 0], rad, (x, yy, z) => {
        if (yy != y) return null
        let edge = Math.hypot(x, z) > rad - 1.2
        return y % 2 && edge ? rime : dark
      })
    }
    v.set(key(0, top, 0), rime)
    return { vox: v, size }
  }

// Grey rock with snow lying on it.
let snowrock = boulders([0x8f8e86, 0xa3a198, 0x7f7e77], SNOW)

// A block of glacier ice, jagged on top.
let serac = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let blues = [0xcfe8f4, 0xa6d4ec, 0xe8f6fc]
  ball(
    v,
    [0, 1, 0],
    1.8 + r(),
    (x, y, z) =>
      y < 0 || noise(x * 0.9, z * 0.9 + y, seed % 89) < 0.25
        ? null
        : blues[(x + y + z) & 1 ? 0 : y % 3],
  )
  let tall = 3 + Math.floor(r() * 3)
  box(v, [0, 2, 0], [0, tall + 2, 0], blues[2])
  return { vox: v, size: 0.5 }
}

// Heather through the snow, dark, rime white on its tips.
let rimeheather = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  for (let i = 0; i < 4 + Math.floor(r() * 4); i++) {
    let x = Math.floor(r() * 5) - 2, z = Math.floor(r() * 5) - 2
    let tall = 1 + Math.floor(r() * 2)
    box(v, [x, 0, z], [x, tall - 1, z], 0x5a3a4a)
    v.set(key(x, tall, z), SNOW)
  }
  return { vox: v, size: 0.125 }
}

// A pine the wind has bent low and flat, all its branches one way.
let stuntpine = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 3 + Math.floor(r() * 3)
  for (let y = 0; y <= tall; y++) v.set(key(Math.floor(y / 2), y, 0), TIMBER)
  for (let i = 0; i < 3; i++) {
    let y = 2 + i * 2, cx = i + 2, rx = 4 - i, rz = 2 - i * 0.5
    for (let x = -rx; x <= rx; x++) {
      for (let z = -2; z <= 2; z++) {
        if ((x / rx) ** 2 + (z / (rz + 0.5)) ** 2 > 1) continue
        v.set(key(cx + x, y, z), 0x2f5a44)
        v.set(
          key(cx + x, y + 1, z),
          noise(x, z + i, seed) > 0.35 ? SNOW : 0x2f5a44,
        )
      }
    }
  }
  return { vox: v, size: 0.5 }
}

// Blocks of ice the cutters have sawn off the glacier, stacked for the sledge.
let iceblocks = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let ice = [0xb8e0f4, 0xd0ecf8, 0x9ad0ec]
  for (let i = 0; i < 3 + Math.floor(r() * 3); i++) {
    let x = (i % 3) * 5 - 5, z = Math.floor(i / 3) * 5 - 2, y = 0
    box(v, [x, y, z], [x + 3, y + 3, z + 3], ice[i % 3])
  }
  box(v, [-2, 4, -2], [1, 7, 1], ice[1])
  return { vox: v, size: 0.25 }
}

// A longhouse of the holt: walls of logs, a steep roof deep in snow, carved
// posts crossed at its gable, a door in its south end.
let longhouse = (seed: number): Model => {
  let v: Vox = new Map()
  let logs = [0x6a4a31, 0x5a3e2a, 0x7a5a3c]
  let w = 16, d = 24 + (seed % 2) * 4, wall = 8
  let x0 = -w / 2, x1 = w / 2 - 1, z0 = -d / 2, z1 = d / 2 - 1
  for (let y = 0; y < wall; y++) {
    for (let x = x0; x <= x1; x++) {
      for (let z of [z0, z1]) v.set(key(x, y, z), logs[(y + (x >> 3)) % 3])
    }
    for (let z = z0; z <= z1; z++) {
      for (let x of [x0, x1]) v.set(key(x, y, z), logs[y % 3])
    }
  }
  let half = w / 2 + 1
  for (let l = 0; l <= half; l++) {
    for (let z = z0 - 1; z <= z1 + 1; z++) {
      let c = l > 0 && l < half ? SNOW : 0xdfe6ea
      v.set(key(x0 - 1 + l, wall + l, z), c)
      v.set(key(x1 + 1 - l, wall + l, z), c)
    }
    for (let x = x0 + l; x <= x1 - l; x++) {
      v.set(key(x, wall + l, z0), logs[0])
      v.set(key(x, wall + l, z1), logs[0])
    }
  }
  for (let side of [-1, 1]) {
    for (let t = 0; t <= 3; t++) {
      v.set(key(side * t, wall + half + t, z1 + 1), logs[1])
    }
  }
  box(v, [-2, 0, z1], [1, 6, z1], 0x3a2618)
  return { vox: v, size: 0.25 }
}

// A stake of the holt's stockade, its top sharpened, snow caught on it.
let stake = (seed: number): Model => {
  let v: Vox = new Map()
  let tall = 11 + (seed % 3)
  box(v, [-1, 0, -1], [0, tall, 0], (seed & 1) ? 0x6a4a31 : 0x5a3e2a)
  v.set(key(0, tall + 1, 0), 0x7a5a3c)
  v.set(key(-1, tall, -1), SNOW)
  return { vox: v, size: 0.25 }
}

// Logs split and stacked under a lean-to roof of snow.
let woodpile = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let rows = 3 + Math.floor(r() * 2)
  for (let y = 0; y < rows * 2; y++) {
    for (let x = -5; x <= 5; x++) {
      v.set(key(x, y, 0), (x + y) % 3 == 0 ? 0xc8a878 : 0x7a5a3c)
      v.set(key(x, y, 1), 0x6a4a31)
    }
  }
  box(v, [-6, rows * 2, -1], [6, rows * 2, 2], SNOW)
  return { vox: v, size: 0.25 }
}

// A stump the woodcutters left, snow on its cut.
let stump = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 1 + Math.floor(r() * 3)
  box(v, [-1, 0, -1], [1, tall, 1], 0x6a4a31)
  box(v, [-1, tall + 1, -1], [1, tall + 1, 1], r() < 0.5 ? SNOW : 0xc8a878)
  return { vox: v, size: 0.25 }
}

// The frozen fall at Icefall: a cascade stopped in ice, as tall as six men,
// icicles hanging down its face, a pool of ice at its foot.
let frozenfall = (): Model => {
  let v: Vox = new Map()
  let ice = [0x9ad0ec, 0xc8e8f8, 0xe8f6fc, 0x7ab8e0]
  for (let y = 0; y <= 24; y++) {
    let wide = 6 + Math.round(noise(y * 0.3, 1, 9) * 3) + (y < 4 ? 3 : 0)
    for (let x = -wide; x <= wide; x++) {
      let depth = 2 + Math.round(noise(x * 0.4, y * 0.2, 5) * 3)
      for (let z = -depth; z <= 0; z++) {
        let streak = noise(x * 0.8, y * 0.08, 3) > 0.6
        v.set(key(x, y, z), streak ? ice[2] : ice[(x + y) & 1])
      }
    }
  }
  for (let x = -9; x <= 9; x += 2) {
    let hang = 3 + Math.round(noise(x, 0, 11) * 6)
    for (let y = 24 - hang; y <= 24; y++) v.set(key(x, y, 1), ice[1])
  }
  ball(v, [0, 0, 4], 7, (_x, y) => y != 0 ? null : ice[3])
  return { vox: v, size: 0.5 }
}

// The cairn on the top of Whitepeak, and a pole of prayer flags on it.
let flagcairn = (): Model => {
  let v: Vox = new Map()
  let greys = [0x9a978e, 0x8a877e, 0xa8a59b]
  for (let y = 0; y < 12; y++) {
    ball(
      v,
      [0, y, 0],
      4 - y * 0.28,
      (x, yy, z) =>
        yy != y
          ? null
          : y % 4 == 3 && (x + z) & 1
          ? SNOW
          : greys[(x + z + y) % 3],
    )
  }
  box(v, [0, 12, 0], [0, 30, 0], TIMBER)
  let flags = [0x3a6ac8, 0xf0f0f0, 0xc83a3a, 0x3aa85a, 0xe8c83a]
  for (let side of [-1, 1]) {
    for (let i = 0; i < 10; i++) {
      let x = side * (2 + i * 2), y = 29 - Math.round(i * 2.2)
      box(v, [x, y - 2, 0], [x, y, 0], flags[i % 5])
    }
  }
  return { vox: v, size: 0.25 }
}

// A hut of stone in the high snow, its roof buried, smoke-black round its
// chimney.
let stonehut = (): Model => {
  let v: Vox = new Map()
  let greys = [0x8a877e, 0x9a978e, 0x7a776e]
  for (let y = 0; y <= 9; y++) {
    for (let x = -8; x <= 7; x++) {
      for (let z = -6; z <= 5; z++) {
        if (y < 9 && x > -8 && x < 7 && z > -6 && z < 5) continue
        v.set(key(x, y, z), y == 9 ? SNOW : greys[(x + y * 3 + z) % 3])
      }
    }
  }
  box(v, [-9, 10, -7], [8, 11, 6], SNOW)
  box(v, [-7, 12, -5], [6, 12, 4], SNOW)
  box(v, [-2, 0, 5], [1, 6, 5], 0x3a2618)
  box(v, [3, 5, 5], [4, 6, 5], 0xe8b048)
  box(v, [4, 10, -4], [5, 16, -3], greys[2])
  box(v, [4, 17, -4], [5, 17, -3], 0x2a2624)
  return { vox: v, size: 0.25 }
}

export let FROST: Record<string, Kind> = {
  spruce: {
    make: spruceOf([0x2f5f43, 0x356b4a, 0x2a5a3e], SNOW, 9, 0.5),
    shapes: 5,
    girth: 0.45,
  },
  rimespruce: {
    make: spruceOf([0x5a7a74, 0x6a8a84, 0x4e6e68], 0xf8fcff, 9, 0.5),
    shapes: 5,
    girth: 0.45,
  },
  bigspruce: {
    make: spruceOf([0x1e3e30, 0x22463a, 0x1a3a2c], SNOW, 14, 0.75),
    shapes: 5,
    girth: 0.8,
  },
  snowrock: { make: snowrock, shapes: 5, solid: true },
  serac: { make: serac, shapes: 5, solid: true },
  rimeheather: { make: rimeheather, shapes: 5, small: true },
  stuntpine: { make: stuntpine, shapes: 5, girth: 0.3 },
  iceblocks: { make: iceblocks, shapes: 3, solid: true },
  longhouse: { make: longhouse, shapes: 2, foot: 5, span: [4.5, 7] },
  stake: { make: stake, shapes: 3, girth: 0.5 },
  woodpile: { make: woodpile, shapes: 3, foot: 1.5 },
  stump: { make: stump, shapes: 4, girth: 0.5 },
  frozenfall: { make: frozenfall, foot: 8 },
  flagcairn: { make: flagcairn, girth: 1.5, foot: 3 },
  stonehut: { make: stonehut, foot: 4, span: [4.5, 3.5] },
}
