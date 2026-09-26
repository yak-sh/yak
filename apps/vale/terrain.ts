// A level's ground: its shape, what grows where, and where things are. Pure
// numbers from rand.ts salted with the level's seed, so every page grows the
// same level and none of it is stored. What lives in the store is what moves
// or changes: players, creatures, what they carry and what they have done.
//
// The ground is a heightfield of N × N columns, each V metres square and a
// whole number of voxels tall, closed in by mountains. A level's places
// (levels.ts) shape it, each by its kind (`FEATURES`): woods roll, crags heap
// up, a ridge stands, a lake sinks, a village flattens the ground around it
// and builds itself there. Paths run from the village out to every place and
// every portal.
import { type Level, LEVELS, type Spot } from './levels.ts'
import { fbm, hash, lerp, rand, smooth } from './rand.ts'

export type { Spot }

/** Columns along each side. */
export let N = 256
/** A voxel's edge, in metres. */
export let V = 0.5
/** The water line, in voxels. */
export let SEA = 9

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

/** A kind of place: how it shapes the ground `d` columns from its middle
 * (`s` salts its noise), and how strongly a column there is its own, which
 * decides what the ground is topped with and what grows (`build`). A village
 * shapes last, flattening what the others raised. */
export type Feature = {
  shape: (h: number, d: number, i: number, k: number, s: number) => number
  hold: (d: number) => number
  last?: boolean
}

export let FEATURES: Record<string, Feature> = {
  crags: {
    shape: (h, d, i, k, s) =>
      h + bump(d, 50) * (3 + fbm(i / 13, k / 13, 3 + s) * 24),
    hold: (d) => bump(d, 46),
  },
  ridge: {
    shape: (h, d) => h + smooth(36, 20, d) * 12,
    hold: (d) => bump(d, 30),
  },
  woods: {
    shape: (h, d, i, k, s) =>
      h + bump(d, 56) * (fbm(i / 16, k / 16, 7 + s) - 0.35) * 7,
    hold: (d) => bump(d, 52),
  },
  lake: { shape: (h, d) => h - bump(d, 25) * 12, hold: (d) => bump(d, 30) },
  fields: { shape: (h) => h, hold: () => 0 },
  village: {
    shape: (h, d) => lerp(h, 13, smooth(28, 15, d)),
    hold: (d) => bump(d, 26),
    last: true,
  },
}

/** A prop: something standing on the ground that is part of the level's
 * shape — a tree, a rock, a flower, a house, a portal. */
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
  level: Level
  /** the ground's height at each column, in voxels (index i + k × N) */
  h: Int16Array
  top: Uint8Array
  /** how green, lush or dry each column is: a gentle colour drift */
  hue: Float32Array
  props: Prop[]
  /** the props that are built: every village's buildings, and the portals */
  built: Prop[]
  walls: Wall[]
  /** each place's middle, in metres */
  places: Record<string, Spot>
  /** the village fire, in metres, when the level has a village */
  hearth: Spot | null
  /** each portal's middle, in metres, and the level it leads to */
  portals: { x: number; z: number; to: string }[]
}

let at = (i: number, k: number) => i + k * N

/** A village's buildings, by where each stands from the village's middle. */
export let VILLAGE: Prop[] = [
  { kind: 'fire', i: 0, k: 0, seed: 1 },
  { kind: 'cottage', i: -16, k: -16, seed: 11 },
  { kind: 'cottage', i: 18, k: -18, seed: 12 },
  { kind: 'hall', i: 18, k: 19, seed: 13 },
  { kind: 'cottage', i: -18, k: 18, seed: 14 },
  { kind: 'well', i: 8, k: -4, seed: 2 },
  { kind: 'board', i: -7, k: 5, seed: 3 },
  { kind: 'lamp', i: -8, k: -8, seed: 4 },
  { kind: 'lamp', i: 9, k: 9, seed: 5 },
  { kind: 'lamp', i: -10, k: 11, seed: 6 },
  { kind: 'lamp', i: 11, k: -10, seed: 7 },
]

// How much room each building takes, in columns, as a radius.
let FOOT: Record<string, number> = {
  fire: 3,
  cottage: 9,
  hall: 11,
  well: 2.4,
  board: 1.6,
  lamp: 0.6,
  portal: 3,
}

