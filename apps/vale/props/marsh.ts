// The props of the marshes, each level's own: Reedmarsh's golden reeds,
// stilt huts, boardwalks and eel traps; Mirewood's swamp cypresses, berry
// thickets and the old cypress; Fenhollow's cotton grass, peat stacks and the
// dig; the Sunken Kirk's bell tower, graves, yews and crypt; Bogheart's moss,
// Granny Rush's hut and the briar's root; Sporefen's ink caps and puffballs.
import { ball, box, key, type Vox } from '../mesh.ts'
import { noise, rand, stream } from '../rand.ts'
import { canopy, type Kind, type Model, OLD, pickOf, TIMBER } from './kit.ts'

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

// Reeds of Reedmarsh, taller than a hero, gold, feathered plumes on them.
let goldreed = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  for (let i = 0; i < 5 + Math.floor(r() * 4); i++) {
    let x = Math.floor(r() * 5) - 2, z = Math.floor(r() * 5) - 2
    let tall = 11 + Math.floor(r() * 5)
    box(v, [x, 0, z], [x, tall, z], pickOf(r, [0xb8a050, 0xa89048, 0xc8b060]))
    box(
      v,
      [x, tall + 1, z],
      [x + 1, tall + 3, z],
      pickOf(r, [0xd8c8a0, 0xc8b490]),
    )
  }
  return { vox: v, size: 0.125 }
}

// A wicker eel trap, laid by the water.
let eeltrap = (seed: number): Model => {
  let v: Vox = new Map()
  for (let x = -3; x <= 3; x++) {
    let rad = 1.6 - x * 0.2
    ball(
      v,
      [x, 1, 0],
      rad,
      (xx, y, z) =>
        xx != x || Math.hypot(y - 1, z) < rad - 1
          ? null
          : (x + y + z + seed) & 1
          ? 0xa07a48
          : 0x8a6a3e,
    )
  }
  return { vox: v, size: 0.125 }
}

// A hut on stilts over the mud: posts, a deck, plank walls, a reed-thatched
// roof and a ladder down.
let stilthut = (seed: number): Model => {
  let v: Vox = new Map()
  let floor = 8
  for (let x of [-6, 5]) {
    for (let z of [-5, 4]) box(v, [x, -4, z], [x, floor, z], 0x5a4632)
  }
  box(v, [-7, floor, -6], [6, floor, 5], 0x8a6a48)
  for (let y = floor + 1; y <= floor + 7; y++) {
    for (let x = -5; x <= 4; x++) {
      for (let z of [-4, 3]) {
        if (z == 3 && x >= -1 && x <= 0 && y <= floor + 5) continue
        v.set(key(x, y, z), (x + seed) & 1 ? 0x7a5a3a : 0x6a4a30)
      }
    }
    for (let z = -4; z <= 3; z++) {
      for (let x of [-5, 4]) {
        v.set(key(x, y, z), (z + y) & 1 ? 0x7a5a3a : 0x6a4a30)
      }
    }
  }
  for (let l = 0; l <= 5; l++) {
    let c = l % 2 ? 0xc8a860 : 0xb89850
    box(v, [-6, floor + 8 + l, -5 + l], [5, floor + 8 + l, -5 + l], c)
    box(v, [-6, floor + 8 + l, 4 - l], [5, floor + 8 + l, 4 - l], c)
  }
  for (let y = 0; y < floor; y += 2) {
    box(v, [-1, y, 6 + (y >> 2)], [0, y, 6 + (y >> 2)], TIMBER)
  }
  return { vox: v, size: 0.25 }
}

// A boardwalk of planks on posts, running east and west.
let boardwalk = (seed: number): Model => {
  let v: Vox = new Map()
  for (let x = -12; x <= 11; x++) {
    box(v, [x, 2, -2], [x, 2, 1], (x + seed) % 3 ? 0x8a6a48 : 0x7a5a3e)
  }
  for (let x of [-12, -4, 4, 11]) {
    for (let z of [-2, 1]) box(v, [x, -3, z], [x, 1, z], 0x5a4632)
  }
  return { vox: v, size: 0.25 }
}

