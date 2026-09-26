// The props of the deep places: toadstools the size of trees, and crystal;
// and each level's own: Glowcap's blue caps, its houses in their stems and
// its wisplight lamps; Gleamdeep's amethyst, chips of it in the grass and the
// great geode; Shardvault's pale caps, its shards taller than trees and the
// arch of its vault.
import { ball, box, key, type Vox } from '../mesh.ts'
import { noise, rand, stream } from '../rand.ts'
import { type Kind, type Model, pickOf, TIMBER } from './kit.ts'

// A toadstool the size of a tree, its cap one of `caps`.
let toadstool = (caps: number[], stem = 0xf1eadb) => (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 10 + Math.floor(r() * 7)
  let cap = pickOf(r, caps)
  box(v, [0, 0, 0], [1, tall, 1], stem)
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

// A house in the stem of a giant toadstool: a round wall with a door and
// windows, the cap its roof, a chimney out through it.
let shroomhouse = (seed: number): Model => {
  let v: Vox = new Map()
  let cap = pickOf(stream(seed), [0x3a8ac8, 0x4aa0d8, 0x2a78b8])
  for (let y = 0; y < 14; y++) {
    for (let x = -6; x <= 6; x++) {
      for (let z = -6; z <= 6; z++) {
        let d = Math.hypot(x, z)
        if (d > 5.5 || d < 4.3) continue
        let door = z > 3 && Math.abs(x) < 2 && y < 7
        let window = y >= 5 && y <= 7 && (Math.abs(x) > 4 && Math.abs(z) < 1)
        if (door) continue
        v.set(
          key(x, y, z),
          window ? 0x8af0ff : (x + y + z) & 1 ? 0xeae2d0 : 0xdcd4c0,
        )
      }
    }
  }
  box(v, [-1, 0, 5], [0, 6, 5], 0x6a4a31)
  for (let x = -11; x <= 11; x++) {
    for (let z = -11; z <= 11; z++) {
      let e = (x * x + z * z) / 121
      if (e > 1) continue
      let high = Math.round(5 * Math.sqrt(1 - e))
      v.set(key(x, 14, z), 0xe9dcc4)
      for (let y = 1; y <= high; y++) {
        let spot = y == high && rand(x, z, seed) < 0.12
        v.set(key(x, 14 + y, z), spot ? 0xd8f8ff : cap)
      }
    }
  }
  box(v, [3, 14, -3], [4, 22, -2], 0x8a8478)
  return { vox: v, size: 0.25 }
}

// A lamp of the hollow, burning wisplight: a post, and a glass of blue-green
// fire hung from it.
let wisplamp = (): Model => {
  let v: Vox = new Map()
  box(v, [0, 0, 0], [0, 10, 0], TIMBER)
  box(v, [0, 11, 0], [1, 11, 0], TIMBER)
  box(v, [1, 9, -1], [2, 10, 0], 0x8af0ff)
  return { vox: v, size: 0.25 }
}

// A cluster of crystals, leaning out of a stone, in one of `gems`' colours.
let cluster = (gems: number[][]) => (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let [deep, pale] = pickOf(r, gems)
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

let GEMS = [
  [0x7fe3f0, 0xc2f6fb],
  [0xb58af0, 0xdcc6fb],
  [0xf08ac8, 0xfac6e4],
  [0x8af0b0, 0xc8fad8],
]
let CLEAR = [
  [0xa8dcf4, 0xe8f8ff],
  [0xcfeefb, 0xffffff],
  [0x8ac8e8, 0xd8f0fb],
]
let AMETHYST = [
  [0x8a4ac8, 0xc8a0f0],
  [0x6a3aa8, 0xb08ae0],
  [0x9a5ad8, 0xdcc0fa],
]

// Chips of amethyst in the grass.
let gemchip = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  for (let i = 0; i < 2 + Math.floor(r() * 3); i++) {
    let [x, z] = [Math.floor(r() * 5) - 2, Math.floor(r() * 5) - 2]
    let c = pickOf(r, [0x9a5ad8, 0xc8a0f0, 0x7a3ab8])
    box(v, [x, 0, z], [x, 1 + Math.floor(r() * 2), z], c)
  }
  return { vox: v, size: 0.125 }
}

// The great geode of Gleamdeep: a stone egg as tall as a house, split open,
// violet crystal thick inside it.
let geode = (): Model => {
  let v: Vox = new Map()
  ball(v, [0, 10, 0], 11, (x, y, z) => {
    if (y < 0 || z > 3 - Math.abs(x) * 0.2) return null
    let d = Math.hypot(x, y - 10, z)
    if (d < 8.5) return null
    if (d < 9.6) {
      return noise(x * 0.6, y * 0.6 + z, 5) > 0.5 ? 0xdcc0fa : 0x8a4ac8
    }
    return (x + y + z) & 1 ? 0x7a746a : 0x8a847a
  })
  return { vox: v, size: 0.4 }
}

// A shard of the vault's crystal, taller than a tree, clear and pale.
let shard = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 28 + Math.floor(r() * 20)
  let lean = r() * 0.3 - 0.15, tilt = r() * 0.3 - 0.15
  let ice = [0xcfeefb, 0xa8dcf4, 0xe8f8ff]
  for (let y = 0; y <= tall; y++) {
    let w = Math.max(0, Math.round(3 * (1 - (y / tall) ** 2.5)))
    let [cx, cz] = [Math.round(lean * y), Math.round(tilt * y)]
    for (let x = -w; x <= w; x++) {
      for (let z = -w; z <= w; z++) {
        if (Math.abs(x) + Math.abs(z) > w + 1) continue
        v.set(
          key(cx + x, y, cz + z),
          ice[(x + z + y) % 3 == 0 ? 2 : (y >> 2) & 1],
        )
      }
    }
  }
  return { vox: v, size: 0.25 }
}

