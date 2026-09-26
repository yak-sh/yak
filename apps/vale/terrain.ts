// A level's ground: its shape, what grows where, and where things are. Pure
// numbers from rand.ts salted with the level's seed, so every page grows the
// same level and none of it is stored. What lives in the store is what moves
// or changes: players, creatures, what they carry and what they have done.
//
// Everything here is in metres. A level is SIZE metres on a side, closed in
// by mountains. Its ground is a smooth height (`rise`), which a vale rounds to
// voxels of whatever size it is grown at, so a finer voxel draws the same
// hills in smaller steps. Where things stand (trees, rocks, buildings, the
// creatures' homes) is decided on the smooth height and a half-metre grid,
// never on the voxels, so it is the same at every voxel size.
//
// A level's places (levels.ts) shape it, each by its kind (features.ts): woods
// roll, crags heap up, a lake sinks, dunes crest, a village flattens the
// ground around it and builds itself there. Each kind also says what the
// ground is topped with where it holds, and what grows and stands there.
// Paths run from the village out to every place and every portal.
import { type Feature, FEATURES, Top } from './features.ts'
import { type Level, LEVELS, type Spot } from './levels.ts'
import { bulk } from './props.ts'
import { fbm, hash, rand, smooth } from './rand.ts'

export type { Spot }

/** A level's side, in metres. */
export let SIZE = 128
/** The voxel edge a vale is grown at unless asked for another, in metres. */
export let VOXEL = 0.5
/** Ground at or under this height, in metres, is shore: sand, never dry. */
export let SHORE = 5
/** The water's surface, in metres. */
export let WATER = 4.8

// The middle of a level, in metres.
let MID = SIZE / 2
// What stands on the ground stands on a grid this fine, in metres.
let GRID = 0.5

let dist = (x: number, z: number, [a, b]: Spot) => Math.hypot(x - a, z - b)
let snap = (x: number) => (Math.floor(x / GRID) + 0.5) * GRID

/** A prop: something standing on the ground that is part of the level's
 * shape (a tree, a rock, a flower, a house, a portal), at (x, z) metres. */
export type Prop = {
  kind: string
  x: number
  z: number
  seed: number
}

/** Something a walker cannot pass: a circle at (x, z) of radius r, in metres,
 * up to height `top`. */
export type Wall = { x: number; z: number; r: number; top: number }

export type Vale = {
  level: Level
  /** the edge of the voxels it is grown at, in metres */
  voxel: number
  /** columns along each side */
  cols: number
  /** the ground's height at each column, in voxels (index i + k × cols) */
  h: Int16Array
  top: Uint8Array
  /** how green, lush or dry each column is: a gentle colour drift */
  hue: Float32Array
  props: Prop[]
  /** the props that are built: what places build (a village, ruins, standing
   * stones), and the portals */
  built: Prop[]
  walls: Wall[]
  /** each place's middle */
  places: Record<string, Spot>
  /** the village fire, when the level has a village */
  hearth: Spot | null
  /** each portal's middle, and the level it leads to */
  portals: { x: number; z: number; to: string }[]
}

// How much room each building takes, as a radius: a portal's is the ground
// before it, where a hero steps out (play.ts `arrival`).
let FOOT: Record<string, number> = {
  fire: 1.5,
  cottage: 4.5,
  hall: 5.5,
  well: 1.2,
  board: 0.8,
  lamp: 0.3,
  portal: 3,
  pillar: 1.2,
  ruin: 2.8,
  menhir: 1,
}

// How strongly a point belongs to each of a level's kinds of place (the
// strongest of its places of that kind, and how far that one's middle is),
// and to the mountains at the rim. A level's `holder` reads every point into
// the one Hold it keeps, so growing a level makes nothing new per column.
type Hold = { rim: number; fs: Feature[]; k: Float64Array; far: Float64Array }
let holder = (lv: Level) => {
  let places = Object.values(lv.places).filter((p) => FEATURES[p.kind])
  let kinds = [...new Set(places.map((p) => p.kind))]
  let fs = kinds.map((k) => FEATURES[k])
  let at = places.map((p) => ({ i: kinds.indexOf(p.kind), at: p.at }))
  let w: Hold = {
    rim: 0,
    fs,
    k: new Float64Array(fs.length),
    far: new Float64Array(fs.length),
  }
  return (x: number, z: number): Hold => {
    w.k.fill(-1)
    for (let p of at) {
      let d = dist(x, z, p.at), k = fs[p.i].hold(d)
      if (k > w.k[p.i]) [w.k[p.i], w.far[p.i]] = [k, d]
    }
    w.rim = smooth(0.72, 0.9, Math.hypot(x - MID, z - MID) / MID)
    return w
  }
}