// A bald cypress of the mire: a trunk flared into buttresses, a thin crown,
// and grey moss hanging from its limbs.
let swamptree = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 18 + Math.floor(r() * 8)
  let bark = pickOf(r, [0x5a4a3a, 0x4a3e32, 0x62503e])
  for (let y = 0; y <= tall; y++) {
    let w = y < 4 ? 3 - (y >> 1) : 1
    box(v, [-w + 1, y, -w + 1], [w, y, w], bark)
  }
  let greens = [0x3a5a30, 0x4a6a38, 0x56763e]
  for (let i = 0; i < 4; i++) {
    let t = r() * Math.PI * 2, reach = 4 + Math.floor(r() * 4)
    let y = tall - 6 + Math.floor(r() * 5)
    let [ex, ez] = [
      Math.round(Math.cos(t) * reach),
      Math.round(Math.sin(t) * reach),
    ]
    for (let j = 0; j <= reach; j++) {
      v.set(
        key(
          Math.round((ex * j) / reach),
          y + (j >> 1),
          Math.round((ez * j) / reach),
        ),
        bark,
      )
    }
    canopy(v, [ex, y + (reach >> 1) + 2, ez], 3 + r(), greens, seed + i)
    for (let k = 0; k < 3; k++) {
      let mx = ex + Math.floor(r() * 5) - 2, mz = ez + Math.floor(r() * 5) - 2
      let hang = 3 + Math.floor(r() * 5)
      box(v, [mx, y + 1 - hang, mz], [mx, y + 1, mz], 0x8a9a80)
    }
  }
  return { vox: v, size: 0.25 }
}

// A thicket of bramble, red with berries.
let berrybush = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  ball(
    v,
    [0, 3, 0],
    3.5 + r(),
    (x, y, z) =>
      y < 0
        ? null
        : rand(x, y * 7 + z, seed) < 0.12
        ? 0xc8303a
        : (x + y + z) & 1
        ? 0x3e5a2e
        : 0x4a6a34,
  )
  return { vox: v, size: 0.25 }
}

// The old cypress at the heart of Mirewood, wide as a house at its foot,
// hollow, moss hanging from it to the water.
let oldcypress = (): Model => {
  let v: Vox = new Map()
  let bark = [0x4a3e32, 0x5a4a3a]
  for (let y = 0; y <= 44; y++) {
    let rad = y < 10 ? 9 - y * 0.55 : 3.5 - y * 0.02
    for (let x = -10; x <= 10; x++) {
      for (let z = -10; z <= 10; z++) {
        let d = Math.hypot(x, z)
        if (d > rad || d < rad - 2 && y > 0) continue
        if (y < 7 && z > 0 && Math.abs(x) < 2) continue
        v.set(key(x, y, z), bark[(x + y + z) & 1])
      }
    }
  }
  let greens = [0x2e4a28, 0x3a5a30, 0x4a6a38]
  for (
    let [ex, ey, ez] of [[-8, 36, -3], [7, 40, 4], [2, 46, -6], [-4, 44, 7]]
  ) {
    for (let j = 0; j <= 8; j++) {
      v.set(
        key(Math.round((ex * j) / 8), ey - 6 + j, Math.round((ez * j) / 8)),
        bark[0],
      )
    }
    canopy(v, [ex, ey + 2, ez], 5, greens, ex * 7 + ez)
    for (let k = 0; k < 6; k++) {
      let mx = ex + ((k * 5) % 7) - 3, mz = ez + ((k * 3) % 7) - 3
      box(v, [mx, ey - 10 + k, mz], [mx, ey - 1, mz], 0x8a9a80)
    }
  }
  return { vox: v, size: 0.25 }
}

// Cotton grass: thin stems with a white tuft on each.
let cottongrass = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  for (let i = 0; i < 3 + Math.floor(r() * 4); i++) {
    let x = Math.floor(r() * 5) - 2, z = Math.floor(r() * 5) - 2
    let tall = 4 + Math.floor(r() * 3)
    box(v, [x, 0, z], [x, tall, z], 0x7a8a4a)
    ball(v, [x, tall + 1, z], 1.1, () => 0xf6f4ec)
  }
  return { vox: v, size: 0.125 }
}

