// The vale itself: its shape, what grows where, and where things are. Pure
// numbers from rand.ts, so every page builds the same vale and none of it is
// stored. What lives in the store is what moves or changes: players,
// creatures, what they carry and what they have done.
//
// The ground is a heightfield of N × N columns, each V metres square and a
// whole number of voxels tall. A village sits in the middle; around it a
// meadow, Whisperwood to the north, Craghollow's rocky hills to the south-west,
// Mirror Lake to the west and Thornback Ridge to the south-east, and mountains
// close it all in.
import { fbm, hash, lerp, rand, smooth } from './rand.ts'

/** Columns along each side. */
export let N = 256
/** A voxel's edge, in metres. */
export let V = 0.5
/** The water line, in voxels. */
export let SEA = 9

export type Spot = [number, number]

/** Where each place is, in columns. */
export let PLACES: Record<
  'plaza' | 'woods' | 'crags' | 'ridge' | 'lake' | 'fields',
  Spot
> = {
  plaza: [128, 128],
  woods: [132, 50],
  crags: [60, 196],
  ridge: [204, 200],
  lake: [52, 98],
  fields: [198, 104],
}

/** What a column is topped with. */
export let Top = {
  grass: 0,
  lush: 1,
  dry: 2,
  sand: 3,
  stone: 4,
  path: 5,
  snow: 6,
}

let dist = (i: number, k: number, [x, z]: Spot) => Math.hypot(i - x, k - z)
let bump = (d: number, r: number) => Math.exp(-(d * d) / (r * r))

// How far a column is from the nearest path: the lanes that run from the plaza
// out to each place, wobbling as a trodden path does.
let LANES: [Spot, Spot][] = [
  [PLACES.plaza, PLACES.woods],
  [PLACES.plaza, PLACES.crags],
  [PLACES.plaza, PLACES.ridge],
  [PLACES.plaza, PLACES.lake],
  [PLACES.plaza, PLACES.fields],
]
let toLane = (i: number, k: number) => {
  let best = Infinity
  for (let [[ax, az], [bx, bz]] of LANES) {
    let dx = bx - ax, dz = bz - az
    let t = Math.max(
      0,
      Math.min(1, ((i - ax) * dx + (k - az) * dz) / (dx * dx + dz * dz)),
    )
    let wob = (fbm(t * 6, ax + bx, 21, 2) - 0.5) * 14 * Math.sin(t * Math.PI)
    let px = ax + dx * t + (-dz / Math.hypot(dx, dz)) * wob
    let pz = az + dz * t + (dx / Math.hypot(dx, dz)) * wob
    best = Math.min(best, Math.hypot(i - px, k - pz) / (0.6 + t))
  }
  return best
}

// The ground's height at a column, before rounding to whole voxels.
let rise = (i: number, k: number) => {
  let r = Math.hypot(i - 128, k - 128) / 128
  let h = 13 + (fbm(i / 44, k / 44, 1) - 0.5) * 9
  h += bump(dist(i, k, PLACES.crags), 50) * (3 + fbm(i / 13, k / 13, 3) * 24)
  h += smooth(36, 20, dist(i, k, PLACES.ridge)) * 12
  h += bump(dist(i, k, PLACES.woods), 56) * (fbm(i / 16, k / 16, 7) - 0.35) * 7
  h -= bump(dist(i, k, PLACES.lake), 25) * 12
  h = lerp(h, 13, smooth(28, 15, dist(i, k, PLACES.plaza)))
  h += smooth(0.78, 1.0, r) * (24 + fbm(i / 9, k / 9, 9) * 18)
  return Math.max(1, Math.min(60, h))
}

/** A prop: something standing on the ground that is part of the vale's
 * shape — a tree, a rock, a flower, a house. */
export type Prop = {
  kind: string
  i: number
  k: number
  seed: number
}

/** Something a walker cannot pass: a circle at (x, z) of radius r, in metres,
 * up to height `top`. */
export type Wall = { x: number; z: number; r: number; top: number }

export type Vale = {
  /** the ground's height at each column, in voxels (index i + k × N) */
  h: Int16Array
  top: Uint8Array
  /** how green, lush or dry each column is: a gentle colour drift */
  hue: Float32Array
  props: Prop[]
  walls: Wall[]
}

let at = (i: number, k: number) => i + k * N

// Which place holds a column most: its weight toward each.
let weights = (i: number, k: number) => ({
  woods: bump(dist(i, k, PLACES.woods), 52),
  crags: bump(dist(i, k, PLACES.crags), 46),
  lake: bump(dist(i, k, PLACES.lake), 30),
  ridge: bump(dist(i, k, PLACES.ridge), 30),
  plaza: bump(dist(i, k, PLACES.plaza), 26),
  rim: smooth(0.72, 0.9, Math.hypot(i - 128, k - 128) / 128),
})

/** The village, placed around the plaza: each building's kind and the
 * column its middle stands on. */
