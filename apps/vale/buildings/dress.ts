// What each land builds with (buildings/kit.ts `Dress`): plaster and timber
// in Mossvale, birch at Birchmere, turf-roofed logs in Fernwood, whitewash and
// slate at Gullwick, driftwood at Driftwood Bay, quarried stone at Stonestep.
// A village names its dress (features/kit.ts), and every building in it is
// raised in that.
import { FOUND, TIMBER } from '../props/kit.ts'
import { rand } from '../rand.ts'
import { type Dress, type Paint, shade } from './kit.ts'

let mod = (n: number, m: number) => ((n % m) + m) % m

/** Floorboards a voxel wide, two metres long and staggered, in two tones. */
export let boards = (a: number, b: number): Paint => (x, _y, z, s) => {
  let run = x + z * 3
  return mod(run, 8) == 0
    ? shade(a, 0.78)
    : rand(z, Math.floor(run / 8), s) < 0.5
    ? a
    : b
}

/** Stone laid in courses, mortar every third voxel up. */
export let coursed =
  (a: number, b: number, mortar: number): Paint => (x, y, z) =>
    y % 3 == 0 ? mortar : (((x + z) >> 1) + (y >> 1)) & 1 ? a : b

/** Fieldstone: rough and uneven. */
export let fieldstone = (greys: number[]): Paint => (x, y, z, s) =>
  greys[Math.floor(rand(x * 7 + z, y, s + 3) * greys.length)]

let STONES = fieldstone([FOUND, 0x8f8d85, 0xa8a69c, 0x87857c])

export let PLASTER: Dress = {
  wall: 0xefe3c8,
  stone: STONES,
  timber: TIMBER,
  floor: boards(0xa87a4e, 0x9c7046),
  roofs: [0xc2573e, 0x4f6f9e, 0x8a5a9e, 0x5c8f55],
  door: 0x7b5334,
  trim: 0x6f8f6a,
  framed: true,
}

// Walls of birch logs, white flecked black, and roofs of moss.
export let BIRCH: Dress = {
  wall: (x, y, z, s) =>
    rand(x + z, y, s) < 0.12 ? 0x3a3a36 : y & 1 ? 0xeeeae0 : 0xe0dcd0,
  stone: STONES,
  timber: 0xb8b4a8,
  floor: boards(0xd8c8a4, 0xcdbb94),
  roofs: [0x5a7a4a, 0x4e6e42, 0x66864e],
  door: 0x8a6a4a,
  trim: 0x4e6e42,
}

// Walls of dark logs, roofs of turf.
export let TURF: Dress = {
  wall: (_x, y) => y & 1 ? 0x5a3e2a : 0x6a4a31,
  stone: fieldstone([0x7a7a6e, 0x6e7064, 0x86887a, 0x6a7a5a]),
  timber: 0x3e2a1c,
  floor: boards(0x7a5a3a, 0x6e5034),
  roofs: [0x4f7f3a, 0x5a8a42, 0x46743a],
  door: 0x4a3222,
  trim: 0x7a5a3a,
}

// Whitewashed stone, frames painted the blue of the boats, roofs of slate.
export let WHITEWASH: Dress = {
  wall: (x, y, z) => (x + y + z) % 5 ? 0xf4f2ec : 0xe6e4dc,
  stone: coursed(0xdedbd2, 0xe8e6de, 0xc8c4ba),
  timber: 0x3a5a7a,
  floor: boards(0xb89a78, 0xac8e6c),
  roofs: [0x4a5058, 0x3e444c, 0x56606a],
  door: 0x3a5a7a,
  trim: 0x3a5a7a,
}

// Grey boards the sea brought in, roofs tarred and patched.
export let DRIFT: Dress = {
  wall: (x, y, z, s) =>
    rand(x + z, (y >> 2) + s, 3) < 0.15
      ? 0x7a6a58
      : (x + z) & 1
      ? 0x9a9488
      : 0x8a847a,
  stone: fieldstone([0x8a847a, 0x7a766c, 0x969086]),
  timber: 0x6a645a,
  floor: boards(0x9a9488, 0x8a847a),
  roofs: [0x2e2c2a, 0x3a3634, 0x34302c],
  door: 0x5a544a,
  trim: 0x4a7a8a,
}

// Coursed blocks from the quarry, roofs of stone slab.
export let STONE: Dress = {
  wall: coursed(0xc8c0a8, 0xd4ccb4, 0xb8b098),
  stone: coursed(0xb0a890, 0xbcb49c, 0xa09880),
  timber: 0x6a4b33,
  floor: boards(0x9c8a6a, 0x907e60),
  roofs: [0x7a7a78, 0x8a8a86, 0x6e6e6c],
  door: 0x5a4030,
  trim: 0x8a6a4a,
}

/** Every land's dress, by the name a village gives it. */
export let DRESSES: Record<string, Dress> = {
  plaster: PLASTER,
  birch: BIRCH,
  turf: TURF,
  whitewash: WHITEWASH,
  drift: DRIFT,
  stone: STONE,
}
