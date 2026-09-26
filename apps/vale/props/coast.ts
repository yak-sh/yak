// The props of the coast, each level's own: Gullwick's quay and its boats,
// its fish racks and the scarecrow in its fields; Driftwood's bleached logs,
// marram, shore pines and the wreck on its beach; Saltreach's salt heaps,
// crusted pans, white chalk and saltworks; Shellstrand's shells, sea pinks
// and the great conch; Stormhead's wind-bent trees and its lighthouse.
import { ball, box, key, unkey, type Vox } from '../mesh.ts'
import { noise, stream } from '../rand.ts'
import { boulders, type Kind, type Model, pickOf, TIMBER } from './kit.ts'

// A fishing boat, bow to the north, sitting `y0` voxels down: a painted
// hull, open, two thwarts across it, and a mast with a pennant.
let boat = (v: Vox, x0: number, y0: number, z0: number, paint: number) => {
  for (let z = 0; z < 20; z++) {
    let w = Math.round(3 * Math.sin((Math.PI * (z + 1)) / 21) ** 0.6)
    for (let y = 0; y < 4; y++) {
      let ww = y == 0 ? w - 1 : w
      for (let x = -ww; x <= ww; x++) {
        if (Math.abs(x) != ww && y > 0) continue
        let c = y == 3 ? TIMBER : y == 2 ? 0xf2ead8 : paint
        v.set(key(x0 + x, y0 + y, z0 - z), c)
      }
    }
  }
  for (let z of [7, 13]) {
    box(v, [x0 - 2, y0 + 2, z0 - z], [x0 + 2, y0 + 2, z0 - z], TIMBER)
  }
  box(v, [x0, y0 + 1, z0 - 10], [x0, y0 + 18, z0 - 10], TIMBER)
  box(v, [x0 + 1, y0 + 17, z0 - 10], [x0 + 2, y0 + 17, z0 - 10], paint)
}

// A stone quay out north over the harbour, bollards along it, a boat tied
// either side and crates at its foot.
let quay = (): Model => {
  let v: Vox = new Map()
  let stone = [0x9a968c, 0x8a867c, 0xaaa69a]
  for (let z = 0; z <= 40; z++) {
    for (let x = -6; x <= 5; x++) {
      for (let y = -12; y <= 0; y++) {
        if (x > -6 && x < 5 && y < 0 && z < 40) continue
        v.set(
          key(x, y, -z),
          stone[(x * 3 + y + z * 7) % 3 == 0 ? 1 : (x + z) & 1 ? 0 : 2],
        )
      }
    }
  }
  for (let z of [6, 18, 30, 39]) {
    box(v, [-6, 1, -z], [-6, 2, -z], 0x4a4540)
    box(v, [5, 1, -z], [5, 2, -z], 0x4a4540)
  }
  boat(v, -10, -4, -8, 0x3f6fa8)
  boat(v, 9, -4, -18, 0xb8483a)
  box(v, [1, 1, -2], [3, 3, -4], 0x9a7a52)
  box(v, [2, 4, -3], [3, 5, -4], 0xb08a5a)
  return { vox: v, size: 0.25 }
}

// Nets hung out to dry between two poles, a float or two caught in them.
let netrack = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  for (let x of [-8, 8]) box(v, [x, 0, 0], [x, 10, 0], TIMBER)
  box(v, [-8, 10, 0], [8, 10, 0], TIMBER)
  let net = pickOf(r, [0x6a5a48, 0x4a5a58, 0x7a6048])
  for (let x = -7; x <= 7; x++) {
    let low = 2 + Math.round(Math.abs(Math.sin(x * 0.45 + seed)) * 3)
    for (let y = low; y < 10; y++) if ((x + y) & 1) v.set(key(x, y, 0), net)
  }
  v.set(key(-3, 6, 1), 0xe86a3a)
  v.set(key(4, 5, 1), 0xf0c040)
  return { vox: v, size: 0.25 }
}

