// The props of the sands: palms, cactus and wind-worn sandstone; and each
// level's own: Dustmere's thornbush, its houses of mud brick, the windpump
// over its well, its water jars and the boat the mere left behind; Palmwell's
// date palms and caravan tents; Sunscar's great ribcage, the gate of its
// buried town and the glass of the scar; Redmesa's hoodoos, its arch and its
// cottonwoods; Tombsands' pyramid, obelisks, tombs, urns and the colossus.
import { ball, box, key, type Vox } from '../mesh.ts'
import { noise, rand, stream } from '../rand.ts'
import {
  boulders,
  canopy,
  FOUND,
  type Kind,
  type Model,
  pickOf,
  TIMBER,
} from './kit.ts'

// A palm, leaning, its fronds drooping, `fruit` hanging `hang` voxels under
// them.
let palm = (fruit: number, hang: number) => (seed: number): Model => {
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
  for (let [x, z] of [[tx - 1, 0], [tx + 2, 1], [tx + 1, -1]]) {
    box(v, [x, tall - hang, z], [x, tall - 1, z], fruit)
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

// Wind-worn sandstone, warm and bare.
let sandstone = boulders([0xd2a878, 0xe0bc8c, 0xc0925f], null)

// A thornbush, dead and grey, a tangle of twigs.
let thornbush = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  for (let i = 0; i < 6 + Math.floor(r() * 4); i++) {
    let dx = r() * 2 - 1, dz = r() * 2 - 1, len = 3 + Math.floor(r() * 4)
    for (let t = 0; t <= len; t++) {
      let at = key(Math.round(dx * t), t, Math.round(dz * t))
      v.set(at, t & 1 ? 0x8a7a64 : 0x6e5e4a)
    }
  }
  return { vox: v, size: 0.25 }
}

let MUD = [0xd8b48a, 0xcaa47a, 0xe0c098]

// A house of mud brick, flat-roofed behind a low parapet, its roof beams
// out through the front, a dark doorway, and a ladder up to the roof.
let adobe = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let w = 22 + (seed % 2) * 4, d = 18, wall = 10 + (seed % 3)
  let x0 = -w / 2, x1 = w / 2 - 1, z0 = -d / 2, z1 = d / 2 - 1
  for (let y = 0; y <= wall; y++) {
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        if (y < wall && x > x0 && x < x1 && z > z0 && z < z1) continue
        let c = rand(x + y * 3, z - y, seed) < 0.2
          ? 1
          : noise(x, y, z) > 0.8
          ? 2
          : 0
        v.set(key(x, y, z), MUD[c])
      }
    }
  }
  for (let x = x0; x <= x1; x++) {
    for (let z of [z0, z1]) if ((x & 3) != 1) v.set(key(x, wall + 1, z), MUD[1])
  }
  for (let z = z0; z <= z1; z++) {
    for (let x of [x0, x1]) v.set(key(x, wall + 1, z), MUD[1])
  }
  for (let x = x0 + 2; x < x1; x += 4) {
    box(v, [x, wall - 2, z1 + 1], [x, wall - 2, z1 + 2], TIMBER)
  }
  box(v, [-2, 0, z1], [1, 7, z1], 0x3a2a1e)
  for (let x of [x0 + 3, x1 - 4]) box(v, [x, 5, z1], [x + 1, 6, z1], 0x3a2a1e)
  if (r() < 0.6) {
    for (let y = 0; y <= wall + 3; y++) {
      v.set(key(x1 + 1, y, z1 - 4), TIMBER)
      v.set(key(x1 + 1, y, z1 - 1), TIMBER)
      if (y % 2 == 0) box(v, [x1 + 1, y, z1 - 3], [x1 + 1, y, z1 - 2], TIMBER)
    }
  }
  return { vox: v, size: 0.25 }
}

let IRON = 0x6a6a70