// How strongly a column belongs to each kind of place: the strongest of the
// level's places of that kind, and the mountains at the rim.
type Hold = { rim: number; kinds: Record<string, number> }
let holds = (lv: Level, i: number, k: number): Hold => {
  let kinds: Record<string, number> = {}
  for (let p of Object.values(lv.places)) {
    let f = FEATURES[p.kind]
    if (f) {
      kinds[p.kind] = Math.max(kinds[p.kind] ?? 0, f.hold(dist(i, k, p.at)))
    }
  }
  return {
    rim: smooth(0.72, 0.9, Math.hypot(i - 128, k - 128) / 128),
    kinds,
  }
}
let of = (w: Hold, kind: string) => w.kinds[kind] ?? 0

// The ground's height at a column, before rounding to whole voxels.
let rise = (lv: Level, i: number, k: number) => {
  let s = lv.seed * 101
  let r = Math.hypot(i - 128, k - 128) / 128
  let h = 13 + (fbm(i / 44, k / 44, 1 + s) - 0.5) * 9
  let places = Object.values(lv.places).filter((p) => FEATURES[p.kind])
  for (let last of [false, true]) {
    for (let p of places) {
      let f = FEATURES[p.kind]
      if (!!f.last == last) h = f.shape(h, dist(i, k, p.at), i, k, s)
    }
  }
  h += smooth(0.78, 1.0, r) * (24 + fbm(i / 9, k / 9, 9 + s) * 18)
  return Math.max(1, Math.min(60, h))
}

// The lanes that run from the village out to each place and portal.
let lanesOf = (lv: Level): [Spot, Spot][] => {
  let home = Object.values(lv.places).find((p) => p.kind == 'village')
  if (!home) return []
  return [
    ...Object.values(lv.places).filter((p) => p != home).map((p) => p.at),
    ...lv.portals.map((g) => g.at),
  ].map((end): [Spot, Spot] => [home.at, end])
}

// How far a column is from the nearest lane, wobbling as a trodden path does.
let toLane = (lanes: [Spot, Spot][], s: number, i: number, k: number) => {
  let best = Infinity
  for (let [[ax, az], [bx, bz]] of lanes) {
    let dx = bx - ax, dz = bz - az
    let t = Math.max(
      0,
      Math.min(1, ((i - ax) * dx + (k - az) * dz) / (dx * dx + dz * dz)),
    )
    let wob = (fbm(t * 6, ax + bx, 21 + s, 2) - 0.5) * 14 *
      Math.sin(t * Math.PI)
    let px = ax + dx * t + (-dz / Math.hypot(dx, dz)) * wob
    let pz = az + dz * t + (dx / Math.hypot(dx, dz)) * wob
    best = Math.min(best, Math.hypot(i - px, k - pz) / (0.6 + t))
  }
  return best
}

// A tree's kind by where it grows.
let treeOf = (w: Hold, r: number) =>
  of(w, 'crags') > 0.4 || w.rim > 0.3
    ? 'pine'
    : of(w, 'lake') > 0.3 && r < 0.5
    ? 'birch'
    : 'oak'

/** A level's ground. Deterministic, and cached: call it as often as you
 * like. */
export let vale = (id: string): Vale => {
  let v = grown.get(id)
  if (!v) grown.set(id, v = build(LEVELS[id] ?? LEVELS.mossvale))
  return v
}
let grown = new Map<string, Vale>()