// Cabbages in a row, blue-green, pale at the heart.
let cabbage = (seed: number): Model => {
  let v: Vox = new Map()
  ball(
    v,
    [0, 1, 0],
    2.2,
    (x, y, z) =>
      y < 0
        ? null
        : y >= 2 && Math.abs(x) + Math.abs(z) < 2
        ? 0xc8e0a8
        : (x + z + seed) & 1
        ? 0x6a9a6a
        : 0x7fae78,
  )
  return { vox: v, size: 0.125 }
}

// Barley standing ripe, bearded heads bowed.
let barley = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  for (let i = 0; i < 6 + Math.floor(r() * 4); i++) {
    let x = Math.floor(r() * 5) - 2, z = Math.floor(r() * 5) - 2
    let tall = 6 + Math.floor(r() * 3)
    box(v, [x, 0, z], [x, tall, z], 0xc8b060)
    box(v, [x + 1, tall - 2, z], [x + 1, tall, z], 0xe0c878)
  }
  return { vox: v, size: 0.125 }
}

// A scarecrow in a coat and a hat, arms out over the furrows.
let scarecrow = (): Model => {
  let v: Vox = new Map()
  box(v, [0, 0, 0], [0, 14, 0], TIMBER)
  box(v, [-5, 10, 0], [5, 10, 0], TIMBER)
  box(v, [-2, 6, -1], [2, 11, 1], 0x4a5a7a)
  box(v, [-4, 9, -1], [4, 11, 1], 0x4a5a7a)
  for (let x of [-5, 5]) box(v, [x, 8, 0], [x, 9, 0], 0xd8c078)
  box(v, [-1, 12, -1], [1, 14, 1], 0xd8c078)
  box(v, [-2, 15, -2], [2, 15, 2], 0x5a4030)
  box(v, [-1, 16, -1], [1, 17, 1], 0x5a4030)
  return { vox: v, size: 0.25 }
}

// A log bleached by salt and sun, a stub of branch left on it.
let driftlog = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let len = 5 + Math.floor(r() * 4)
  let pale = [0xd8d0c0, 0xc8bfae, 0xe4ddd0]
  for (let x = -len; x <= len; x++) {
    for (let y = 0; y <= 1; y++) {
      for (let z = 0; z <= 1; z++) {
        v.set(key(x, y, z), pale[(x + y + z) & 1 ? 0 : x % 3 ? 1 : 2])
      }
    }
  }
  for (let i = 1; i <= 3; i++) v.set(key(len - 4 + i, 1 + i, 0), pale[1])
  return { vox: v, size: 0.25 }
}

// Marram: tall pale grass on the dunes, bent by the wind.
let marram = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  for (let i = 0; i < 5 + Math.floor(r() * 4); i++) {
    let x = Math.floor(r() * 5) - 2, z = Math.floor(r() * 5) - 2
    let tall = 6 + Math.floor(r() * 5)
    let c = pickOf(r, [0xb8b878, 0xa8a868, 0xc8c088])
    for (let y = 0; y <= tall; y++) {
      v.set(key(x + (y > tall - 3 ? 1 : 0), y, z), c)
    }
  }
  return { vox: v, size: 0.125 }
}

// A pine of the shore, its trunk twisted by the wind and its crown flat and
// wide as a parasol.
let shorepine = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 16 + Math.floor(r() * 6)
  let [tx, tz] = [0, 0]
  let dx = r() < 0.5 ? 1 : -1, dz = r() < 0.5 ? 1 : -1
  for (let y = 0; y <= tall; y++) {
    if (y > 3 && y % 5 == 0) tx += dx
    if (y > 8 && y % 7 == 0) tz += dz
    box(v, [tx, y, tz], [tx + 1, y, tz + 1], y % 3 ? 0x7a5a44 : 0x6a4a36)
  }
  for (let i = 1; i <= 4; i++) {
    v.set(key(tx - dx * i, tall - 4 + i, tz), 0x6a4a36)
    v.set(key(tx + 1, tall - 3 + i, tz - dz * i), 0x6a4a36)
  }
  let greens = [0x2f5a38, 0x3a6a40, 0x467a48]
  let rad = 5 + r() * 2
  for (let x = -10; x <= 11; x++) {
    for (let z = -10; z <= 11; z++) {
      let d = Math.hypot(x - 0.5, z - 0.5)
      if (d > rad || d > rad - 2 && noise(x * 0.4, z * 0.4, seed) < 0.3) {
        continue
      }
      let edge = d > rad - 2.5
      for (let y = edge ? 0 : -1; y <= 1; y++) {
        v.set(key(tx + x, tall + y, tz + z), greens[y + 1])
      }
    }
  }
  return { vox: v, size: 0.25 }
}