// The windpump over Dustmere's well: the well's stone ring, a lattice tower
// over it, a wheel of blades on top facing south, and its tail.
let windpump = (): Model => {
  let v: Vox = new Map()
  ball(
    v,
    [0, 0, 0],
    4.2,
    (x, y, z) => y < 0 || y > 3 || Math.hypot(x, z) < 3 ? null : FOUND,
  )
  for (let y = 0; y <= 30; y++) {
    let s = Math.round(4 - (y * 3) / 30)
    for (let [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      v.set(key(a * s, y + 2, b * s), IRON)
    }
    if (y % 6 == 3) {
      for (let t = -s; t <= s; t++) {
        for (let [x, z] of [[t, -s], [t, s], [-s, t], [s, t]]) {
          v.set(key(x, y + 2, z), IRON)
        }
      }
    }
  }
  for (let a = 0; a < 18; a++) {
    let t = (a / 18) * Math.PI * 2
    for (let rr = 1; rr <= 8; rr++) {
      let x = Math.round(Math.cos(t) * rr),
        y = 34 + Math.round(Math.sin(t) * rr)
      v.set(key(x, y, 2), rr > 3 ? (a & 1 ? 0xe0d8c8 : 0xc8c0b0) : IRON)
    }
  }
  box(v, [0, 34, -10], [0, 34, 1], IRON)
  box(v, [0, 32, -12], [0, 37, -9], 0xc8403a)
  return { vox: v, size: 0.25 }
}

// Water jars in the shade, clay-red, round-bellied, their mouths dark.
let jars = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  for (let i = 0; i < 2 + Math.floor(r() * 3); i++) {
    let cx = Math.floor(r() * 11) - 5, cz = Math.floor(r() * 11) - 5
    let c = pickOf(r, [0xb8683f, 0xc87a4c, 0xa85a38])
    ball(v, [cx, 3, cz], 2.6, (_x, y) => y < 0 ? null : c)
    box(v, [cx - 1, 5, cz - 1], [cx + 1, 6, cz + 1], c)
    v.set(key(cx, 6, cz), 0x2a1e18)
  }
  return { vox: v, size: 0.125 }
}

// The boat the mere left behind: an open hull of bleached planks, stove in
// here and there, its mast snapped.
let hull = (): Model => {
  let v: Vox = new Map()
  let planks = [0x9a8a70, 0x8a7a60, 0xa89a80]
  let L = 18
  let beam = (x: number) =>
    Math.abs(x) > L ? 0 : Math.round(6 * Math.sqrt(1 - (x / L) ** 2))
  for (let x = -L; x <= L; x++) {
    let half = Math.max(1, beam(x)), rise = Math.round(3 * (x / L) ** 2)
    let edge = Math.min(half, beam(x - 1), beam(x + 1))
    for (let z = -half; z <= half; z++) {
      let low = rise + Math.round(3 * (z / half) ** 2)
      let side = Math.abs(z) >= edge
      let top = side ? rise + 7 : low
      for (let y = low; y <= top; y++) {
        let stove = side && z > 0 && x > -6 && x < 2 && y > low + 2
        if (stove) continue
        v.set(key(x, y, z), side ? planks[1 + (y & 1)] : planks[0])
      }
    }
  }
  for (let x = -L + 4; x <= L - 4; x += 5) {
    box(v, [x, 7, -beam(x)], [x, 7, beam(x)], TIMBER)
  }
  box(v, [2, 1, 0], [2, 13, 0], TIMBER)
  return { vox: v, size: 0.25 }
}

let STRIPES = [
  [0xc8403a, 0xf0e0c0],
  [0x3a5a9a, 0xf0e0c0],
  [0xd89a2a, 0x7a3a2a],
]

// A caravan tent: a ridge of striped canvas on two poles, closed at the
// back, its front flaps tied open over a rug.
let tent = (seed: number): Model => {
  let v: Vox = new Map()
  let [a, b] = STRIPES[seed % STRIPES.length]
  let W = 12, D = 10, H = 12
  for (let y = 0; y <= H; y++) {
    let xw = Math.round(W * (1 - y / H))
    let was = y == 0 ? xw : Math.round(W * (1 - (y - 1) / H))
    for (let z = -D; z <= D; z++) {
      let c = ((z + D) >> 1) & 1 ? a : b
      for (let x = xw; x <= Math.max(xw, was); x++) {
        v.set(key(x, y, z), c)
        v.set(key(-x, y, z), c)
      }
    }
    for (let x = -xw; x <= xw; x++) v.set(key(x, y, -D), b)
  }
  box(v, [0, 0, -D - 1], [0, H + 2, -D - 1], TIMBER)
  box(v, [0, 0, D + 1], [0, H + 2, D + 1], TIMBER)
  box(v, [-5, 0, D + 2], [5, 0, D + 7], 0x8a3a5a)
  box(v, [-4, 0, D + 3], [4, 0, D + 6], 0xd8a040)
  return { vox: v, size: 0.25 }
}

