// What furnishes a building (buildings/kit.ts `Piece`), each a little voxel
// model a quarter of a metre to the voxel: its front to the south (+z), its
// middle over the origin, standing on the floor at y 0. A piece meant for a
// wall has its back at its lowest z. Where it is used is a voxel two out from
// it, where a walker has room to stand. A light's `at` is the middle of what
// glows, in voxels (a voxel's own middle is at its x and z, half a voxel up),
// and its lantern is a box `size` × 0.175 m across round that, so a lamp's is
// a shell just over its one voxel. Wood is the dress's timber, stone its
// stone; iron, water, coals and cloth are what they are everywhere, and iron,
// steel and brass shine (mesh.ts `metal`).
import { box, key, metal, type Vox } from '../mesh.ts'
import { paint, type Piece, shade } from './kit.ts'

let IRON = metal(0x3e3e46)
let STEEL = metal(0x9aa2aa)
let SOOT = 0x2a2624
let COAL = 0x2a2220
let EMBER = [0xff7a2a, 0xffc050, 0xff9a3a]
let WATER = 0x3d6f8f
let LEATHER = 0x7a4a2a
let BRASS = metal(0xd8b04a)
let LAMP = 0xffd37a

let vox = (): Vox => new Map()
let set = (v: Vox, x: number, y: number, z: number, c: number) =>
  v.set(key(x, y, z), c)

/** The smith's forge: a stone hearth with a bed of glowing coals, a sooty
 * hood over it up to the ceiling, bellows at its side and tongs on its rim.
 * The hearth is six voxels wide (x −4 to 1), for the chimney it stands
 * under. */
export let forge: Piece = {
  name: 'forge',
  station: 'forge',
  use: { at: [-1, 3], for: 'work' },
  glow: { at: [-1.5, 2.5, -0.5], size: 2.4, color: 0xff7a2a },
  make: (d, s) => {
    let v = vox()
    for (let x = -4; x <= 1; x++) {
      for (let z = -2; z <= 1; z++) {
        for (let y = 0; y <= 2; y++) set(v, x, y, z, paint(d.stone, x, y, z, s))
      }
    }
    for (let x = -3; x <= 0; x++) {
      for (let z = -1; z <= 0; z++) {
        set(v, x, 2, z, (x + z) & 1 ? COAL : EMBER[(x + z + 30) % 3])
      }
    }
    box(v, [-4, 3, 1], [-2, 3, 1], IRON)
    // The hood, stepping in as it rises to the chimney.
    let hood = [[-4, 1, -2, 0], [-4, 1, -2, -1], [-3, 0, -2, -1], [
      -3,
      0,
      -2,
      -2,
    ], [-3, 0, -2, -2]]
    hood.forEach(([a, b, c, e], i) =>
      box(v, [a, 6 + i, c], [b, 6 + i, e], i ? SOOT : IRON)
    )
    // Bellows on a stand, their handle raised.
    box(v, [2, 0, -2], [3, 1, -1], d.timber)
    box(v, [2, 2, -2], [3, 2, 0], LEATHER)
    set(v, 3, 3, 0, d.timber)
    set(v, 3, 3, 1, d.timber)
    return v
  },
}

/** An anvil on a stump, its horn to the west, a hammer laid on it. */
export let anvil: Piece = {
  name: 'anvil',
  use: { at: [0, 2], for: 'work' },
  make: (d) => {
    let v = vox()
    box(v, [-1, 0, -1], [0, 0, 0], shade(d.timber, 0.85))
    box(v, [-1, 1, -1], [0, 1, 0], IRON)
    box(v, [-2, 2, -1], [1, 2, 0], 0x4a4a54)
    set(v, -3, 2, -1, 0x4a4a54)
    set(v, -3, 2, 0, 0x4a4a54)
    box(v, [0, 3, -1], [1, 3, -1], IRON)
    box(v, [-2, 3, -1], [-1, 3, -1], d.timber)
    return v
  },
}

