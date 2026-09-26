// What stands on the ground: trees, rocks, flowers, the village, ruins and
// standing stones, and the portals between levels. Each is a small voxel
// model built by hand out of balls and boxes, meshed once per variant and
// copied wherever a level places one (terrain.ts `props`), and measured, so
// what a walker bumps into or stands on is the size it is drawn (`bulk`).
import {
  ball,
  blob,
  box,
  key,
  type Out,
  out,
  unkey,
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

// A heap of boulders in three shades, mossy on top where `moss` is.
let boulders = (greys: number[], moss: number | null) => (seed: number) => {
  let r = stream(seed), v: Vox = new Map()
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
          : moss != null && y >= 1 && noise(x, z, seed) > 0.55
          ? moss
          : greys[(x + y + z) & 1 ? 0 : (x * 7 + z) % 3 == 0 ? 2 : 1],
    )
  }
  return { vox: v, size: 0.5 }
}

let rock = boulders([0x8f8e86, 0xa3a198, 0x7f7e77], 0x6f9a48)
// Wind-worn sandstone, warm and bare.
let sandstone = boulders([0xd2a878, 0xe0bc8c, 0xc0925f], null)
// Cinder: black rock the fire spat out.
let cinder = boulders([0x4e4b48, 0x5c5854, 0x423f3c], null)
// Grey rock with snow lying on it.
let snowrock = boulders([0x8f8e86, 0xa3a198, 0x7f7e77], 0xf1f4f6)

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

let reed = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let n = 3 + Math.floor(r() * 4)
  for (let i = 0; i < n; i++) {
    let x = Math.floor(r() * 5) - 2, z = Math.floor(r() * 5) - 2
    let tall = 5 + Math.floor(r() * 5)
    box(v, [x, 0, z], [x, tall, z], pickOf(r, [0x7a9a4a, 0x8aa656, 0x6b8c42]))
    if (r() < 0.6) box(v, [x, tall + 1, z], [x, tall + 2, z], 0x6e4a2e)
  }
  return { vox: v, size: 0.125 }
}

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

// A tree long dead: a bare grey trunk and a few crooked limbs.
let deadtree = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 12 + Math.floor(r() * 7)
  let bark = pickOf(r, [0x6b5d50, 0x5a5048, 0x7a6d5e])
  box(v, [0, 0, 0], [1, tall, 1], bark)
  for (let i = 0; i < 3 + Math.floor(r() * 2); i++) {
    let y = 5 + Math.floor(r() * (tall - 5))
    let [dx, dz] = pickOf(r, [[1, 0], [-1, 0], [0, 1], [0, -1]])
    let x = dx > 0 ? 1 : 0, z = dz > 0 ? 1 : 0
    for (let j = 1; j <= 3 + Math.floor(r() * 3); j++) {
      v.set(key(x + dx * j, y + Math.floor(j / 2), z + dz * j), bark)
    }
  }
  return { vox: v, size: 0.25 }
}

let palm = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 18 + Math.floor(r() * 8)
  let lean = (r() < 0.5 ? -1 : 1) * (2 + Math.floor(r() * 3))
  let tx = 0
  for (let y = 0; y <= tall; y++) {
    tx = Math.round(lean * (y / tall) ** 2)
    box(v, [tx, y, 0], [tx + 1, y, 1], y % 3 == 0 ? 0x8a6a48 : 0xa8865c)
  }
  box(v, [tx, tall + 1, 0], [tx + 1, tall + 1, 1], 0x4f9a3e)
  for (let [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
    let g = pickOf(r, [0x4f9a3e, 0x5fae48, 0x3f8a36])
    let x = tx + (dx > 0 ? 1 : 0), z = dz > 0 ? 1 : 0
    for (let j = 1; j <= 5 + Math.floor(r() * 3); j++) {
      v.set(key(x + dx * j, tall + 1 - Math.floor((j * j) / 9), z + dz * j), g)
    }
  }
  for (let [x, z] of [[tx - 1, 0], [tx + 2, 1]]) {
    v.set(key(x, tall - 1, z), 0x6e4a2e)
  }
  return { vox: v, size: 0.25 }
}

let cactus = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 9 + Math.floor(r() * 6)
  let skin = (x: number, y: number, z: number) =>
    (x + z) & 1 ? 0x5f9a4a : y % 4 == 0 ? 0x7bb45e : 0x6aa653
  let column = (x: number, z: number, y0: number, y1: number) => {
    for (let y = y0; y <= y1; y++) {
      for (let [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        v.set(key(x + a, y, z + b), skin(x + a, y, z + b))
      }
    }
  }
  column(0, 0, 0, tall)
  for (let side of [-1, 1]) {
    if (r() < 0.25) continue
    let y = 3 + Math.floor(r() * (tall - 6)), x = side < 0 ? -3 : 3
    box(v, [side < 0 ? -2 : 2, y, 0], [side < 0 ? -1 : 2, y + 1, 1], 0x5f9a4a)
    column(x, 0, y, y + 3 + Math.floor(r() * 3))
  }
  if (r() < 0.5) v.set(key(0, tall + 1, 0), pickOf(r, [0xf08aa8, 0xf5d451]))
  return { vox: v, size: 0.25 }
}

