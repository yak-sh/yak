// The props of the hills and moors: heather, standing stones, and the
// columns and walls of the old ruins; and each level's own: Stonestep's cut
// blocks, derrick and watch-fire; Heatherfell's cairn; Oldwall's rampart, its
// towers, autumn oaks and bracken; Kingsbarrow's barrow door, hall posts and
// throne; Giantsteps' basalt columns.
import { ball, box, key, type Vox } from '../mesh.ts'
import { noise, stream } from '../rand.ts'
import { canopy, type Kind, type Model, OLD, pickOf, TIMBER } from './kit.ts'

let heather = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let bloom = pickOf(r, [0xa0609a, 0xb877b0, 0x8e5a92, 0xc58ab8])
  ball(
    v,
    [0, 0, 0],
    1.6 + r(),
    (x, y, z) => y < 0 ? null : (x + y * 3 + z) % 3 == 0 ? 0x5e7a44 : bloom,
  )
  return { vox: v, size: 0.125 }
}

// A standing stone, spotted with lichen.
let menhir = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 12 + Math.floor(r() * 8)
  let greys = [0x9a978e, 0x8a877e, 0xa8a59b]
  for (let y = 0; y <= tall; y++) {
    let w = y > tall - 3 ? 1 : 2
    for (let x = -w; x < w; x++) {
      for (let z = -1; z <= 0; z++) {
        v.set(
          key(x, y, z),
          noise(x * 0.8 + 3, y * 0.5, seed % 97) > 0.8
            ? 0x93a868
            : greys[(x + y + z) & 1 ? 0 : y % 3],
        )
      }
    }
  }
  return { vox: v, size: 0.25 }
}

// A column, most of them broken off.
let pillar = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let whole = r() < 0.3
  let tall = whole ? 22 : 6 + Math.floor(r() * 12)
  box(v, [-2, 0, -2], [2, 1, 2], OLD[2])
  for (let y = 2; y <= tall; y++) {
    ball(
      v,
      [0, y, 0],
      1.6,
      (x, yy, z) =>
        yy != y
          ? null
          : !whole && y == tall && (x + z) & 1
          ? null
          : OLD[(x + z + y) & 1],
    )
  }
  if (whole) box(v, [-2, tall + 1, -2], [2, tall + 2, 2], OLD[0])
  box(v, [-2, 2, 1], [-1, 3, 2], 0x6f9a48)
  return { vox: v, size: 0.25 }
}

// A stretch of broken wall, a window left in it.
let ruin = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let high = 8 + Math.floor(r() * 6)
  for (let x = -6; x <= 5; x++) {
    let top = Math.round(high - Math.abs(x + 0.5) * 0.6 + noise(x, 0, seed) * 4)
    for (let y = 0; y <= top; y++) {
      if (y >= 5 && y <= 7 && x >= -1 && x <= 0) continue
      for (let z = -1; z <= 0; z++) {
        v.set(key(x, y, z), OLD[((x >> 1) + y + z) & 1 ? 0 : (y % 3) ? 1 : 2])
      }
    }
    if (noise(x, 3, seed) > 0.6) v.set(key(x, top + 1, 0), 0x6f9a48)
  }
  return { vox: v, size: 0.25 }
}

// A block of cut stone, squared and stacked where the quarry left it.
let block = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let stone = [0xc8c0a8, 0xb8b098, 0xd4ccb4]
  let n = 1 + Math.floor(r() * 3)
  for (let i = 0; i < n; i++) {
    let [x, z] = [i * 5 - 4 + Math.floor(r() * 2), Math.floor(r() * 3) - 1]
    let y = i == 2 ? 4 : 0
    let [x0, z0] = i == 2 ? [-2, 0] : [x, z]
    box(v, [x0, y, z0], [x0 + 4, y + 3, z0 + 3], stone[i % 3])
    box(v, [x0, y + 3, z0], [x0 + 4, y + 3, z0], stone[(i + 1) % 3])
  }
  return { vox: v, size: 0.25 }
}

// A timber derrick over the quarry: a mast, a jib slung from it, a rope
// down and a block of stone hanging from the hook.
let derrick = (): Model => {
  let v: Vox = new Map()
  box(v, [-1, 0, -1], [0, 30, 0], TIMBER)
  for (let [x, z] of [[-6, -6], [5, -6], [-6, 5], [5, 5]]) {
    for (let t = 0; t <= 10; t++) {
      v.set(
        key(Math.round(x * (1 - t / 10)), t * 2, Math.round(z * (1 - t / 10))),
        TIMBER,
      )
    }
  }
  for (let i = 0; i <= 20; i++) {
    v.set(key(i, 12 + Math.floor(i * 0.7), 0), 0x7a5a3e)
  }
  box(v, [20, 8, 0], [20, 26, 0], 0x9a8a6a)
  box(v, [18, 4, -1], [22, 7, 1], 0xc8c0a8)
  return { vox: v, size: 0.25 }
}