/** A tub of water to quench hot iron in, hooped, a pair of tongs in it. */
export let quench: Piece = {
  name: 'quench tub',
  make: (d) => {
    let v = vox()
    box(v, [-2, 0, -2], [1, 0, 1], d.timber)
    for (let y = 1; y <= 2; y++) {
      for (let x = -2; x <= 1; x++) {
        for (let z = -2; z <= 1; z++) {
          let rim = x == -2 || x == 1 || z == -2 || z == 1
          if (rim) set(v, x, y, z, y == 1 ? shade(d.timber, 0.7) : d.timber)
          else if (y == 1) set(v, x, y, z, WATER)
        }
      }
    }
    set(v, 1, 3, -2, IRON)
    set(v, 0, 2, -1, IRON)
    return v
  },
}

/** Tools hung on a board on the wall: tongs, hammers, files, a horseshoe. */
export let toolrack: Piece = {
  name: 'tool rack',
  make: (d) => {
    let v = vox()
    box(v, [-3, 4, 0], [2, 7, 0], shade(d.timber, 1.1))
    box(v, [-3, 7, 1], [2, 7, 1], d.timber)
    box(v, [-3, 4, 1], [-3, 6, 1], IRON)
    box(v, [-1, 4, 1], [-1, 5, 1], d.timber)
    box(v, [-2, 6, 1], [-1, 6, 1], IRON)
    box(v, [0, 5, 1], [0, 6, 1], STEEL)
    set(v, 2, 5, 1, IRON)
    set(v, 2, 6, 1, IRON)
    return v
  },
}

/** A rack of what the smith has made: two swords and an axe standing in a
 * trough, against a rail. */
export let weapons: Piece = {
  name: 'weapon rack',
  make: (d) => {
    let v = vox()
    box(v, [-3, 0, 0], [3, 0, 1], d.timber)
    box(v, [-3, 1, 0], [-3, 5, 0], d.timber)
    box(v, [3, 1, 0], [3, 5, 0], d.timber)
    box(v, [-3, 5, 0], [3, 5, 0], shade(d.timber, 1.15))
    for (let x of [-2, 0]) {
      box(v, [x, 1, 1], [x, 4, 1], STEEL)
      set(v, x, 5, 1, BRASS)
      set(v, x, 6, 1, LEATHER)
    }
    box(v, [2, 1, 1], [2, 5, 1], d.timber)
    box(v, [1, 4, 1], [1, 5, 1], STEEL)
    return v
  },
}

/** The smith's bench: a thick top on legs, a vice at one end, bars of iron
 * and a hammer on it. */
export let smithbench: Piece = {
  name: 'bench',
  use: { at: [0, 3], for: 'work' },
  make: (d) => {
    let v = vox()
    for (let x of [-3, 2]) {
      for (let z of [0, 1]) box(v, [x, 0, z], [x, 1, z], d.timber)
    }
    box(v, [-3, 2, 0], [2, 2, 1], shade(d.timber, 1.15))
    box(v, [2, 3, 1], [2, 3, 1], IRON)
    set(v, 2, 2, 2, IRON)
    box(v, [-1, 3, 0], [0, 3, 0], 0x8a8a92)
    set(v, -2, 3, 1, d.timber)
    set(v, -3, 3, 1, IRON)
    return v
  },
}

/** A chest, banded in iron, with a brass lock. */
export let chest: Piece = {
  name: 'chest',
  make: (d) => {
    let v = vox()
    box(v, [-2, 0, -1], [1, 0, 0], d.timber)
    box(v, [-2, 1, -1], [1, 1, 0], shade(d.timber, 1.2))
    for (let x of [-2, 1]) box(v, [x, 0, -1], [x, 1, 0], IRON)
    set(v, -1, 1, 0, BRASS)
    return v
  },
}

/** A barrel, hooped top and bottom. */
export let barrel: Piece = {
  name: 'barrel',
  make: (d) => {
    let v = vox()
    for (let y = 0; y <= 2; y++) {
      box(v, [-1, y, -1], [0, y, 0], y == 1 ? d.timber : shade(d.timber, 0.7))
    }
    return v
  },
}