// The arch of the vault: two shards leaning together over its door, and the
// door, sealed with crystal.
let vaultdoor = (): Model => {
  let v: Vox = new Map()
  let ice = [0xcfeefb, 0xa8dcf4, 0xe8f8ff]
  for (let y = 0; y <= 36; y++) {
    let t = y / 36
    for (let side of [-1, 1]) {
      let cx = Math.round(side * (10 - t * t * 9))
      let w = Math.max(1, Math.round(3 - t * 2))
      box(v, [cx - w, y, -w], [cx + w, y, w], ice[(y >> 2) & 1])
    }
  }
  box(v, [-5, 0, -1], [5, 18, 0], 0x6aa8d8)
  for (let y = 2; y < 18; y += 4) box(v, [-4, y, 1], [4, y, 1], 0xe8f8ff)
  return { vox: v, size: 0.25 }
}

export let DEEP: Record<string, Kind> = {
  toadstool: {
    make: toadstool([0xd9493a, 0x9a6ad0, 0x4fb8b0, 0xe89a3a, 0xc85a9a]),
    shapes: 6,
    girth: 0.6,
  },
  glowcap: {
    make: toadstool([0x3a8ac8, 0x4ac8e0, 0x2a6ab8, 0x6ae0d8], 0xd8f0f0),
    shapes: 6,
    girth: 0.6,
  },
  violetcap: {
    make: toadstool([0x8a5ac8, 0xa87ad8, 0x6a4aa8], 0xece0f4),
    shapes: 5,
    girth: 0.6,
  },
  palecap: {
    make: toadstool([0xdce8ee, 0xc4d8e4, 0xeef4f8], 0xf4f8fa),
    shapes: 4,
    girth: 0.6,
  },
  shroomhouse: { make: shroomhouse, shapes: 3, solid: true, foot: 3.5 },
  wisplamp: {
    make: wisplamp,
    girth: 0.35,
    foot: 0.3,
    glow: { at: [0.5, 2.5, 0], size: 3.4, color: 0x8af0ff },
  },
  crystal: { make: cluster(GEMS), shapes: 6, solid: true },
  amethyst: { make: cluster(AMETHYST), shapes: 6, solid: true },
  clearstone: { make: cluster(CLEAR), shapes: 6, solid: true },
  gemchip: { make: gemchip, shapes: 5, small: true },
  geode: { make: geode, solid: true, foot: 5 },
  shard: { make: shard, shapes: 6, girth: 0.9 },
  vaultdoor: { make: vaultdoor, girth: 0.7, row: 2.5, foot: 4 },
}