export let VILLAGE: Prop[] = [
  { kind: 'fire', i: 128, k: 128, seed: 1 },
  { kind: 'cottage', i: 112, k: 112, seed: 11 },
  { kind: 'cottage', i: 146, k: 110, seed: 12 },
  { kind: 'hall', i: 146, k: 147, seed: 13 },
  { kind: 'cottage', i: 110, k: 146, seed: 14 },
  { kind: 'well', i: 136, k: 124, seed: 2 },
  { kind: 'board', i: 121, k: 133, seed: 3 },
  { kind: 'lamp', i: 120, k: 120, seed: 4 },
  { kind: 'lamp', i: 137, k: 137, seed: 5 },
  { kind: 'lamp', i: 118, k: 139, seed: 6 },
  { kind: 'lamp', i: 139, k: 118, seed: 7 },
]

// How much room each village building takes, in columns, as a radius.
let FOOT: Record<string, number> = {
  fire: 3,
  cottage: 9,
  hall: 11,
  well: 2.4,
  board: 1.6,
  lamp: 0.6,
}

// A tree's kind by where it grows.
let treeOf = (w: ReturnType<typeof weights>, r: number) =>
  w.crags > 0.4 || w.rim > 0.3
    ? 'pine'
    : w.lake > 0.3 && r < 0.5
    ? 'birch'
    : 'oak'

/** Build the vale. Deterministic, and cached: call it as often as you like. */
export let vale = (): Vale => cached ??= build()
let cached: Vale | undefined

let build = (): Vale => {
  let h = new Int16Array(N * N)
  let hue = new Float32Array(N * N)
  let lanes = new Float32Array(N * N)
  for (let k = 0; k < N; k++) {
    for (let i = 0; i < N; i++) {
      h[at(i, k)] = Math.round(rise(i, k))
      hue[at(i, k)] = fbm(i / 22, k / 22, 31, 3)
      lanes[at(i, k)] = toLane(i, k)
    }
  }
  let get = (i: number, k: number) =>
    h[at(Math.max(0, Math.min(N - 1, i)), Math.max(0, Math.min(N - 1, k)))]
  let top = new Uint8Array(N * N)
  let slope = (i: number, k: number) => {
    let c = get(i, k)
    return Math.max(
      Math.abs(get(i + 1, k) - c),
      Math.abs(get(i - 1, k) - c),
      Math.abs(get(i, k + 1) - c),
      Math.abs(get(i, k - 1) - c),
    )
  }
  for (let k = 0; k < N; k++) {
    for (let i = 0; i < N; i++) {
      let c = h[at(i, k)], w = weights(i, k)
      let s = slope(i, k)
      top[at(i, k)] = c >= 38
        ? Top.snow
        : s >= 3
        ? Top.stone
        : c <= SEA + 1
        ? Top.sand
        : lanes[at(i, k)] < 1.7 && w.rim < 0.4
        ? Top.path
        : w.crags > 0.42 && fbm(i / 6, k / 6, 11, 2) > 0.62
        ? Top.stone
        : w.crags > 0.42 || w.rim > 0.45
        ? Top.dry
        : w.woods > 0.42
        ? Top.lush
        : Top.grass
    }
  }

  // The plaza is paved where people gather.
  for (let k = 0; k < N; k++) {
    for (let i = 0; i < N; i++) {
      if (dist(i, k, PLACES.plaza) < 9.5 + rand(i, k, 5) * 1.5) {
        top[at(i, k)] = Top.path
      }
    }
  }

  let props: Prop[] = [...VILLAGE]
  let taken = (i: number, k: number) =>
    VILLAGE.some((p) => dist(i, k, [p.i, p.k]) < FOOT[p.kind] + 2) ||
    dist(i, k, PLACES.plaza) < 12 ||
    lanes[at(i, k)] < 2.6
  let dry = (i: number, k: number) => h[at(i, k)] > SEA + 1
  let flat = (i: number, k: number) => slope(i, k) < 2

  // Trees and rocks, one chance per cell of a jittered grid.
  let CELL = 6
  for (let ck = 0; ck < N / CELL; ck++) {
    for (let ci = 0; ci < N / CELL; ci++) {
      let i = Math.floor(ci * CELL + rand(ci, ck, 1) * (CELL - 1))
      let k = Math.floor(ck * CELL + rand(ci, ck, 2) * (CELL - 1))
      if (i < 2 || k < 2 || i > N - 3 || k > N - 3) continue
      if (taken(i, k) || !dry(i, k) || !flat(i, k)) continue
      let w = weights(i, k), r = Math.hypot(i - 128, k - 128) / 128
      if (h[at(i, k)] >= 36) continue
      let tree = 0.04 + w.woods * 0.75 + w.lake * 0.2 + w.rim * 0.3 -
        w.crags * 0.05 - w.plaza * 0.3
      let rock = 0.03 + w.crags * 0.45 + w.rim * 0.12 + w.ridge * 0.2
      let roll = rand(ci, ck, 3)
      if (roll < tree) {
        props.push({ kind: treeOf(w, r), i, k, seed: hash(ci, ck, 4) })
      } else if (roll < tree + rock) {
        props.push({ kind: 'rock', i, k, seed: hash(ci, ck, 5) })
      }
    }
  }

  // Flowers, grass and mushrooms, one chance per column.
  for (let k = 1; k < N - 1; k++) {
    for (let i = 1; i < N - 1; i++) {
      let t = top[at(i, k)]
      if (t != Top.grass && t != Top.lush && t != Top.dry) continue
      if (taken(i, k)) continue
      let roll = rand(i, k, 9)
      let w = weights(i, k)
      if (roll < 0.018 - w.crags * 0.012) {
        props.push({ kind: 'flower', i, k, seed: hash(i, k, 10) })
      } else if (roll < 0.05) {
        props.push({ kind: 'tuft', i, k, seed: hash(i, k, 11) })
      } else if (roll < 0.052 + w.woods * 0.01 && t == Top.lush) {
        props.push({ kind: 'mushroom', i, k, seed: hash(i, k, 12) })
      }
    }
  }

  // What a walker bumps into: trunks, rocks and the village's buildings.
  let walls: Wall[] = []
  let ground = (p: Prop) => h[at(p.i, p.k)] * V
  for (let p of props) {
    let x = (p.i + 0.5) * V, z = (p.k + 0.5) * V
    let r = p.kind == 'cottage' || p.kind == 'hall'
      ? 0
      : p.kind == 'rock'
      ? 0.7 + (p.seed % 3) * 0.3
      : p.kind == 'oak' || p.kind == 'pine' || p.kind == 'birch'
      ? 0.45
      : p.kind == 'well' || p.kind == 'fire'
      ? 1.2
      : p.kind == 'board' || p.kind == 'lamp'
      ? 0.35
      : 0
    if (r) walls.push({ x, z, r, top: ground(p) + 3 })
  }
  // A building is a row of circles along each wall, so its door is a gap.
  for (let p of props) {
    if (p.kind != 'cottage' && p.kind != 'hall') continue
    for (let [x, z] of footprint(p)) {
      walls.push({ x, z, r: 0.45, top: ground(p) + 5 })
    }
  }
  return { h, top, hue, props, walls }
}