/** A bin of coal. */
export let coal: Piece = {
  name: 'coal bin',
  make: (d) => {
    let v = vox()
    box(v, [-2, 0, -1], [1, 0, 0], d.timber)
    for (let x = -2; x <= 1; x++) set(v, x, 1, -1, d.timber)
    box(v, [-1, 1, 0], [0, 1, 0], COAL)
    return v
  },
}

/** A wall lantern on an iron bracket. */
export let lamp: Piece = {
  name: 'lamp',
  glow: { at: [0, 6.5, 1], size: 1.6 },
  make: () => {
    let v = vox()
    set(v, 0, 7, 0, IRON)
    set(v, 0, 7, 1, IRON)
    set(v, 0, 6, 1, LAMP)
    return v
  },
}

/** A bed: a headboard to the wall, a wool blanket, a pillow. */
export let bed: Piece = {
  name: 'bed',
  use: { at: [3, 0], for: 'sleep' },
  make: (d) => {
    let v = vox()
    box(v, [-2, 0, -4], [1, 3, -4], d.timber)
    box(v, [-2, 0, -3], [1, 0, 3], shade(d.timber, 0.9))
    box(v, [-2, 1, -3], [1, 1, 3], 0xa8483a)
    box(v, [-2, 1, 3], [1, 1, 3], 0x8a3a30)
    box(v, [-1, 2, -3], [0, 2, -3], 0xf0ece0)
    return v
  },
}

/** A table, and a candle on it. */
export let table: Piece = {
  name: 'table',
  make: (d) => {
    let v = vox()
    for (let x of [-2, 2]) {
      for (let z of [-1, 1]) box(v, [x, 0, z], [x, 1, z], d.timber)
    }
    box(v, [-2, 2, -1], [2, 2, 1], shade(d.timber, 1.15))
    set(v, 0, 3, 0, 0xf0e6c8)
    set(v, 1, 3, 0, 0x8a8a92)
    return v
  },
}

/** A stool. */
export let stool: Piece = {
  name: 'stool',
  use: { at: [0, 2], for: 'sit' },
  make: (d) => box(vox(), [0, 0, 0], [0, 1, 0], d.timber),
}

/** A rug laid into the floor, bordered. */
export let rug: Piece = {
  name: 'rug',
  make: () => {
    let v = vox()
    for (let x = -3; x <= 2; x++) {
      for (let z = -2; z <= 1; z++) {
        let edge = x == -3 || x == 2 || z == -2 || z == 1
        set(v, x, -1, z, edge ? 0xc89a3a : (x + z) & 1 ? 0xa8483a : 0x8a3a30)
      }
    }
    return v
  },
}

/** Shelves on the wall, with pots and jars on them. */
export let shelf: Piece = {
  name: 'shelf',
  make: (d) => {
    let v = vox()
    for (let y of [5, 7]) box(v, [-2, y, 0], [1, y, 1], d.timber)
    let pots = [0xb86a3a, 0x5a7a8a, 0xe8dcc0, 0x6a8a4a]
    pots.forEach((c, i) => set(v, -2 + i, 6 + (i & 1) * 2, 1, c))
    return v
  },
}

/** A pile of split logs, their ends out. */
export let woodpile: Piece = {
  name: 'woodpile',
  make: () => {
    let v = vox()
    for (let x = -3; x <= 2; x++) {
      for (let y = 0; y <= 2 - (x == -3 || x == 2 ? 1 : 0); y++) {
        set(v, x, y, 0, (x + y) & 1 ? 0xc8a070 : 0xb08858)
        set(v, x, y, -1, 0x6a4a31)
      }
    }
    return v
  },
}

/** A grindstone on its frame, a crank at its side. */
export let grindstone: Piece = {
  name: 'grindstone',
  make: (d) => {
    let v = vox()
    box(v, [-2, 0, 0], [-2, 1, 0], d.timber)
    box(v, [1, 0, 0], [1, 1, 0], d.timber)
    for (let [x, y] of [[-1, 1], [0, 1], [-1, 2], [0, 2], [-1, 3], [0, 3]]) {
      set(v, x, y, 0, (x + y) & 1 ? 0xb8b4a8 : 0xa8a498)
    }
    set(v, 1, 2, 0, IRON)
    set(v, 2, 2, 0, d.timber)
    return v
  },
}