// The watch-fire on the moor: an iron basket on a post of stones.
let brazier = (): Model => {
  let v: Vox = new Map()
  box(v, [-2, 0, -2], [1, 5, 1], 0x8a877e)
  for (let y = 6; y <= 8; y++) {
    for (let x = -3; x <= 2; x++) {
      for (let z = -3; z <= 2; z++) {
        if (x > -3 && x < 2 && z > -3 && z < 2 && y > 6) continue
        if ((x + z + y) & 1 && y > 6) continue
        v.set(key(x, y, z), 0x3a3634)
      }
    }
  }
  box(v, [-2, 7, -2], [1, 8, 1], 0x6a4a31)
  return { vox: v, size: 0.25 }
}

// A cairn: stones piled up on the top of the fell.
let cairn = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let greys = [0x9a978e, 0x8a877e, 0xa8a59b, 0x7a776e]
  for (let y = 0; y < 16; y++) {
    let rad = 5 - y * 0.3
    ball(
      v,
      [0, y, 0],
      rad,
      (x, yy, z) =>
        yy != y || r() < 0.08 ? null : greys[(x * 3 + z + y * 7) & 3],
    )
  }
  return { vox: v, size: 0.25 }
}

// A stretch of the old kingdom's wall: tall, battlemented, broken here and
// there, and cut with the letters the wall-reader reads.
let rampart = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let stone = [0xb8ae94, 0xa89e86, 0xc4baa0]
  let broke = r() < 0.35 ? Math.floor(r() * 10) - 5 : 99
  for (let x = -6; x <= 5; x++) {
    let gap = Math.abs(x - broke) < 2
    let top = gap ? 6 + Math.floor(noise(x, 1, seed) * 4) : 15
    for (let y = 0; y <= top; y++) {
      for (let z = -2; z <= 1; z++) {
        let letter = z == 1 && y >= 6 && y <= 9 &&
          noise(x * 1.7, y * 1.7, seed) > 0.72
        v.set(
          key(x, y, z),
          letter ? 0x5a5040 : stone[((x >> 1) + y + z) & 1 ? 0 : y % 3 ? 1 : 2],
        )
      }
    }
    if (!gap && (x & 1) == 0) box(v, [x, 16, -2], [x, 17, 1], stone[2])
    if (noise(x, 5, seed) > 0.7) v.set(key(x, top + 1, 1), 0x6f9a48)
  }
  return { vox: v, size: 0.25 }
}

// A tower on the old wall, square, battlemented, a slit in each face.
let walltower = (): Model => {
  let v: Vox = new Map()
  let stone = [0xb8ae94, 0xa89e86, 0xc4baa0]
  for (let y = 0; y <= 26; y++) {
    for (let x = -4; x <= 3; x++) {
      for (let z = -4; z <= 3; z++) {
        if (x > -4 && x < 3 && z > -4 && z < 3) continue
        if (y % 8 == 5 && (Math.abs(x + 0.5) < 1 || Math.abs(z + 0.5) < 1)) {
          continue
        }
        v.set(key(x, y, z), stone[(x + y + z) & 1 ? 0 : y % 3 ? 1 : 2])
      }
    }
  }
  for (let x = -4; x <= 3; x++) {
    for (let z = -4; z <= 3; z++) {
      let rim = x == -4 || x == 3 || z == -4 || z == 3
      if (rim && (x + z) & 1) v.set(key(x, 27, z), stone[2])
    }
  }
  return { vox: v, size: 0.25 }
}

// An oak in autumn, its crown gone red and gold.
let autumnoak = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 4 + Math.floor(r() * 3)
  box(v, [0, 0, 0], [0, tall, 0], 0x6a4a31)
  let fire = pickOf(r, [
    [0xa8401e, 0xc86a24, 0xe0a030],
    [0x9a5a1e, 0xc8862a, 0xe8b848],
    [0x8a3a1e, 0xb04a24, 0xd8783a],
  ])
  canopy(v, [0, tall + 2, 0], 3.2 + r(), fire, seed % 97)
  canopy(v, [2, tall + 1, 1], 2.2, fire, seed % 89)
  canopy(v, [-2, tall + 1, -1], 2.2, fire, seed % 83)
  return { vox: v, size: 0.5 }
}

// Leaves fallen in the grass.
let fallen = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  for (let i = 0; i < 5 + Math.floor(r() * 5); i++) {
    let c = pickOf(r, [0xc86a24, 0xe0a030, 0xa8401e, 0x9a6a2a])
    v.set(key(Math.floor(r() * 7) - 3, 0, Math.floor(r() * 7) - 3), c)
  }
  return { vox: v, size: 0.125 }
}

