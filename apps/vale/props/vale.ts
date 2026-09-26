// The props of the green country round Mossvale: its trees, its boulders,
// and the flowers, grass and mushrooms underfoot; and what makes each level of
// the vale its own: Birchmere's bluebells and jetty, Clovermead's clover,
// hives and windmill, Fernwood's ferns, logs and the great fallen trunk,
// Elderglade's elders and the Elder, Greypine's grey pines and watchtower,
// and Wolfden's dark pines, bones and dens.
import { ball, box, key, type Vox } from '../mesh.ts'
import { noise, rand, stream } from '../rand.ts'
import {
  boulders,
  canopy,
  type Kind,
  type Model,
  pickOf,
  TIMBER,
} from './kit.ts'

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

let rock = boulders([0x8f8e86, 0xa3a198, 0x7f7e77], 0x6f9a48)

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

// Bluebells, nodding under the birches.
let bluebell = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let blue = pickOf(r, [0x5a6fd8, 0x6a7fe6, 0x7466d4])
  for (let i = 0; i < 2 + Math.floor(r() * 3); i++) {
    let x = Math.floor(r() * 4) - 2, z = Math.floor(r() * 4) - 2
    let tall = 3 + Math.floor(r() * 3)
    box(v, [x, 0, z], [x, tall, z], 0x4f8f3c)
    v.set(key(x + 1, tall, z), 0x4f8f3c)
    for (let y = tall - 2; y < tall; y++) {
      v.set(key(x + 1 + (y & 1), y, z), blue)
    }
  }
  box(v, [-1, 0, -1], [1, 0, 1], 0x5a9a44)
  return { vox: v, size: 0.125 }
}

// A jetty of grey planks out north over the water on posts, and a rowing
// boat tied at its end.
let jetty = (): Model => {
  let v: Vox = new Map()
  for (let z = 0; z <= 24; z++) {
    box(v, [-3, 0, -z], [2, 0, -z], z % 3 == 0 ? 0x8a7a66 : 0x9c8b74)
  }
  for (let z of [0, 8, 16, 24]) {
    for (let x of [-3, 2]) box(v, [x, -10, -z], [x, 2, -z], 0x6a5a48)
  }
  // The boat, bow to the shore.
  for (let z = 14; z <= 23; z++) {
    let w = z < 16 || z > 21 ? 1 : 2
    box(v, [4, -2, -z], [4 + w * 2, -2, -z], 0x7a5236)
    v.set(key(4, -1, -z), 0x9a6a42)
    v.set(key(4 + w * 2, -1, -z), 0x9a6a42)
  }
  box(v, [5, -1, -18], [7, -1, -18], 0xb08a5a)
  return { vox: v, size: 0.25 }
}

// Clover in a clump, three leaves to a stem, a round head of pink or white.
let clover = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let head = pickOf(r, [0xf0a6c4, 0xf6f0f2, 0xe98ab4])
  for (let i = 0; i < 4 + Math.floor(r() * 4); i++) {
    let x = Math.floor(r() * 5) - 2, z = Math.floor(r() * 5) - 2
    v.set(key(x, 0, z), 0x3f8a3a)
    v.set(key(x + 1, 0, z), 0x4f9a44)
    v.set(key(x, 0, z + 1), 0x4f9a44)
  }
  box(v, [0, 0, 0], [0, 2, 0], 0x4f8f3c)
  box(v, [0, 3, 0], [0, 4, 0], head)
  v.set(key(1, 3, 0), head)
  v.set(key(-1, 3, 0), head)
  return { vox: v, size: 0.125 }
}