// Turves of peat cut and stacked to dry.
let peatstack = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let rows = 3 + Math.floor(r() * 3)
  for (let y = 0; y < rows; y++) {
    for (let x = -4 + y; x <= 3 - y; x += 2) {
      box(v, [x, y, -1], [x + 1, y, 1], (x + y) & 2 ? 0x4a3424 : 0x5a3e2a)
    }
  }
  return { vox: v, size: 0.25 }
}

// The digger's tent: canvas over a ridge pole, a lantern at its mouth.
let digtent = (): Model => {
  let v: Vox = new Map()
  for (let l = 0; l <= 7; l++) {
    for (let z = -6; z <= 5; z++) {
      v.set(key(-8 + l, l, z), 0xd8ccae)
      v.set(key(7 - l, l, z), 0xc8bc9e)
    }
  }
  box(v, [0, 0, 6], [0, 8, 6], TIMBER)
  box(v, [0, 0, -7], [0, 8, -7], TIMBER)
  v.set(key(1, 6, 6), 0xffd37a)
  box(v, [3, 0, 7], [5, 1, 8], 0x6a5a48)
  box(v, [-5, 0, 7], [-4, 0, 9], 0x8a8a8a)
  return { vox: v, size: 0.25 }
}

// A heap of earth dug out of the trench.
let spoil = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let rad = 3 + r() * 2
  ball(
    v,
    [0, 0, 0],
    rad,
    (x, y, z) =>
      y < 0 || y > (rad - Math.hypot(x, z)) * 0.8
        ? null
        : (x + y + z) & 1
        ? 0x6a5238
        : 0x5a4430,
  )
  return { vox: v, size: 0.25 }
}

// The kirk's bell tower: square, of old stone, open at the belfry with the
// bell hung in it, under a slate spire.
let belltower = (): Model => {
  let v: Vox = new Map()
  for (let y = 0; y < 40; y++) {
    for (let x = -6; x <= 5; x++) {
      for (let z = -6; z <= 5; z++) {
        if (x > -6 && x < 5 && z > -6 && z < 5) continue
        let belfry = y >= 31 && y <= 36 &&
          (Math.abs(x + 0.5) < 3 || Math.abs(z + 0.5) < 3)
        let door = z == 5 && y < 9 && Math.abs(x + 0.5) < 2
        let slit = y % 10 == 5 &&
          (Math.abs(x + 0.5) < 1 || Math.abs(z + 0.5) < 1)
        if (belfry || door || slit) continue
        v.set(key(x, y, z), OLD[((x >> 1) + y + z) & 1 ? 0 : y % 3 ? 1 : 2])
      }
    }
  }
  ball(
    v,
    [0, 33, 0],
    2.6,
    (x, y, z) =>
      y > 35 || Math.hypot(x + 0.5, z + 0.5) < 1.5 && y < 34 ? null : 0xb08a3a,
  )
  box(v, [-1, 36, -1], [0, 38, 0], 0x5a4632)
  for (let l = 0; l < 12; l++) {
    let w = 6.5 - l * 0.55
    for (let x = -7; x <= 6; x++) {
      for (let z = -7; z <= 6; z++) {
        if (Math.abs(x + 0.5) < w && Math.abs(z + 0.5) < w) {
          v.set(key(x, 40 + l, z), l & 1 ? 0x4a5058 : 0x565c64)
        }
      }
    }
  }
  return { vox: v, size: 0.25 }
}

// A gravestone, leaning: a rounded headstone, a cross, or a slab.
let grave = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let stone = pickOf(r, [OLD, [0x9a978e, 0x8a877e, 0xa8a59b]])
  let shape = seed % 3
  let lean = r() < 0.5 ? 0 : 1
  let tall = shape == 1 ? 9 : 7
  for (let y = 0; y <= tall; y++) {
    let dx = y > 4 ? lean : 0
    let w = shape == 1 ? (y == 6 ? 2 : 0) : shape == 0 && y == tall ? 1 : 2
    box(v, [-w + dx, y, 0], [
      w - 1 + dx + (shape == 1 ? 1 : 0),
      y,
      shape == 2 ? 1 : 0,
    ], stone[(y + seed) % 3])
  }
  if (noise(seed, 1, 3) > 0.5) v.set(key(0, tall, 0), 0x6f9a48)
  box(v, [-2, 0, 2], [1, 0, 6], 0x5a6a3a)
  return { vox: v, size: 0.25 }
}