// Of the kinds holding a point more than `min` and less than `below` whose
// feature `has` what is asked, the strongest; -1 if none.
let lead = (
  w: Hold,
  min: number,
  has: (f: Feature) => unknown = () => true,
  below = Infinity,
) => {
  let best = -1
  for (let i = 0; i < w.fs.length; i++) {
    let k = w.k[i]
    if (k > min && k < below && (best < 0 || k > w.k[best]) && has(w.fs[i])) {
      best = i
    }
  }
  return best
}

// What the kinds holding a point cover it with, strongest first; none if
// none of them says.
let coverOf = (w: Hold, n: number) => {
  for (let i = lead(w, 0.42); i >= 0; i = lead(w, 0.42, undefined, w.k[i])) {
    let t = w.fs[i].cover?.(n, w.far[i])
    if (t != null) return t
  }
}

// Of the kinds that say `what` grows, the one holding a point strongest, and
// more than the rim does; `h` picks among what it grows.
let pickOf = (
  w: Hold,
  what: 'grows' | 'stones',
  h: number,
  rest: string,
) => {
  let i = lead(w, Math.max(0.35, w.rim), (f) => f[what])
  let xs = w.fs[i]?.[what]
  return xs ? xs[h % xs.length] : rest
}

// A sum over the kinds holding a point, each weighted by `by`.
let weigh = (w: Hold, by: (f: Feature) => number | undefined) => {
  let sum = 0
  for (let i = 0; i < w.fs.length; i++) sum += (by(w.fs[i]) ?? 0) * w.k[i]
  return sum
}

// What grows underfoot where no place says: flowers and grass on green
// ground. Nothing does on these tops unless a place asks for it.
let DECOR: [string, number][] = [
  ['flower', 0.018],
  ['tuft', 0.032],
  ['mushroom', 0.002],
]
let GREEN = new Set([Top.grass, Top.lush, Top.dry])
// The most that grows underfoot anywhere: a roll over it grows nothing.
let LUSH = Math.max(
  ...[DECOR, ...Object.values(FEATURES).map((f) => f.decor ?? [])].map((l) =>
    l.reduce((a, [, c]) => a + c, 0)
  ),
)
let BARE = new Set([
  Top.path,
  Top.stone,
  Top.snow,
  Top.sand,
  Top.ice,
  Top.ash,
  Top.ember,
  Top.clay,
])

/** A level's ground: its height at (x, z), in metres, before a vale rounds
 * it to its voxels. */
export let rise = (lv: Level) => {
  let s = lv.seed * 101
  let places = Object.values(lv.places).filter((p) => FEATURES[p.kind])
  let order = [
    ...places.filter((p) => !FEATURES[p.kind].last),
    ...places.filter((p) => FEATURES[p.kind].last),
  ]
  return (x: number, z: number): number => {
    let r = Math.hypot(x - MID, z - MID) / MID
    let h = 6.5 + (fbm(x / 22, z / 22, 1 + s) - 0.5) * 4.5
    for (let p of order) {
      h = FEATURES[p.kind].shape(h, dist(x, z, p.at), x, z, s)
    }
    h += smooth(0.78, 1.0, r) * (12 + fbm(x / 4.5, z / 4.5, 9 + s) * 9)
    return Math.max(0.5, Math.min(30, h))
  }
}

/** How steep a height is at (x, z): the most it rises or falls in a metre
 * toward any side. */
export let steep = (
  height: (x: number, z: number) => number,
  x: number,
  z: number,
): number => {
  let c = height(x, z), d = 0.5
  return Math.max(
    Math.abs(height(x + d, z) - c),
    Math.abs(height(x - d, z) - c),
    Math.abs(height(x, z + d) - c),
    Math.abs(height(x, z - d) - c),
  ) / d
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

// How far a point is from the nearest lane, wobbling as a trodden path does.
let toLane = (lanes: [Spot, Spot][], s: number, x: number, z: number) => {
  let best = Infinity
  for (let [[ax, az], [bx, bz]] of lanes) {
    let dx = bx - ax, dz = bz - az
    let t = Math.max(
      0,
      Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)),
    )
    let wob = (fbm(t * 6, ax + bx, 21 + s, 2) - 0.5) * 7 *
      Math.sin(t * Math.PI)
    let px = ax + dx * t + (-dz / Math.hypot(dx, dz)) * wob
    let pz = az + dz * t + (dx / Math.hypot(dx, dz)) * wob
    best = Math.min(best, Math.hypot(x - px, z - pz) / (0.6 + t))
  }
  return best
}