// A stone windmill: a round tower, a cap of thatch, and four sails turned to
// the south.
let windmill = (): Model => {
  let v: Vox = new Map()
  let stone = [0xe2dccc, 0xd4ccb8, 0xc8bfa8]
  for (let y = 0; y < 30; y++) {
    let r = 6.5 - y * 0.08
    ball(
      v,
      [0, y, 0],
      r,
      (x, yy, z) =>
        yy != y || Math.hypot(x, z) < r - 1.2
          ? null
          : stone[(x + y + z) & 1 ? 0 : y % 3],
    )
  }
  box(v, [-1, 0, 5], [0, 5, 6], 0x6e4a31)
  for (let y of [11, 19]) box(v, [-1, y, 5], [0, y + 2, 5], 0x3b5578)
  for (let y = 30; y < 38; y++) {
    let r = 6 - (y - 30) * 0.75
    ball(
      v,
      [0, y, 0],
      r,
      (_x, yy) => yy != y ? null : y % 2 ? 0xc9a45a : 0xb8923f,
    )
  }
  box(v, [0, 27, 5], [0, 28, 8], 0x5a4030)
  // The sails: four lattice arms from the hub.
  for (let [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    for (let i = 1; i <= 13; i++) {
      let x = dx * i, y = 27 + dy * i
      v.set(key(x, y, 8), 0x6a4b33)
      for (let w = 1; i > 3 && w <= 2; w++) {
        v.set(key(x + dx * w, y, 8), (i + w) % 2 ? 0xf2ead8 : 0xe6dcc4)
        v.set(key(x, y - dy * w, 8), (i + w) % 2 ? 0xe6dcc4 : 0xf2ead8)
      }
    }
  }
  return { vox: v, size: 0.25 }
}

// A straw beehive on a little stand.
let skep = (): Model => {
  let v: Vox = new Map()
  box(v, [-2, 0, -2], [-2, 2, -2], TIMBER)
  box(v, [2, 0, 2], [2, 2, 2], TIMBER)
  box(v, [-2, 0, 2], [-2, 2, 2], TIMBER)
  box(v, [2, 0, -2], [2, 2, -2], TIMBER)
  box(v, [-3, 3, -3], [3, 3, 3], 0x8a6240)
  for (let y = 4; y <= 9; y++) {
    let r = Math.sqrt(Math.max(0, 9.5 - (y - 4) ** 2 * 0.3))
    ball(
      v,
      [0, y, 0],
      r,
      (_x, yy) => yy != y ? null : y % 2 ? 0xd8b060 : 0xc89c48,
    )
  }
  v.set(key(0, 5, 3), 0x3a2a18)
  return { vox: v, size: 0.25 }
}

// Fern fronds arching out of a crown.
let fern = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let greens = pickOf(r, [
    [0x3f8a3a, 0x5aa446],
    [0x4a9a3e, 0x68b44e],
    [0x3a7a36, 0x4f943e],
  ])
  let arms = 5 + Math.floor(r() * 3)
  for (let a = 0; a < arms; a++) {
    let t = (a / arms) * Math.PI * 2 + r() * 0.5
    let len = 6 + Math.floor(r() * 4)
    for (let i = 0; i <= len; i++) {
      let x = Math.round(Math.cos(t) * i), z = Math.round(Math.sin(t) * i)
      let y = Math.round(i * 1.1 - (i * i) / (len * 0.9))
      v.set(key(x, Math.max(0, y), z), greens[i % 2])
    }
  }
  return { vox: v, size: 0.125 }
}

// A fallen trunk, long mossed over.
let log = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let len = 8 + Math.floor(r() * 6)
  for (let x = -len; x <= len; x++) {
    ball(
      v,
      [x, 1, 0],
      1.7,
      (xx, y, z) =>
        xx != x
          ? null
          : y >= 2 && rand(x, z, seed) < 0.6
          ? pickOf(r, [0x5f9a44, 0x6fae4d])
          : Math.abs(x) == len
          ? 0xb89a70
          : 0x6b4a33,
    )
  }
  return { vox: v, size: 0.25 }
}