let BONE = [0xeee6d2, 0xdcd2ba, 0xc8bea4]

// The bones of something that died in the dunes long ago, as long as a
// street: its spine, its ribs arching over, some of them fallen, and its
// skull.
let ribcage = (): Model => {
  let v: Vox = new Map()
  let spine = (x: number) =>
    9 + Math.round(2 * Math.sin(((x + 22) / 44) * Math.PI))
  for (let x = -22; x <= 18; x++) {
    box(v, [x, spine(x), 0], [x, spine(x) + 1, 1], BONE[x & 1])
  }
  for (let i = 0; i < 10; i++) {
    let x = -18 + i * 3, R = spine(x)
    for (let side of [-1, 1]) {
      if (rand(i, side, 3) < 0.2) continue
      for (let a = 0; a <= 30; a++) {
        let t = (a / 30) * Math.PI * 0.62
        let z = side * Math.round(R * Math.sin(t) * 1.25)
        let y = spine(x) - Math.round(R * (1 - Math.cos(t)) * 0.8)
        if (y >= 0) v.set(key(x, y, z + (side < 0 ? 0 : 1)), BONE[1])
      }
    }
  }
  box(v, [19, 0, -4], [26, 7, 5], BONE[0])
  box(v, [21, 4, -5], [22, 5, -5], 0x2a241e)
  box(v, [21, 4, 6], [22, 5, 6], 0x2a241e)
  box(v, [27, 0, -3], [34, 3, 4], BONE[2])
  for (let x = 27; x <= 34; x += 2) {
    box(v, [x, 0, -4], [x, 1, -4], BONE[0])
    box(v, [x, 0, 5], [x, 1, 5], BONE[0])
  }
  return { vox: v, size: 0.5 }
}

// Glass the sun fused out of the sand at the scar: black-green spikes, pale
// at their tips.
let glassrock = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  for (let i = 0; i < 3 + Math.floor(r() * 4); i++) {
    let x = Math.floor(r() * 7) - 3, z = Math.floor(r() * 7) - 3
    let tall = 2 + Math.floor(r() * 7)
    let c = pickOf(r, [0x1e2e2a, 0x2a4a40, 0x3a6a58])
    for (let y = 0; y <= tall; y++) {
      let w = y < tall / 2 ? 1 : 0
      box(v, [x, y, z], [x + w, y, z + w], y == tall ? 0x9ad8c0 : c)
    }
  }
  return { vox: v, size: 0.25 }
}

let SANDSTONE = [0xd8bc8c, 0xc8aa7a, 0xe0c898]

// The gate of the town buried under Sunscar: two towers and the arch
// between them, standing out of the sand, the sand drifted up against them.
let buriedgate = (): Model => {
  let v: Vox = new Map()
  for (let side of [-1, 1]) {
    for (let y = 0; y <= 15; y++) {
      for (let x = side * 9 - 3; x <= side * 9 + 3; x++) {
        for (let z = -3; z <= 3; z++) {
          if (y == 15 && (x + z) & 1) continue
          v.set(key(x, y, z), SANDSTONE[(x + y + z) & 1 ? 0 : y % 3 ? 1 : 2])
        }
      }
    }
    ball(v, [side * 9, 0, 5], 4, (_x, y) => y < 0 ? null : 0xf0d898)
  }
  for (let x = -6; x <= 6; x++) {
    let spring = Math.round(Math.sqrt(Math.max(0, 36 - x * x)))
    for (let y = 4 + spring; y <= 12; y++) {
      box(v, [x, y, -2], [x, y, 2], SANDSTONE[(x + y) & 1])
    }
  }
  box(v, [-12, 12, 3], [12, 12, 3], SANDSTONE[2])
  return { vox: v, size: 0.25 }
}