// A ship broken on the beach: its ribs standing out of the sand, some of
// one side's planking, the stem, and the mast snapped and leaning.
let wreck = (): Model => {
  let v: Vox = new Map()
  let wood = [0x6a5440, 0x54402e, 0x7a6450]
  box(v, [-24, 0, 0], [22, 0, 0], wood[1])
  for (let x = -22; x <= 20; x++) {
    let w = 9 * Math.sqrt(Math.max(0, 1 - ((x + 1) / 23) ** 2))
    if (w < 2) continue
    let rib = x % 3 == 0
    for (let a = 0; a <= 32; a++) {
      let t = (a / 32) * Math.PI
      let z = Math.round(-Math.cos(t) * w)
      let y = Math.round((1 - Math.sin(t)) * w * 0.9)
      let planked = z < -2 && noise(x * 0.4, y * 0.4, 5) > 0.45
      if (rib) v.set(key(x, y, z), wood[1])
      else if (planked) v.set(key(x, y, z), (x + y) & 1 ? wood[0] : wood[2])
    }
  }
  box(v, [21, 0, 0], [22, 12, 0], wood[1])
  for (let i = 0; i < 22; i++) v.set(key(-3 + (i >> 2), 1 + i, i >> 3), wood[0])
  return { vox: v, size: 0.25 }
}

// A heap of raked salt, white and crusted.
let saltpile = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let rad = 3 + r() * 2
  ball(
    v,
    [0, 0, 0],
    rad,
    (x, y, z) =>
      y < 0 || y > (rad - Math.hypot(x, z)) * 1.1
        ? null
        : (x + y + z) & 1
        ? 0xf4f2ec
        : 0xe6e2d8,
  )
  return { vox: v, size: 0.25 }
}

// Salt dried on the pan in a crust, its cracks raised in rings.
let saltcrust = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let rad = 2.5 + r() * 1.5
  for (let a = 0; a < 16; a++) {
    if (r() < 0.25) continue
    let t = (a / 16) * Math.PI * 2
    v.set(
      key(Math.round(Math.cos(t) * rad), 0, Math.round(Math.sin(t) * rad)),
      a & 1 ? 0xd6ccb8 : 0xe2dac8,
    )
  }
  return { vox: v, size: 0.125 }
}

// The saltworks: a stone boiling house, its chimney, rakes stood against
// the wall, and a pan of brine before its door.
let saltworks = (): Model => {
  let v: Vox = new Map()
  let stone = [0xb0aa9c, 0xa09a8c]
  for (let y = 0; y < 12; y++) {
    for (let x = -10; x <= 9; x++) {
      for (let z = -8; z <= 7; z++) {
        if (x > -10 && x < 9 && z > -8 && z < 7) continue
        if (z == 7 && x >= -2 && x <= 1 && y < 8) continue
        v.set(key(x, y, z), stone[(x + y + z) & 1])
      }
    }
  }
  for (let l = 0; l <= 8; l++) {
    box(v, [-11, 12 + l, -9 + l], [10, 12 + l, -9 + l], 0x6a6258)
    box(v, [-11, 12 + l, 8 - l], [10, 12 + l, 8 - l], 0x6a6258)
    for (let x of [-10, 9]) {
      box(v, [x, 12 + l, -8 + l], [x, 12 + l, 7 - l], stone[0])
    }
  }
  box(v, [5, 12, -3], [7, 26, -1], 0x8a847a)
  box(v, [-8, 0, 9], [7, 1, 14], 0x8a847a)
  box(v, [-7, 1, 10], [6, 1, 13], 0xdce8ea)
  for (let x of [-9, -7]) box(v, [x, 0, 8], [x, 10, 8], TIMBER)
  return { vox: v, size: 0.25 }
}