// The old trunk of Fernwood, fallen long ago: hollow, ferned over, and big
// enough to stand in.
let hollowlog = (): Model => {
  let v: Vox = new Map()
  for (let x = -28; x <= 26; x++) {
    let rad = 7 - Math.max(0, x - 18) * 0.2
    ball(v, [x, 6, 0], rad, (xx, y, z) => {
      if (xx != x || y < 0) return null
      let d = Math.hypot(y - 6, z)
      if (d < rad - 2 && x > -24) return null
      if (y >= 9 && noise(x * 0.4, z * 0.4, 7) > 0.45) {
        return (x + z) & 1 ? 0x4f943e : 0x5fa84a
      }
      return (x + y) % 5 == 0 ? 0x5a3e2a : 0x6b4a33
    })
  }
  // Roots torn up at the one end.
  for (let a = 0; a < 7; a++) {
    let t = (a / 7) * Math.PI * 2
    for (let i = 0; i < 6; i++) {
      v.set(
        key(
          -29 - (i >> 1),
          6 + Math.round(Math.sin(t) * (7 + i)),
          Math.round(Math.cos(t) * (7 + i)),
        ),
        0x5a3e2a,
      )
    }
  }
  return { vox: v, size: 0.25 }
}

// An elder: a thick, gnarled old trunk on roots, and a wide crown.
let elder = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 7 + Math.floor(r() * 3)
  let bark = [0x6a5038, 0x5a4230]
  box(v, [-1, 0, -1], [1, tall, 1], bark[0])
  for (let [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
    box(v, [dx, 0, dz], [dx, 1, dz], bark[1])
  }
  for (let y = 2; y < tall; y += 3) v.set(key(1 + (y & 1), y, -1), bark[1])
  let greens = pickOf(r, [
    [0x4f8a38, 0x6aa244, 0x88b852],
    [0x5a8f3a, 0x78a848, 0x9cc05a],
  ])
  canopy(v, [0, tall + 3, 0], 5 + r(), greens, seed % 97)
  canopy(v, [4, tall + 1, 2], 3.2, greens, seed % 89)
  canopy(v, [-4, tall + 2, -2], 3.4, greens, seed % 83)
  canopy(v, [1, tall + 2, -4], 3, greens, seed % 79)
  return { vox: v, size: 0.5 }
}

// The Elder of Elderglade: a tree older than the vale, its roots a hill of
// their own and its crown a sky.
let eldertree = (): Model => {
  let v: Vox = new Map()
  let bark = [0x5e4632, 0x4e3a28, 0x6e5440]
  for (let y = 0; y <= 22; y++) {
    let rad = 3.2 - y * 0.05 + (y < 3 ? 3 - y : 0)
    ball(
      v,
      [0, y, 0],
      rad,
      (x, yy, z) =>
        yy != y
          ? null
          : bark[(x * 3 + z + (y >> 1)) % 3 == 0 ? 1 : (x + z) & 1 ? 0 : 2],
    )
  }
  // Great roots, snaking out.
  for (let a = 0; a < 8; a++) {
    let t = (a / 8) * Math.PI * 2 + 0.3
    for (let i = 3; i < 11; i++) {
      let x = Math.round(Math.cos(t) * i), z = Math.round(Math.sin(t) * i)
      box(v, [x, 0, z], [x, Math.max(0, 2 - (i >> 2)), z], bark[1])
    }
  }
  // Limbs out to the crown.
  for (let [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
    for (let i = 1; i <= 7; i++) {
      v.set(key(dx * i, 18 + (i >> 1), dz * i), bark[0])
      v.set(key(dx * i, 19 + (i >> 1), dz * i), bark[0])
    }
  }
  let greens = [0x4a8a36, 0x66a444, 0x8cc05a]
  canopy(v, [0, 27, 0], 9, greens, 11)
  canopy(v, [7, 23, 3], 6, greens, 13)
  canopy(v, [-7, 24, -3], 6.5, greens, 17)
  canopy(v, [2, 24, -8], 5.5, greens, 19)
  canopy(v, [-3, 23, 7], 5.5, greens, 23)
  return { vox: v, size: 0.5 }
}

// A pine of the grey woods: tall and narrow, blue-grey, lichen on its bark.
let greypine = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 12 + Math.floor(r() * 5)
  box(v, [0, 0, 0], [0, 3, 0], 0x6a645c)
  v.set(key(0, 1, 0), 0x9aa89a)
  let greys = pickOf(r, [
    [0x5a7068, 0x6e8478],
    [0x566a66, 0x6a7e78],
    [0x62766a, 0x788a7c],
  ])
  for (let y = 3; y < tall; y++) {
    let t = (y - 3) / (tall - 3)
    let rad = (1 - t) * 2.4 + (y % 3 == 0 ? 0.6 : 0)
    ball(
      v,
      [0, y, 0],
      rad,
      (x, yy, z) =>
        yy != y ? null : Math.hypot(x, z) > rad - 1 ? greys[1] : greys[0],
    )
  }
  v.set(key(0, tall, 0), greys[1])
  return { vox: v, size: 0.5 }
}