// The door of the king's barrow: two standing stones and a lintel across
// them, dark inside, the mound's turf over it.
let barrowdoor = (): Model => {
  let v: Vox = new Map()
  let greys = [0x8a877e, 0x7a776e, 0x9a978e]
  for (let x of [-5, 3]) box(v, [x, 0, 0], [x + 2, 11, 3], greys[(x & 1) + 1])
  box(v, [-6, 12, -1], [6, 14, 4], greys[0])
  box(v, [-2, 0, 1], [2, 11, 2], 0x121212)
  box(v, [-7, 15, -2], [7, 16, 4], 0x5a7a44)
  for (let [x, z] of [[-9, 6], [8, 6], [-12, 2], [11, 2]]) {
    box(v, [x, 0, z], [x + 1, 7, z + 1], greys[2])
  }
  return { vox: v, size: 0.25 }
}

// The old king's high seat, left standing in his hall.
let throne = (): Model => {
  let v: Vox = new Map()
  let stone = [0xb8ae94, 0xa89e86]
  box(v, [-4, 0, -3], [3, 3, 2], stone[0])
  box(v, [-4, 4, -3], [3, 14, -2], stone[1])
  box(v, [-5, 4, -3], [-4, 8, 2], stone[0])
  box(v, [3, 4, -3], [4, 8, 2], stone[0])
  box(v, [-2, 15, -3], [1, 16, -2], 0xb08a3a)
  box(v, [-3, 4, -1], [2, 4, 1], 0x8a3a3a)
  return { vox: v, size: 0.25 }
}

// A post of the old hall, carved, its top broken off.
let hallpost = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 10 + Math.floor(r() * 12)
  for (let y = 0; y <= tall; y++) {
    box(v, [-1, y, -1], [0, y, 0], y % 4 == 2 ? 0x5a3e2a : 0x6a4a31)
  }
  return { vox: v, size: 0.25 }
}

// Basalt columns in a clutch, each six-sided, cut off at its own height.
let columns = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let dark = [0x3a3a40, 0x46464c, 0x32323a]
  for (let i = 0; i < 3 + Math.floor(r() * 5); i++) {
    let [cx, cz] = [Math.floor(r() * 9) - 4, Math.floor(r() * 9) - 4]
    let tall = 3 + Math.floor(r() * 12)
    for (let y = 0; y <= tall; y++) {
      for (let x = -2; x <= 2; x++) {
        for (let z = -2; z <= 2; z++) {
          if (Math.abs(x) + Math.abs(z) > 3) continue
          let c = y == tall ? dark[1] : dark[(x + z + i) & 1 ? 0 : 2]
          v.set(key(cx + x, y, cz + z), c)
        }
      }
    }
  }
  return { vox: v, size: 0.25 }
}

// Bracken gone rust-brown for the autumn.
let bracken = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let rust = pickOf(r, [0xa8602a, 0x9a5a28, 0xb87a3a])
  for (let a = 0; a < 5; a++) {
    let t = (a / 5) * Math.PI * 2 + r()
    for (let j = 0; j <= 4; j++) {
      let y = j < 3 ? j : 5 - j
      v.set(
        key(Math.round(Math.cos(t) * j), y + 1, Math.round(Math.sin(t) * j)),
        rust,
      )
    }
  }
  box(v, [0, 0, 0], [0, 1, 0], 0x6a4a2a)
  return { vox: v, size: 0.125 }
}

export let HILLS: Record<string, Kind> = {
  heather: { make: heather, shapes: 5, small: true },
  menhir: { make: menhir, shapes: 5, solid: true, foot: 1 },
  pillar: { make: pillar, shapes: 6, solid: true, foot: 1.2 },
  ruin: { make: ruin, shapes: 4, girth: 0.4, row: 1.2, foot: 2.8 },
  block: { make: block, shapes: 4, solid: true, detail: true },
  derrick: { make: derrick, girth: 0.4, foot: 2 },
  brazier: { make: brazier, girth: 0.6, foot: 1.2 },
  cairn: { make: cairn, shapes: 3, solid: true, foot: 1.5, detail: true },
  rampart: {
    make: rampart,
    shapes: 5,
    girth: 0.5,
    row: 1.2,
    foot: 2,
    span: [3, 1],
  },
  walltower: { make: walltower, solid: true, foot: 2, span: [2, 2] },
  autumnoak: { make: autumnoak, shapes: 6, girth: 0.45, detail: true },
  fallen: { make: fallen, shapes: 5, small: true },
  bracken: { make: bracken, shapes: 5, small: true },
  barrowdoor: { make: barrowdoor, girth: 0.6, row: 1.2, foot: 3 },
  throne: { make: throne, solid: true, foot: 1.5 },
  hallpost: { make: hallpost, shapes: 4, girth: 0.3 },
  columns: { make: columns, shapes: 5, solid: true },
}