// A churchyard yew, dark and dense and low.
let yew = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  box(v, [0, 0, 0], [1, 4, 1], 0x6a3a2a)
  canopy(v, [0, 7, 0], 5 + r() * 1.5, [0x1e3a26, 0x24442c, 0x2e5034], seed)
  return { vox: v, size: 0.25 }
}

// Steps down into the crypt under the chapel, through a stone door.
let crypt = (): Model => {
  let v: Vox = new Map()
  for (let y = 0; y <= 10; y++) {
    for (let x = -6; x <= 5; x++) {
      for (let z = -5; z <= 4; z++) {
        let hood = y > 7 ? 10 - y + 2 : 6
        if (Math.abs(x + 0.5) > hood) continue
        if (z == 4 && Math.abs(x + 0.5) < 3 && y < 7) continue
        v.set(key(x, y, z), OLD[(x + y + z) & 1 ? 0 : y % 3 ? 1 : 2])
      }
    }
  }
  box(v, [-2, 0, 3], [1, 6, 3], 0x141414)
  box(v, [-1, 11, 0], [0, 14, 0], OLD[2])
  box(v, [-2, 13, 0], [1, 13, 0], OLD[2])
  return { vox: v, size: 0.25 }
}

// Bog moss in cushions, green shot with red.
let sphagnum = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let [a, b] = pickOf(r, [[0x8a3a2a, 0xa84a30], [0x6a8a2a, 0x8aa83a], [
    0xa86a2a,
    0xc8883a,
  ]])
  ball(
    v,
    [0, 0, 0],
    2 + r(),
    (x, y, z) => y < 0 || y > 1 ? null : (x + z) & 1 ? a : b,
  )
  return { vox: v, size: 0.125 }
}

// Granny Rush's hut: round, of turf and wattle, thatched, a kettle on the
// fire at its door.
let hut = (): Model => {
  let v: Vox = new Map()
  for (let y = 0; y < 8; y++) {
    for (let x = -8; x <= 8; x++) {
      for (let z = -8; z <= 8; z++) {
        let d = Math.hypot(x, z)
        if (d > 7.5 || d < 6.3) continue
        if (z > 5 && Math.abs(x) < 2 && y < 6) continue
        v.set(key(x, y, z), (x + y + z) & 1 ? 0x6a5a3e : 0x7a6848)
      }
    }
  }
  for (let l = 0; l < 9; l++) {
    ball(
      v,
      [0, 8 + l, 0],
      8.8 - l,
      (x, y, z) =>
        y != 8 + l
          ? null
          : Math.hypot(x, z) < 7.8 - l
          ? null
          : l % 2
          ? 0xa88a48
          : 0x98783c,
    )
  }
  box(v, [-1, 0, 10], [1, 0, 12], 0x5a4632)
  box(v, [-1, 1, 11], [0, 2, 11], 0x3a3a3a)
  v.set(key(1, 2, 11), 0x3a3a3a)
  return { vox: v, size: 0.25 }
}

// The briar's root in Bogheart: black coils as thick as a man, arching out of
// the bog and down into it again, every one of them thorned.
let briarroot = (): Model => {
  let v: Vox = new Map()
  let bark = [0x2a1e1a, 0x3a2a22, 0x221816]
  let thorn = 0xa83a3a
  for (let a = 0; a < 7; a++) {
    let t0 = (a / 7) * Math.PI * 2
    let span = 20 + (a % 3) * 7, high = 16 + (a * 5) % 14
    for (let s = 0; s <= 80; s++) {
      let u = s / 80
      let rr = span * u
      let t = t0 + u * 0.8
      let [cx, cz] = [Math.cos(t) * rr, Math.sin(t) * rr]
      let cy = Math.sin(u * Math.PI) * high - 1
      let thick = 3.6 - u * 1.8
      ball(
        v,
        [Math.round(cx), Math.round(cy), Math.round(cz)],
        thick,
        (x, y, z) =>
          y < 0 ? null : bark[(x + y + z) & 1 ? 0 : (y % 3 == 0 ? 2 : 1)],
      )
      if (s % 4 == 0) {
        let [ox, oz] = [
          Math.round(-Math.sin(t) * (thick + 1)),
          Math.round(Math.cos(t) * (thick + 1)),
        ]
        v.set(
          key(Math.round(cx) + ox, Math.round(cy + thick), Math.round(cz) + oz),
          thorn,
        )
      }
    }
  }
  ball(
    v,
    [0, 0, 0],
    8,
    (x, y, z) => y < 0 ? null : bark[(x + y + z) & 1 ? 0 : 1],
  )
  return { vox: v, size: 0.25 }
}