// Wrack: weed the tide threw up, lying in a line.
let wrack = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let weed = [0x4a5a2a, 0x5a4a28, 0x3a4a24]
  for (let x = -5; x <= 5; x++) {
    let z = Math.round(Math.sin(x * 0.6 + seed) * 1.5)
    v.set(key(x, 0, z), pickOf(r, weed))
    if (r() < 0.4) v.set(key(x, 0, z + 1), pickOf(r, weed))
  }
  return { vox: v, size: 0.125 }
}

// A shell on the sand, curled: pink, or pearl, or amber.
let shell = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let [a, b] = pickOf(r, [
    [0xf2b8b0, 0xfbe4dc],
    [0xf4ece0, 0xe0d4c4],
    [0xe8a86a, 0xf6d4a8],
  ])
  for (let i = 0; i < 9; i++) {
    let t = i * 0.8, rad = i * 0.3
    v.set(
      key(
        Math.round(Math.cos(t) * rad),
        i < 3 ? 1 : 0,
        Math.round(Math.sin(t) * rad),
      ),
      i & 1 ? a : b,
    )
  }
  return { vox: v, size: 0.125 }
}

// Sea pinks: a cushion of turf and pink heads on stalks.
let thrift = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  ball(
    v,
    [0, 0, 0],
    2.3,
    (x, y, z) => y < 0 || y > 1 ? null : (x + z) & 1 ? 0x5a8a4a : 0x4f7e42,
  )
  let pink = pickOf(r, [0xf08ab0, 0xe86a9a, 0xf6b0c8])
  for (let i = 0; i < 3 + Math.floor(r() * 4); i++) {
    let x = Math.floor(r() * 5) - 2, z = Math.floor(r() * 5) - 2
    let tall = 3 + Math.floor(r() * 3)
    box(v, [x, 2, z], [x, tall, z], 0x6a9a50)
    box(v, [x, tall + 1, z], [x + 1, tall + 2, z + 1], pink)
  }
  return { vox: v, size: 0.125 }
}

// The great conch of Shellstrand, taller than a house: whorl on whorl in
// bands of pink, knobbed at each shoulder, its pearl mouth to the south.
let conch = (): Model => {
  let v: Vox = new Map()
  let pinks = [0xf4c4b4, 0xfbe0d4, 0xe8a894]
  for (let i = 0; i < 48; i++) {
    let t = i * 0.5, rad = 7.5 * (1 - i / 48) ** 1.4 + 0.6
    let [cx, cz] = [Math.cos(t) * rad * 0.35, Math.sin(t) * rad * 0.35]
    let c: [number, number, number] = [
      Math.round(cx),
      Math.round(rad * 0.6 + i * 0.5),
      Math.round(cz),
    ]
    ball(
      v,
      c,
      rad,
      (_, y) => y < 0 ? null : pinks[(Math.floor(y / 2) + (i >> 3)) % 3],
    )
    if (i % 4 == 0 && i < 40) {
      let [kx, kz] = [
        Math.round(Math.cos(t) * rad * 1.2),
        Math.round(Math.sin(t) * rad * 1.2),
      ]
      ball(v, [kx, c[1] + 1, kz], 1.5, () => 0xe8a894)
    }
  }
  for (let k of [...v.keys()]) {
    let [x, y, z] = unkey(k)
    if (z >= 5 && y >= 2 && y <= 11 && Math.abs(x) <= 3) v.set(k, 0xfff2ea)
  }
  return { vox: v, size: 0.25 }
}