// A toadstool the size of a tree.
let toadstool = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 10 + Math.floor(r() * 7)
  let cap = pickOf(r, [0xd9493a, 0x9a6ad0, 0x4fb8b0, 0xe89a3a, 0xc85a9a])
  box(v, [0, 0, 0], [1, tall, 1], 0xf1eadb)
  let R = 5 + Math.floor(r() * 3), H = 3 + Math.floor(r() * 2)
  for (let x = -R; x <= R + 1; x++) {
    for (let z = -R; z <= R + 1; z++) {
      let e = ((x - 0.5) ** 2 + (z - 0.5) ** 2) / (R * R)
      if (e > 1) continue
      let high = Math.round(H * Math.sqrt(1 - e))
      v.set(key(x, tall, z), 0xe9dcc4)
      for (let y = 1; y <= high; y++) {
        let spot = y == high && rand(x, z, seed) < 0.12
        v.set(key(x, tall + y, z), spot ? 0xfbf6ea : cap)
      }
    }
  }
  return { vox: v, size: 0.25 }
}

// A spruce heavy with snow.
let spruce = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 9 + Math.floor(r() * 4)
  box(v, [0, 0, 0], [0, 2, 0], 0x6b4a33)
  let dark = pickOf(r, [0x2f5f43, 0x356b4a, 0x2a5a3e])
  for (let y = 2; y < tall; y++) {
    let t = (y - 2) / (tall - 2)
    let rad = (1 - t) * 3.2 + (y % 2) * 0.6
    ball(v, [0, y, 0], rad, (x, yy, z) => {
      if (yy != y) return null
      let edge = Math.hypot(x, z) > rad - 1.2
      return y % 2 && edge ? 0xf1f4f6 : dark
    })
  }
  v.set(key(0, tall, 0), 0xf1f4f6)
  return { vox: v, size: 0.5 }
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

// The old stone the ruins are built of.
let OLD = [0xd6cfbd, 0xc8c0ac, 0xbdb5a0]

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

// Columns of dark basalt, standing close.
let basalt = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let darks = [0x3e3c3a, 0x484542, 0x34322f]
  for (let x = -1; x <= 1; x++) {
    for (let z = -1; z <= 1; z++) {
      if (r() < 0.35 && (x || z)) continue
      let tall = 1 + Math.floor(r() * 5) + (x || z ? 0 : 2)
      box(v, [x, 0, z], [x, tall, z], pickOf(r, darks))
      v.set(key(x, tall, z), 0x5a5652)
    }
  }
  return { vox: v, size: 0.5 }
}

let GEMS = [
  [0x7fe3f0, 0xc2f6fb],
  [0xb58af0, 0xdcc6fb],
  [0xf08ac8, 0xfac6e4],
  [0x8af0b0, 0xc8fad8],
]

// A cluster of crystals, leaning out of a stone.
let crystal = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let [deep, pale] = pickOf(r, GEMS)
  ball(v, [0, 0, 0], 2.5, (_x, y) => y < 0 || y > 1 ? null : 0x7f7e77)
  for (let i = 0; i < 3 + Math.floor(r() * 3); i++) {
    let x = Math.floor(r() * 3) - 1, z = Math.floor(r() * 3) - 1
    let dx = Math.floor(r() * 3) - 1, dz = Math.floor(r() * 3) - 1
    let tall = 6 + Math.floor(r() * 9)
    for (let y = 0; y <= tall; y++) {
      let px = x + Math.floor((dx * y) / 4), pz = z + Math.floor((dz * y) / 4)
      let w = y < tall * 0.7 ? 1 : 0
      box(
        v,
        [px, y + 1, pz],
        [px + w, y + 1, pz + w],
        y > tall - 3 ? pale : deep,
      )
    }
  }
  return { vox: v, size: 0.25 }
}

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
  sandstone,
  cinder,
  snowrock,
  flower,
  tuft,
  mushroom,
  reed,
  heather,
  deadtree,
  palm,
  cactus,
  toadstool,
  spruce,
  menhir,
  pillar,
  ruin,
  basalt,
  crystal,
  serac,
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
  sandstone: 5,
  cinder: 5,
  snowrock: 5,
  flower: 8,
  tuft: 6,
  mushroom: 3,
  reed: 6,
  heather: 5,
  deadtree: 5,
  palm: 5,
  cactus: 5,
  toadstool: 6,
  spruce: 5,
  menhir: 5,
  pillar: 6,
  ruin: 4,
  basalt: 5,
  crystal: 6,
  serac: 5,
}

// Which of its kind's shapes a prop is, as `kind:variant`, and the shape.
let variantOf = (kind: string, seed: number) => {
  let n = VARIANTS[kind] ? seed % VARIANTS[kind] : seed
  return { id: `${kind}:${n}`, shape: () => BUILD[kind](n * 7919 + 17) }
}

let meshed = new Map<string, Out>()

/** A prop's triangles, placed with the middle of its base at the origin. */
export let model = (kind: string, seed: number): Out => {
  let { id, shape } = variantOf(kind, seed)
  let o = meshed.get(id)
  if (o) return o
  let { vox, size } = shape()
  o = blob(out(), vox, size, [-size / 2, 0, -size / 2])
  meshed.set(id, o)
  return o
}

let measured = new Map<string, { r: number; tall: number }>()

/** How much room a prop's model takes, in metres: the radius of the circle
 * its voxels stand in, and how tall it stands.
 *
 * ```ts
 * import { assert } from '@std/assert'
 * let { r, tall } = bulk('rock', 3)
 * assert(r > 0.5 && r < 2.5 && tall >= 1 && tall <= 1.5)
 * ```
 */
export let bulk = (kind: string, seed: number) => {
  let { id, shape } = variantOf(kind, seed)
  let got = measured.get(id)
  if (got) return got
  let { vox, size } = shape()
  let r = 0, tall = 0
  for (let k of vox.keys()) {
    let [x, y, z] = unkey(k)
    r = Math.max(r, Math.hypot(x, z) * size + size / 2)
    tall = Math.max(tall, (y + 1) * size)
  }
  measured.set(id, got = { r, tall })
  return got
}