/** A level's ground, grown at a voxel edge of `voxel` metres, which must
 * divide SIZE. Deterministic, and cached: call it as often as you like. */
export let vale = (id: string, voxel = VOXEL): Vale => {
  let key = `${id}@${voxel}`
  let v = grown.get(key)
  if (!v) grown.set(key, v = build(LEVELS[id] ?? LEVELS.mossvale, voxel))
  return v
}
let grown = new Map<string, Vale>()

let build = (lv: Level, V: number): Vale => {
  let s = lv.seed * 101
  let n = Math.round(SIZE / V)
  let at = (i: number, k: number) => i + k * n
  let mid = (i: number) => (i + 0.5) * V
  let height = rise(lv)
  let paths = lanesOf(lv)
  let h = new Int16Array(n * n)
  let hue = new Float32Array(n * n)
  let lanes = new Float32Array(n * n)
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      let x = mid(i), z = mid(k)
      h[at(i, k)] = Math.round(height(x, z) / V)
      hue[at(i, k)] = fbm(x / 11, z / 11, 31 + s, 3)
      lanes[at(i, k)] = toLane(paths, s, x, z)
    }
  }
  let get = (i: number, k: number) =>
    h[at(Math.max(0, Math.min(n - 1, i)), Math.max(0, Math.min(n - 1, k)))]
  // The most a column steps up or down to a neighbour, in voxels: how steep
  // it is, in metres a metre.
  let slope = (i: number, k: number) => {
    let c = get(i, k)
    return Math.max(
      Math.abs(get(i + 1, k) - c),
      Math.abs(get(i - 1, k) - c),
      Math.abs(get(i, k + 1) - c),
      Math.abs(get(i, k - 1) - c),
    )
  }
  // What each column is topped with: snow up high, stone where it is steep,
  // sand at the water, a path where one runs, and elsewhere whatever the
  // places holding it cover it with, strongest first.
  let hold = holder(lv)
  let top = new Uint8Array(n * n)
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      let x = mid(i), z = mid(k)
      let c = h[at(i, k)] * V, w = hold(x, z)
      let most = w.fs[lead(w, 0.42)]
      top[at(i, k)] = c >= 19
        ? Top.snow
        : slope(i, k) >= 3
        ? most?.cliff ?? Top.stone
        : c <= SHORE
        ? most?.shore ?? Top.sand
        : lanes[at(i, k)] < 0.85 && w.rim < 0.4
        ? Top.path
        : coverOf(w, fbm(x / 3, z / 3, 11 + s, 2)) ??
          (w.rim > 0.45 ? Top.dry : Top.grass)
    }
  }

  // Each village paved where people gather; what each place builds round its
  // middle; and each portal.
  let villages = Object.values(lv.places).filter((p) => p.kind == 'village')
  let built: Prop[] = []
  for (let vil of villages) {
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < n; i++) {
        let x = mid(i), z = mid(k)
        let ragged = rand(Math.floor(x / GRID), Math.floor(z / GRID), 5 + s)
        if (dist(x, z, vil.at) < 4.75 + ragged * 0.75) top[at(i, k)] = Top.path
      }
    }
  }
  for (let p of Object.values(lv.places)) {
    for (let b of FEATURES[p.kind]?.builds ?? []) {
      built.push({ ...b, x: p.at[0] + b.x, z: p.at[1] + b.z })
    }
  }
  lv.portals.forEach((g, i) =>
    built.push({ kind: 'portal', x: g.at[0], z: g.at[1], seed: i })
  )

  let props: Prop[] = [...built]
  let taken = (x: number, z: number, lane: number) =>
    built.some((p) => dist(x, z, [p.x, p.z]) < FOOT[p.kind] + 1) ||
    villages.some((p) => dist(x, z, p.at) < 6) ||
    lane < 1.3

  // Trees and rocks, one chance per cell of a jittered grid, decided on the
  // smooth ground so they stand in the same places at every voxel size.
  let CELL = 3
  for (let ck = 0; ck < SIZE / CELL; ck++) {
    for (let ci = 0; ci < SIZE / CELL; ci++) {
      let x = snap(ci * CELL + rand(ci, ck, 1 + s) * (CELL - GRID))
      let z = snap(ck * CELL + rand(ci, ck, 2 + s) * (CELL - GRID))
      if (x < 1 || z < 1 || x > SIZE - 1.5 || z > SIZE - 1.5) continue
      let y = height(x, z)
      if (y <= SHORE || y >= 18 || steep(height, x, z) >= 2) continue
      if (taken(x, z, toLane(paths, s, x, z))) continue
      let w = hold(x, z)
      let tree = 0.04 + w.rim * 0.3 + weigh(w, (f) => f.trees)
      let rock = 0.03 + w.rim * 0.12 + weigh(w, (f) => f.rocks)
      let roll = rand(ci, ck, 3 + s), pick = hash(ci, ck, 6 + s)
      if (roll < tree) {
        let kind = pickOf(w, 'grows', pick, w.rim > 0.3 ? 'pine' : 'oak')
        props.push({ kind, x, z, seed: hash(ci, ck, 4 + s) })
      } else if (roll < tree + rock) {
        let kind = pickOf(w, 'stones', pick, 'rock')
        props.push({ kind, x, z, seed: hash(ci, ck, 5 + s) })
      }
    }
  }

  // Flowers, grass, reeds and the like, one chance per cell of the grid:
  // what the strongest place holding it says, or on green ground, flowers and
  // grass.
  let cells = SIZE / GRID
  for (let ck = 1; ck < cells - 1; ck++) {
    for (let ci = 1; ci < cells - 1; ci++) {
      let x = (ci + 0.5) * GRID, z = (ck + 0.5) * GRID
      let j = at(Math.floor(x / V), Math.floor(z / V))
      let t = top[j]
      if (BARE.has(t) || taken(x, z, lanes[j])) continue
      let roll = rand(ci, ck, 9 + s)
      if (roll >= LUSH) continue
      let w = hold(x, z)
      let list = w.fs[lead(w, 0.42, (f) => f.decor)]?.decor ??
        (GREEN.has(t) ? DECOR : [])
      let sum = 0
      for (let [kind, chance] of list) {
        if (roll < (sum += chance)) {
          props.push({ kind, x, z, seed: hash(ci, ck, 10 + s) })
          break
        }
      }
    }
  }

  let v: Vale = {
    level: lv,
    voxel: V,
    cols: n,
    h,
    top,
    hue,
    props,
    built,
    walls: [],
    places: Object.fromEntries(
      Object.entries(lv.places).map(([name, p]) => [name, p.at]),
    ),
    hearth: villages[0]?.at ?? null,
    portals: lv.portals.map((g) => ({ x: g.at[0], z: g.at[1], to: g.to })),
  }
  v.walls = wallsOf(v)
  return v
}