// A tree the wind off the sea has bent and combed flat, streaming east.
let windtree = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 12 + Math.floor(r() * 6)
  let lean = 0
  for (let y = 0; y <= tall; y++) {
    lean = Math.round((y / tall) ** 1.5 * tall * 0.6)
    box(v, [lean, y, 0], [lean + 1, y, 1], y % 4 == 0 ? 0x4a3a2e : 0x5a4a3a)
  }
  let greens = [0x3a5f36, 0x46703e, 0x527c46]
  for (let x = -3; x <= 12; x++) {
    for (let z = -4; z <= 5; z++) {
      let along = (x + 3) / 15
      if (Math.abs(z - 0.5) > 4.5 * (1 - along * 0.6)) continue
      if (noise(x * 0.5, z * 0.5, seed) < 0.25) continue
      let thick = Math.round(3 * (1 - along)) + 1
      for (let y = 0; y < thick; y++) {
        v.set(
          key(lean + x, tall - 1 + y - Math.floor(along * 3), z),
          greens[y == thick - 1 ? 2 : (x + z) & 1],
        )
      }
    }
  }
  return { vox: v, size: 0.25 }
}

// The lighthouse on Stormhead: a round tower in bands of red and white, a
// gallery, the lantern room, and a red cap.
let lighthouse = (): Model => {
  let v: Vox = new Map()
  let ring = (y: number, out: number, thick: number, c: number) => {
    for (let x = -8; x <= 8; x++) {
      for (let z = -8; z <= 8; z++) {
        let d = Math.hypot(x + 0.5, z + 0.5)
        if (d < out && d > out - thick) v.set(key(x, y, z), c)
      }
    }
  }
  for (let y = 0; y < 44; y++) {
    let c = y < 3 ? 0x8a867c : Math.floor((y - 3) / 7) & 1 ? 0xc8403a : 0xf4f0e8
    ring(y, 6.2 - y * 0.04, 1.6, c)
  }
  box(v, [-1, 0, 5], [0, 6, 5], 0x4a3a2c)
  for (let y of [18, 30]) box(v, [-1, y, 4], [0, y + 2, 4], 0x2a3440)
  ring(44, 6.6, 7, 0x3a3a3a)
  for (let x = -6; x <= 5; x++) {
    for (let z = -6; z <= 5; z++) {
      let d = Math.hypot(x + 0.5, z + 0.5)
      if (d < 6.6 && d > 5.6 && (x + z) & 1) v.set(key(x, 45, z), 0x2a2a2a)
    }
  }
  box(v, [-3, 45, -3], [2, 49, 2], 0xffe08a)
  for (let [x, z] of [[-3, -3], [2, -3], [-3, 2], [2, 2]]) {
    box(v, [x, 45, z], [x, 49, z], 0x2a2a2a)
  }
  for (let l = 0; l < 4; l++) {
    box(v, [-4 + l, 50 + l, -4 + l], [3 - l, 50 + l, 3 - l], 0xc8403a)
  }
  return { vox: v, size: 0.25 }
}

export let COAST: Record<string, Kind> = {
  quay: { make: quay, foot: 3 },
  netrack: { make: netrack, shapes: 3, girth: 0.3, row: 2, foot: 1.5 },
  cabbage: { make: cabbage, shapes: 3, small: true },
  barley: { make: barley, shapes: 4, small: true },
  scarecrow: { make: scarecrow, girth: 0.3, foot: 1 },
  driftlog: { make: driftlog, shapes: 5, girth: 0.3, row: 1.8 },
  marram: { make: marram, shapes: 6, small: true },
  shorepine: { make: shorepine, shapes: 5, girth: 0.4 },
  wreck: { make: wreck, girth: 1.2, row: 5, foot: 7 },
  saltpile: { make: saltpile, shapes: 4, solid: true },
  saltcrust: { make: saltcrust, shapes: 4, small: true },
  chalk: {
    make: boulders([0xe4e0d4, 0xd4d0c4, 0xc8c4b8], null),
    shapes: 6,
    solid: true,
  },
  saltworks: { make: saltworks, solid: true, foot: 4, span: [5, 4] },
  wrack: { make: wrack, shapes: 5, small: true },
  shell: { make: shell, shapes: 6, small: true },
  thrift: { make: thrift, shapes: 5, small: true },
  conch: { make: conch, solid: true, foot: 3 },
  windtree: { make: windtree, shapes: 5, girth: 0.4 },
  lighthouse: {
    make: lighthouse,
    solid: true,
    foot: 3,
    span: [3.2, 3.2],
    glow: { at: [0, 11.9, 0], size: 8 },
  },
}