let BANDS = [0xb85a38, 0xc86a44, 0xa84e30, 0xd88a5a]

// Redmesa's arch: red rock worn through by the wind, in bands.
let arch = (): Model => {
  let v: Vox = new Map()
  for (let x = -12; x <= 12; x++) {
    for (let y = 0; y <= 20; y++) {
      let inner = (x * x) / 64 + (y * y) / 225 < 1
      let outer = (x * x) / 144 + (y * y) / 400 < 1
      if (!outer || inner) continue
      for (let z = -2; z <= 2; z++) {
        if (Math.abs(z) < 2 || noise(x * 0.7, y * 0.7, z) > 0.35) {
          v.set(key(x, y, z), BANDS[(y >> 1) % 4])
        }
      }
    }
  }
  return { vox: v, size: 0.5 }
}

// A hoodoo: a spire of banded red rock, a harder stone balanced on top.
let hoodoo = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 14 + Math.floor(r() * 14)
  for (let y = 0; y <= tall; y++) {
    let w = 1.6 + Math.sin(y * 0.6 + seed) * 0.7 + (y < 3 ? 1 : 0)
    for (let x = -3; x <= 3; x++) {
      for (let z = -3; z <= 3; z++) {
        if (Math.hypot(x, z) <= w) v.set(key(x, y, z), BANDS[(y >> 1) % 4])
      }
    }
  }
  box(v, [-2, tall + 1, -2], [2, tall + 2, 2], 0x8a6a58)
  return { vox: v, size: 0.25 }
}

// A cottonwood by the spring, pale-barked, its crown yellow-green.
let cottonwood = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 5 + Math.floor(r() * 3)
  box(v, [0, 0, 0], [0, tall, 0], 0xb8b0a0)
  let crown = [0x6a8a34, 0x8aa844, 0xb8c85a]
  canopy(v, [0, tall + 2, 0], 3 + r(), crown, seed % 97)
  canopy(v, [2, tall + 1, -1], 2.2, crown, seed % 89)
  return { vox: v, size: 0.5 }
}

let LIME = [0xe0cca0, 0xd4bc8c, 0xc8b080]

// Tombsands' pyramid, stepped, a door low in its south face and gold on its
// top.
let pyramid = (): Model => {
  let v: Vox = new Map()
  for (let y = -3; y < 16; y++) {
    let half = 16 - Math.max(0, y)
    for (let t = -half; t <= half; t++) {
      for (let [x, z] of [[t, -half], [t, half], [-half, t], [half, t]]) {
        v.set(key(x, y, z), y == 15 ? 0xd8b040 : LIME[(y + 3 + (t >> 2)) % 3])
      }
    }
  }
  box(v, [-1, 0, 16], [1, 2, 16], 0x2a241e)
  box(v, [-2, 3, 15], [2, 3, 15], LIME[2])
  return { vox: v, size: 0.5 }
}

// An obelisk, a needle of stone cut with signs, its tip gold.
let obelisk = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 24 + Math.floor(r() * 12)
  box(v, [-2, 0, -2], [1, 1, 1], LIME[2])
  for (let y = 2; y <= tall; y++) {
    for (let [x, z] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
      let sign = y > 4 && y < tall - 3 && noise(x * 2 + y, z * 2, seed) > 0.78
      v.set(key(x, y, z), sign ? 0xa88a60 : LIME[y & 1])
    }
  }
  box(v, [-1, tall + 1, -1], [0, tall + 1, 0], 0xd8b040)
  v.set(key(0, tall + 2, 0), 0xd8b040)
  return { vox: v, size: 0.25 }
}