// What is solid all through, a boulder or a standing stone: as wide and as
// tall as it is drawn, so a jump can land on one low enough.
let SOLID = new Set([
  'rock',
  'sandstone',
  'cinder',
  'basalt',
  'crystal',
  'serac',
  'menhir',
  'pillar',
])
// How wide anything else that stands is at its foot, in metres, for a walker
// to bump into.
let GIRTH: Record<string, number> = {
  oak: 0.45,
  pine: 0.45,
  birch: 0.45,
  spruce: 0.45,
  palm: 0.4,
  deadtree: 0.35,
  cactus: 0.4,
  toadstool: 0.6,
  well: 1.2,
  fire: 1.2,
  board: 0.35,
  lamp: 0.35,
}

// What a walker bumps into: trunks, stones, the village's buildings, a ruin's
// walls, and a portal's two posts. A building is a row of circles along each
// wall, so its door is a gap.
let wallsOf = (v: Vale): Wall[] => {
  let walls: Wall[] = []
  for (let p of v.props) {
    let y = standAt(v, p)
    if (SOLID.has(p.kind)) {
      let { r, tall } = bulk(p.kind, p.seed)
      walls.push({ x: p.x, z: p.z, r, top: y + tall })
      continue
    }
    let r = GIRTH[p.kind] ?? 0
    if (r) walls.push({ x: p.x, z: p.z, r, top: y + 3 })
    if (p.kind == 'portal') {
      for (let dx of [-1.3, 1.3]) {
        walls.push({ x: p.x + dx, z: p.z, r: 0.4, top: y + 4 })
      }
    }
    if (p.kind == 'ruin') {
      for (let dx = -1.2; dx <= 1.2; dx += 0.6) {
        walls.push({ x: p.x + dx, z: p.z, r: 0.4, top: y + 3 })
      }
    }
    if (SHELL[p.kind]) {
      for (let [x, z] of footprint(p)) {
        walls.push({ x, z, r: 0.45, top: y + 5 })
      }
    }
  }
  return walls
}