let build = (lv: Level): Vale => {
  let s = lv.seed * 101
  let h = new Int16Array(N * N)
  let hue = new Float32Array(N * N)
  let lanes = new Float32Array(N * N)
  let paths = lanesOf(lv)
  for (let k = 0; k < N; k++) {
    for (let i = 0; i < N; i++) {
      h[at(i, k)] = Math.round(rise(lv, i, k))
      hue[at(i, k)] = fbm(i / 22, k / 22, 31 + s, 3)
      lanes[at(i, k)] = toLane(paths, s, i, k)
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
      let c = h[at(i, k)], w = holds(lv, i, k)
      let sl = slope(i, k)
      top[at(i, k)] = c >= 38
        ? Top.snow
        : sl >= 3
        ? Top.stone
        : c <= SEA + 1
        ? Top.sand
        : lanes[at(i, k)] < 1.7 && w.rim < 0.4
        ? Top.path
        : of(w, 'crags') > 0.42 && fbm(i / 6, k / 6, 11 + s, 2) > 0.62
        ? Top.stone
        : of(w, 'crags') > 0.42 || w.rim > 0.45
        ? Top.dry
        : of(w, 'woods') > 0.42
        ? Top.lush
        : Top.grass
    }
  }

  // Each village, paved where people gather, and built up around its fire;
  // and each portal.
  let villages = Object.values(lv.places).filter((p) => p.kind == 'village')
  let built: Prop[] = []
  for (let vil of villages) {
    for (let k = 0; k < N; k++) {
      for (let i = 0; i < N; i++) {
        if (dist(i, k, vil.at) < 9.5 + rand(i, k, 5 + s) * 1.5) {
          top[at(i, k)] = Top.path
        }
      }
    }
    for (let b of VILLAGE) {
      built.push({ ...b, i: vil.at[0] + b.i, k: vil.at[1] + b.k })
    }
  }
  lv.portals.forEach((g, n) =>
    built.push({ kind: 'portal', i: g.at[0], k: g.at[1], seed: n })
  )

  let props: Prop[] = [...built]
  let taken = (i: number, k: number) =>
    built.some((p) => dist(i, k, [p.i, p.k]) < FOOT[p.kind] + 2) ||
    villages.some((p) => dist(i, k, p.at) < 12) ||
    lanes[at(i, k)] < 2.6
  let dry = (i: number, k: number) => h[at(i, k)] > SEA + 1
  let level = (i: number, k: number) => slope(i, k) < 2

  // Trees and rocks, one chance per cell of a jittered grid.
  let CELL = 6
  for (let ck = 0; ck < N / CELL; ck++) {
    for (let ci = 0; ci < N / CELL; ci++) {
      let i = Math.floor(ci * CELL + rand(ci, ck, 1 + s) * (CELL - 1))
      let k = Math.floor(ck * CELL + rand(ci, ck, 2 + s) * (CELL - 1))
      if (i < 2 || k < 2 || i > N - 3 || k > N - 3) continue
      if (taken(i, k) || !dry(i, k) || !level(i, k)) continue
      let w = holds(lv, i, k), r = Math.hypot(i - 128, k - 128) / 128
      if (h[at(i, k)] >= 36) continue
      let tree = 0.04 + of(w, 'woods') * 0.75 + of(w, 'lake') * 0.2 +
        w.rim * 0.3 - of(w, 'crags') * 0.05 - of(w, 'village') * 0.3
      let rock = 0.03 + of(w, 'crags') * 0.45 + w.rim * 0.12 +
        of(w, 'ridge') * 0.2
      let roll = rand(ci, ck, 3 + s)
      if (roll < tree) {
        props.push({ kind: treeOf(w, r), i, k, seed: hash(ci, ck, 4 + s) })
      } else if (roll < tree + rock) {
        props.push({ kind: 'rock', i, k, seed: hash(ci, ck, 5 + s) })
      }
    }
  }

  // Flowers, grass and mushrooms, one chance per column.
  for (let k = 1; k < N - 1; k++) {
    for (let i = 1; i < N - 1; i++) {
      let t = top[at(i, k)]
      if (t != Top.grass && t != Top.lush && t != Top.dry) continue
      if (taken(i, k)) continue
      let roll = rand(i, k, 9 + s)
      let w = holds(lv, i, k)
      if (roll < 0.018 - of(w, 'crags') * 0.012) {
        props.push({ kind: 'flower', i, k, seed: hash(i, k, 10 + s) })
      } else if (roll < 0.05) {
        props.push({ kind: 'tuft', i, k, seed: hash(i, k, 11 + s) })
      } else if (roll < 0.052 + of(w, 'woods') * 0.01 && t == Top.lush) {
        props.push({ kind: 'mushroom', i, k, seed: hash(i, k, 12 + s) })
      }
    }
  }

  // What a walker bumps into: trunks, rocks, the village's buildings, and a
  // portal's two posts.
  let walls: Wall[] = []
  let ground = (p: Prop) => h[at(p.i, p.k)] * V
  for (let p of props) {
    let x = (p.i + 0.5) * V, z = (p.k + 0.5) * V
    let r = p.kind == 'rock'
      ? 0.7 + (p.seed % 3) * 0.3
      : p.kind == 'oak' || p.kind == 'pine' || p.kind == 'birch'
      ? 0.45
      : p.kind == 'well' || p.kind == 'fire'
      ? 1.2
      : p.kind == 'board' || p.kind == 'lamp'
      ? 0.35
      : 0
    if (r) walls.push({ x, z, r, top: ground(p) + 3 })
    if (p.kind == 'portal') {
      for (let dx of [-1.3, 1.3]) {
        walls.push({ x: x + dx, z, r: 0.4, top: ground(p) + 4 })
      }
    }
  }
  // A building is a row of circles along each wall, so its door is a gap.
  for (let p of props) {
    if (!SHELL[p.kind]) continue
    for (let [x, z] of footprint(p)) {
      walls.push({ x, z, r: 0.45, top: ground(p) + 5 })
    }
  }
  let fire = villages[0]
  return {
    level: lv,
    h,
    top,
    hue,
    props,
    built,
    walls,
    places: Object.fromEntries(
      Object.entries(lv.places).map(([name, p]) => [name, spot(p.at)]),
    ),
    hearth: fire ? spot(fire.at) : null,
    portals: lv.portals.map((g) => {
      let [x, z] = spot(g.at)
      return { x, z, to: g.to }
    }),
  }
}