// An ink cap: a tall shaggy bell, white going black at its rim.
let inkcap = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 8 + Math.floor(r() * 6)
  box(v, [0, 0, 0], [1, tall, 1], 0xeeeae0)
  for (let y = 0; y < 12; y++) {
    let rad = 3.2 - Math.abs(y - 4) * 0.28
    for (let x = -4; x <= 5; x++) {
      for (let z = -4; z <= 5; z++) {
        let d = Math.hypot(x - 0.5, z - 0.5)
        if (d > rad || d < rad - 1.5 && y > 1) continue
        let c = y < 2
          ? 0x2a2a2e
          : rand(x, y * 5 + z, seed) < 0.25
          ? 0xd8d0c0
          : 0xf2eee4
        v.set(key(x, tall - 3 + y, z), c)
      }
    }
  }
  return { vox: v, size: 0.25 }
}

// Puffballs: pale globes in a clutch on the ground.
let puffball = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  for (let i = 0; i < 1 + Math.floor(r() * 3); i++) {
    let rad = 2 + r() * 2.5
    let [x, z] = [Math.floor(r() * 7) - 3, Math.floor(r() * 7) - 3]
    ball(
      v,
      [x, Math.floor(rad * 0.8), z],
      rad,
      (xx, y, zz) =>
        y < 0 ? null : rand(xx, y * 3 + zz, seed) < 0.1 ? 0xc8c09a : 0xf0ead0,
    )
  }
  return { vox: v, size: 0.25 }
}

// The great puffball of Sporefen, burst at its crown, the spore smoke
// always rising out of it.
let bigpuff = (): Model => {
  let v: Vox = new Map()
  ball(v, [0, 10, 0], 12, (x, y, z) => {
    if (y < 0) return null
    if (y > 18 && Math.hypot(x, z) < 4) return null
    let d = Math.hypot(x, y - 10, z)
    if (d < 10.5) return null
    return y > 17
      ? 0xa8a068
      : noise(x * 0.5, z * 0.5 + y * 0.3, 7) > 0.7
      ? 0xd0c89a
      : 0xefe8cc
  })
  return { vox: v, size: 0.25 }
}

export let MARSH: Record<string, Kind> = {
  reed: { make: reed, shapes: 6, small: true },
  deadtree: { make: deadtree, shapes: 5, girth: 0.35 },
  goldreed: { make: goldreed, shapes: 6, small: true },
  eeltrap: { make: eeltrap, shapes: 3, small: true },
  stilthut: { make: stilthut, solid: true, foot: 3.5 },
  boardwalk: { make: boardwalk, foot: 1 },
  swamptree: { make: swamptree, shapes: 5, girth: 0.6 },
  berrybush: { make: berrybush, shapes: 4, girth: 0.8 },
  oldcypress: { make: oldcypress, girth: 2.2, foot: 5 },
  cottongrass: { make: cottongrass, shapes: 5, small: true },
  peatstack: { make: peatstack, shapes: 4, solid: true },
  digtent: { make: digtent, solid: true, foot: 2.5 },
  spoil: { make: spoil, shapes: 3, solid: true },
  belltower: { make: belltower, solid: true, foot: 3, span: [3, 3] },
  grave: { make: grave, shapes: 6, solid: true },
  yew: { make: yew, shapes: 4, girth: 0.5 },
  crypt: { make: crypt, solid: true, foot: 2.5, span: [3, 2.5] },
  sphagnum: { make: sphagnum, shapes: 6, small: true },
  hut: { make: hut, solid: true, foot: 3, span: [4, 4] },
  briarroot: { make: briarroot, solid: true, foot: 9 },
  inkcap: { make: inkcap, shapes: 5, girth: 0.5 },
  puffball: { make: puffball, shapes: 5, solid: true },
  bigpuff: { make: bigpuff, solid: true, foot: 4 },
}