/** A level of flat ground `high` metres up, holding nothing but `walls` and
 * `props`: somewhere to try a rule with nothing else in the way. */
export let flat = (
  high: number,
  walls: Wall[] = [],
  props: Prop[] = [],
  voxel = VOXEL,
): Vale => {
  let n = Math.round(SIZE / voxel)
  return {
    level: LEVELS.mossvale,
    voxel,
    cols: n,
    h: new Int16Array(n * n).fill(Math.round(high / voxel)),
    top: new Uint8Array(n * n),
    hue: new Float32Array(n * n),
    props,
    built: props,
    walls,
    places: {},
    hearth: null,
    portals: [],
  }
}

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
  let out: Spot[] = []
  for (let t = -w / 2; t <= w / 2; t += 0.6) {
    out.push([p.x + t, p.z - d / 2])
    if (Math.abs(t) > 0.8) out.push([p.x + t, p.z + d / 2])
  }
  for (let t = -d / 2; t <= d / 2; t += 0.6) {
    out.push([p.x - w / 2, p.z + t], [p.x + w / 2, p.z + t])
  }
  return out
}

/** A structure's foundation: stone from the lowest ground under it up to the
 * ground it stands on, as `[min, size]` in metres; `null` for a prop that is
 * not a structure, or where the ground under it is level.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let v = flat(5)
 * let well = { kind: 'well', x: 50.25, z: 50.25, seed: 0 }
 * assertEquals(foundation(v, well), null)
 * v.h[99 + 100 * v.cols] = 7 // the ground falls away on its west side
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
  let base = groundAt(v, p.x, p.z)
  let low = base
  let step = v.voxel / 2
  for (let x = p.x - w / 2; x <= p.x + w / 2 + 1e-6; x += step) {
    for (let z = p.z - d / 2; z <= p.z + d / 2 + 1e-6; z += step) {
      low = Math.min(low, groundAt(v, x, z))
    }
  }
  if (low >= base) return null
  return [[p.x - w / 2, low, p.z - d / 2], [w, base - low - 0.02, d]]
}

/** The ground's height in metres under (x, z). */
export let groundAt = (v: Vale, x: number, z: number): number => {
  let i = Math.floor(x / v.voxel), k = Math.floor(z / v.voxel)
  if (i < 0 || k < 0 || i >= v.cols || k >= v.cols) return 30
  return v.h[i + k * v.cols] * v.voxel
}

/** Where a prop stands, in metres: a structure on the ground at its middle
 * (a foundation fills below), anything else on the lowest ground in its cell
 * of the grid, so a trunk never hangs over a step. */
export let standAt = (v: Vale, p: Prop): number => {
  if (SPAN[p.kind]) return groundAt(v, p.x, p.z)
  let r = GRID / 2 - 1e-6
  return Math.min(
    groundAt(v, p.x - r, p.z - r),
    groundAt(v, p.x + r, p.z - r),
    groundAt(v, p.x - r, p.z + r),
    groundAt(v, p.x + r, p.z + r),
  )
}

/** Whether a point, in metres, is under the ground or inside a building:
 * somewhere the camera must not look out from.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * // Flat ground 5 m up, under a hall.
 * let hall = { kind: 'hall', x: 30, z: 30, seed: 0 }
 * let v = flat(5, [], [hall])
 * assertEquals(inside(v, 10, 4, 10), true) // underground
 * assertEquals(inside(v, 30, 7, 30), true) // in the hall
 * assertEquals(inside(v, 30, 13, 30), false) // above its roof
 * ```
 */
export let inside = (v: Vale, x: number, y: number, z: number): boolean => {
  if (y < groundAt(v, x, z) + 0.3) return true
  for (let p of v.built) {
    let shell = SHELL[p.kind]
    if (!shell) continue
    let [w, d, h] = shell
    if (
      Math.abs(x - p.x) < w / 2 + 0.5 && Math.abs(z - p.z) < d / 2 + 0.8 &&
      y < groundAt(v, p.x, p.z) + h
    ) return true
  }
  return false
}