// A watchtower of grey stone, long abandoned, its top fallen in.
let watchtower = (): Model => {
  let v: Vox = new Map()
  let stone = [0x9a9890, 0x8a8880, 0xa8a69c]
  for (let y = 0; y < 34; y++) {
    for (let x = -6; x <= 5; x++) {
      for (let z = -6; z <= 5; z++) {
        let edge = x == -6 || x == 5 || z == -6 || z == 5
        if (!edge) continue
        let top = 30 + ((x * 7 + z * 3) & 3) - (x > 1 && z < -2 ? 6 : 0)
        if (y > top) continue
        if (z == 5 && x >= -1 && x <= 0 && y < 8) continue
        if (
          (y == 14 || y == 15 || y == 24 || y == 25) && (x == -1 || z == -1)
        ) {
          continue
        }
        v.set(key(x, y, z), stone[(x + y + z) & 1 ? 0 : y % 3 ? 1 : 2])
      }
    }
  }
  box(v, [-7, 0, -7], [6, 1, 6], 0x7f7e77)
  v.set(key(-6, 12, 2), 0x6f8a5a)
  v.set(key(5, 20, -3), 0x6f8a5a)
  return { vox: v, size: 0.25 }
}

// A pine of the dark hollow, nearly black, bare of its lower limbs.
let darkpine = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 11 + Math.floor(r() * 4)
  box(v, [0, 0, 0], [0, 5, 0], 0x3e3228)
  for (let y = 2; y < 5; y++) {
    if (r() < 0.5) v.set(key(pickOf(r, [1, -1]), y, 0), 0x3e3228)
  }
  let dark = pickOf(r, [0x243a2c, 0x1f3428, 0x2a4030])
  for (let y = 5; y < tall; y++) {
    let t = (y - 5) / (tall - 5)
    let rad = (1 - t) * 3 + (y % 2) * 0.5
    ball(
      v,
      [0, y, 0],
      rad,
      (x, yy, z) =>
        yy != y ? null : Math.hypot(x, z) > rad - 1 ? dark : 0x18281e,
    )
  }
  v.set(key(0, tall, 0), dark)
  return { vox: v, size: 0.5 }
}

// Old bones in the grass: a skull, a rib or two.
let bones = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let bone = [0xe8e0cc, 0xd6ccb4]
  if (r() < 0.5) {
    box(v, [-1, 0, -1], [1, 1, 1], bone[0])
    v.set(key(-1, 1, 1), 0x2a2420)
    v.set(key(1, 1, 1), 0x2a2420)
    box(v, [-1, 0, 2], [1, 0, 2], bone[1])
  }
  for (let i = 0; i < 2 + Math.floor(r() * 3); i++) {
    let x = Math.floor(r() * 6) - 3
    for (let z = -2; z <= 2; z++) {
      v.set(key(x, z == 0 ? 1 : 0, z - 3), bone[i & 1])
    }
  }
  return { vox: v, size: 0.125 }
}

// A den dug under a heap of stone, its mouth dark.
let den = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let greys = [0x6f6e68, 0x7f7e77, 0x5f5e58]
  let rad = 3 + r()
  ball(
    v,
    [0, 0, 0],
    rad,
    (x, y, z) =>
      y < 0
        ? null
        : y > 1 && noise(x, z, seed) > 0.6
        ? 0x4f6a3e
        : greys[(x + y + z) & 1 ? 0 : (x * 3 + z) % 3 == 0 ? 2 : 1],
  )
  for (let y = 0; y <= 1; y++) {
    for (let x = -1; x <= 0; x++) {
      for (let z = 1; z <= Math.ceil(rad); z++) v.set(key(x, y, z), 0x14120f)
    }
  }
  box(v, [-2, 2, Math.ceil(rad) - 1], [1, 2, Math.ceil(rad) - 1], greys[2])
  return { vox: v, size: 0.5 }
}