// A tomb: a long low block of stone with sloping walls, a dark door in its
// south face.
let mastaba = (seed: number): Model => {
  let v: Vox = new Map()
  for (let y = 0; y <= 9; y++) {
    let x1 = 12 - Math.floor(y / 3), z1 = 8 - Math.floor(y / 3)
    for (let x = -x1; x <= x1; x++) {
      for (let z = -z1; z <= z1; z++) {
        if (y < 9 && Math.abs(x) < x1 && Math.abs(z) < z1) continue
        v.set(key(x, y, z), LIME[(x + y + z + seed) % 3])
      }
    }
  }
  box(v, [-2, 0, 8], [1, 5, 8], 0x2a241e)
  box(v, [-3, 6, 8], [2, 6, 8], 0x5a4a38)
  return { vox: v, size: 0.25 }
}

// A funeral urn, tall and dark, a gold band round its shoulder.
let urn = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let c = pickOf(r, [0x5a3a2a, 0x3a3a4a, 0x6a4a30])
  for (let y = 0; y <= 9; y++) {
    let w = y < 2 ? 1 : y < 7 ? 2 : 1
    box(v, [-w, y, -w], [w, y, w], y == 6 ? 0xd8b040 : c)
  }
  v.set(key(0, 9, 0), 0x1a1410)
  return { vox: v, size: 0.125 }
}

// The colossus of the sunken tomb: a king's stone head, sunk to the chin in
// the sand, his headdress striped blue and gold.
let colossus = (): Model => {
  let v: Vox = new Map()
  let stripe = (y: number) => (y >> 1) & 1 ? 0x2a4a8a : 0xd8b040
  for (let y = 0; y <= 15; y++) {
    let wide = y < 8 ? 6 : y < 12 ? 5 : 16 - y
    for (let x = -wide; x <= wide; x++) {
      for (let z = -5; z <= 2; z++) {
        let face = Math.abs(x) <= 3 && z == 2 && y >= 1 && y <= 11
        if (Math.abs(x) < wide && z > -5 && z < 2 && y < 15) continue
        v.set(key(x, y, z), face ? LIME[1] : stripe(y))
      }
    }
  }
  box(v, [-3, 1, 3], [3, 11, 3], LIME[1])
  for (let x of [-3, 2]) {
    box(v, [x, 8, 4], [x + 1, 8, 4], 0x2a241e)
    box(v, [x, 9, 4], [x + 1, 9, 4], LIME[2])
  }
  box(v, [0, 5, 4], [0, 7, 5], LIME[0])
  box(v, [-1, 3, 4], [1, 3, 4], 0x8a6a58)
  box(v, [0, -2, 3], [0, 2, 4], stripe(1))
  box(v, [0, 12, 3], [0, 13, 4], 0xd8b040)
  return { vox: v, size: 0.5 }
}

export let SANDS: Record<string, Kind> = {
  palm: { make: palm(0x6e4a2e, 1), shapes: 5, girth: 0.4, detail: true },
  datepalm: { make: palm(0xc8742a, 3), shapes: 5, girth: 0.4, detail: true },
  cactus: { make: cactus, shapes: 5, girth: 0.4 },
  sandstone: { make: sandstone, shapes: 5, solid: true, detail: true },
  thornbush: { make: thornbush, shapes: 5 },
  adobe: { make: adobe, shapes: 4, foot: 4.5, span: [6.5, 5] },
  windpump: { make: windpump, girth: 1.2, foot: 1.5, span: [2.2, 2.2] },
  jars: { make: jars, shapes: 4, foot: 0.8 },
  hull: { make: hull, foot: 6 },
  tent: { make: tent, shapes: 3, foot: 4, span: [6, 5] },
  ribcage: { make: ribcage, foot: 12 },
  glassrock: { make: glassrock, shapes: 5 },
  buriedgate: { make: buriedgate, foot: 5 },
  arch: { make: arch, foot: 7 },
  hoodoo: { make: hoodoo, shapes: 5, girth: 1 },
  cottonwood: { make: cottonwood, shapes: 4, girth: 0.5, detail: true },
  pyramid: { make: pyramid, foot: 10 },
  obelisk: { make: obelisk, shapes: 4, girth: 0.6 },
  mastaba: { make: mastaba, shapes: 3, foot: 4, span: [6, 4] },
  urn: { make: urn, shapes: 3 },
  colossus: { make: colossus, foot: 6 },
}