/** A level of flat ground `high` voxels up, holding nothing but `walls` and
 * `props`: somewhere to try a rule with nothing else in the way. */
export let flat = (
  high: number,
  walls: Wall[] = [],
  props: Prop[] = [],
): Vale => ({
  level: LEVELS.mossvale,
  h: new Int16Array(N * N).fill(high),
  top: new Uint8Array(N * N),
  hue: new Float32Array(N * N),
  props,
  built: props,
  walls,
  places: {},
  hearth: null,
  portals: [],
})

// A building's shell in metres: its width, its depth, and how tall it stands
// to the ridge of its roof.
let SHELL: Record<string, [number, number, number]> = {
  cottage: [7, 5.5, 6],
  hall: [9, 7, 7],
}

// What each structure stands on, in metres east–west and north–south.
let SPAN: Record<string, [number, number]> = {
  cottage: [7, 5.5],
  hall: [9, 7],
  well: [2.2, 2.2],
  fire: [2.6, 2.6],
  board: [2.2, 0.5],
  portal: [3.6, 1],
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

/** A structure's foundation: stone from the lowest ground under it up to the
 * ground it stands on, as `[min, size]` in metres; `null` for a prop that is
 * not a structure, or where the ground under it is level.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let v = flat(10)
 * let well = { kind: 'well', i: 100, k: 100, seed: 0 }
 * assertEquals(foundation(v, well), null)
 * v.h[99 + 100 * N] = 7 // the ground falls away on its west side
 * assertEquals(foundation(v, well)?.[0][1], 3.5)
 * assertEquals(foundation(v, well)?.[1][1], 1.48)
 * ```
 */
export let foundation = (
  v: Vale,
  p: Prop,
): [[number, number, number], [number, number, number]] | null => {
  let span = SPAN[p.kind]
  if (!span) return null
  let [w, d] = span
  let cx = (p.i + 0.5) * V, cz = (p.k + 0.5) * V
  let base = columnAt(v, cx, cz)
  let low = base
  for (let x = cx - w / 2; x <= cx + w / 2 + 1e-6; x += V / 2) {
    for (let z = cz - d / 2; z <= cz + d / 2 + 1e-6; z += V / 2) {
      low = Math.min(low, columnAt(v, x, z))
    }
  }
  if (low >= base) return null
  return [
    [cx - w / 2, low * V, cz - d / 2],
    [w, (base - low) * V - 0.02, d],
  ]
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

/** Where a column is, in metres. */
export let spot = ([i, k]: Spot): Spot => [(i + 0.5) * V, (k + 0.5) * V]

/** The water's surface, in metres. */
export let WATER = (SEA + 0.6) * V

/** Whether a point, in metres, is under the ground or inside a building:
 * somewhere the camera must not look out from.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * // Flat ground 5 m up, under a hall.
 * let hall = { kind: 'hall', i: 60, k: 60, seed: 0 }
 * let v = flat(10, [], [hall])
 * let [x, z] = spot([hall.i, hall.k])
 * assertEquals(inside(v, 30, 4, 30), true) // underground
 * assertEquals(inside(v, x, 7, z), true) // in the hall
 * assertEquals(inside(v, x, 13, z), false) // above its roof
 * ```
 */
export let inside = (v: Vale, x: number, y: number, z: number): boolean => {
  if (y < groundAt(v, x, z) + 0.3) return true
  for (let p of v.built) {
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