// The great den at the heart of Wolfden: a crag split open, bones at its
// mouth.
let lair = (): Model => {
  let v: Vox = new Map()
  let greys = [0x5f5e58, 0x6f6e68, 0x4f4e49]
  ball(
    v,
    [0, 0, 0],
    12,
    (x, y, z) =>
      y < 0 || y > 9 + noise(x * 0.3, z * 0.3, 3) * 4
        ? null
        : greys[(x + y + z) & 1 ? 0 : (x * 5 + z) % 3 == 0 ? 2 : 1],
  )
  for (let y = 0; y <= 5; y++) {
    let w = 3 - Math.max(0, y - 3)
    for (let x = -w; x <= w; x++) {
      for (let z = 4; z <= 12; z++) v.set(key(x, y, z), 0x0f0d0b)
    }
  }
  for (let [x, z] of [[-4, 13], [3, 14], [5, 12], [-2, 15]]) {
    box(v, [x, 0, z], [x + 1, 0, z], 0xe8e0cc)
  }
  return { vox: v, size: 0.25 }
}

// A fern grown into a tree: a shaggy trunk and a crown of long fronds bowing
// out of it.
let treefern = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 6 + Math.floor(r() * 4)
  box(v, [0, 0, 0], [0, tall, 0], 0x5a4030)
  for (let y = 1; y < tall; y += 2) v.set(key(y & 2 ? 1 : -1, y, 0), 0x4a6a34)
  let greens = [0x3f8a3a, 0x5aa446]
  for (let a = 0; a < 8; a++) {
    let t = (a / 8) * Math.PI * 2 + r() * 0.3
    for (let i = 1; i <= 5; i++) {
      let x = Math.round(Math.cos(t) * i), z = Math.round(Math.sin(t) * i)
      v.set(key(x, tall + 1 - Math.floor((i * i) / 6), z), greens[i & 1])
    }
  }
  v.set(key(0, tall + 1, 0), greens[1])
  return { vox: v, size: 0.5 }
}

export let VALE: Record<string, Kind> = {
  oak: { make: oak, shapes: 6, girth: 0.45 },
  pine: { make: pine, shapes: 5, girth: 0.45 },
  birch: { make: birch, shapes: 4, girth: 0.45 },
  rock: { make: rock, shapes: 6, solid: true },
  flower: { make: flower, shapes: 8, small: true },
  tuft: { make: tuft, shapes: 6, small: true },
  mushroom: { make: mushroom, shapes: 3, small: true },
  bluebell: { make: bluebell, shapes: 5, small: true },
  jetty: { make: jetty, foot: 2 },
  clover: { make: clover, shapes: 6, small: true },
  windmill: { make: windmill, girth: 1.6, foot: 3.5, span: [3.4, 3.4] },
  skep: { make: skep, girth: 0.4, foot: 0.8 },
  fern: { make: fern, shapes: 6, small: true },
  treefern: { make: treefern, shapes: 5, girth: 0.3 },
  log: { make: log, shapes: 4, girth: 0.45, row: 2.5 },
  hollowlog: { make: hollowlog, girth: 1.7, row: 6, foot: 8 },
  elder: { make: elder, shapes: 5, girth: 0.8 },
  eldertree: { make: eldertree, girth: 1.8, foot: 7 },
  greypine: { make: greypine, shapes: 5, girth: 0.45 },
  watchtower: { make: watchtower, solid: true, foot: 3, span: [3, 3] },
  darkpine: { make: darkpine, shapes: 5, girth: 0.45 },
  bones: { make: bones, shapes: 4, small: true },
  den: { make: den, shapes: 4, solid: true },
  lair: { make: lair, solid: true, foot: 4 },
}