// A building's shell in metres: its width, its depth, and how tall it stands
// to the ridge of its roof.
let SHELL: Record<string, [number, number, number]> = {
  cottage: [7, 5.5, 6],
  hall: [9, 7, 7],
}

/** The points along a building's walls a walker cannot pass, in metres: the
 * rectangle its shell stands on, less the door on its south side. */
export let footprint = (p: Prop): Spot[] => {
  let [w, d] = SHELL[p.kind] ?? SHELL.cottage
  let cx = (p.i + 0.5) * V, cz = (p.k + 0.5) * V
  let out: Spot[] = []
  for (let t = -w / 2; t <= w / 2; t += 0.6) {
    out.push([cx + t, cz - d / 2])
    if (Math.abs(t) > 0.8) out.push([cx + t, cz + d / 2])
  }
  for (let t = -d / 2; t <= d / 2; t += 0.6) {
    out.push([cx - w / 2, cz + t], [cx + w / 2, cz + t])
  }
  return out
}

/** The ground's height in voxels under the column holding (x, z) metres. */
export let columnAt = (v: Vale, x: number, z: number): number => {
  let i = Math.floor(x / V), k = Math.floor(z / V)
  if (i < 0 || k < 0 || i >= N || k >= N) return 60
  return v.h[at(i, k)]
}

/** The ground's height in metres under (x, z). */
export let groundAt = (v: Vale, x: number, z: number): number =>
  columnAt(v, x, z) * V

/** Where a place is, in metres. */
export let spot = ([i, k]: Spot): Spot => [(i + 0.5) * V, (k + 0.5) * V]

/** The water's surface, in metres. */
export let WATER = (SEA + 0.6) * V

/** Whether a point, in metres, is under the ground or inside a building:
 * somewhere the camera must not look out from.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * // Flat ground 5 m up, under the village's hall and houses.
 * let v = {
 *   h: new Int16Array(N * N).fill(10),
 *   top: new Uint8Array(N * N),
 *   hue: new Float32Array(N * N),
 *   props: VILLAGE,
 *   walls: [],
 * }
 * let hall = VILLAGE.find((p) => p.kind == 'hall')!
 * let [x, z] = spot([hall.i, hall.k])
 * assertEquals(inside(v, 30, 4, 30), true) // underground
 * assertEquals(inside(v, x, 7, z), true) // in the hall
 * assertEquals(inside(v, x, 13, z), false) // above its roof
 * ```
 */
export let inside = (v: Vale, x: number, y: number, z: number): boolean => {
  if (y < groundAt(v, x, z) + 0.3) return true
  for (let p of VILLAGE) {
    let shell = SHELL[p.kind]
    if (!shell) continue
    let [w, d, h] = shell
    let cx = (p.i + 0.5) * V, cz = (p.k + 0.5) * V
    if (
      Math.abs(x - cx) < w / 2 + 0.5 && Math.abs(z - cz) < d / 2 + 0.8 &&
      y < v.h[p.i + p.k * N] * V + h
    ) return true
  }
  return false
}
