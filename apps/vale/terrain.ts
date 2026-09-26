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
// Paths run from the village out to every place. A road runs from where a
// hero arrives out to the middle of each side that leads somewhere, on a bed
// of its own: level enough to walk, dry over water, and through the
// mountains at the rim by a pass.
import { type Feature, FEATURES, Top } from './features.ts'
import { type Level, LEVELS, type Side, type Spot } from './levels.ts'
import { bulk, KINDS } from './props.ts'
import { clamp, fbm, hash, lerp, rand, smooth } from './rand.ts'

export type { Side, Spot }

/** A level's side, in metres. */
export let SIZE = 128
/** The voxel edge a vale is grown at unless asked for another, in metres. */
export let VOXEL = 0.25
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
 * shape (a tree, a rock, a flower, a house, a signpost), at (x, z) metres. */
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
   * stones), and the signpost at the head of each road */
  built: Prop[]
  walls: Wall[]
  /** each place's middle */
  places: Record<string, Spot>
  /** the village fire, when the level has a village */
  hearth: Spot | null
  roads: Road[]
}

/** A road out of a level: the side it leaves by and the level it leads to;
 * where it meets the edge, in metres; where a hero coming in by it stands;
 * and its signpost. */
export type Road = {
  side: Side
  to: string
  x: number
  z: number
  door: Spot
  sign: Spot
}

/** Where each side's road meets the edge of a level, in metres. */
export let EDGE: Record<Side, Spot> = {
  north: [MID, 0],
  east: [SIZE, MID],
  south: [MID, SIZE],
  west: [0, MID],
}
// How far in from the edge a road runs straight; how far in along it a hero
// coming in stands, beside its signpost; in metres.
let STRAIGHT = 16
let DOOR = 9
// A road's half-width, and how far round it its bed eases into the ground,
// in metres.
let ROAD = 1.5
let EASE = 3.5
// How far from a road the mountains at the rim stand back, rising from the
// first to the second, in metres, so a road leaves by a pass.
let PASS: [number, number] = [4, 13]
// The lowest a road's bed runs, in metres: dry, a causeway over water.
let DRY = SHORE + 0.3
// How steep a road's bed may run, in metres a metre, and how far either way
// along it its bed is evened out, in metres.
let GRADE = 0.45
let EVEN = 5
// How far round where a hero comes in no tree or rock grows, in metres.
let GLADE = 9

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
  let ways = waysOf(lv)
  let land = landOf(lv)
  return (x: number, z: number): number => {
    let h = land(x, z), open = 0
    for (let { c, bed } of ways) {
      let t = along(c, x, z), d = off(c, x, z, t)
      h = lerp(h, bedAt(bed, t), 1 - smooth(ROAD, ROAD + EASE, d))
      open = Math.max(open, 1 - smooth(PASS[0], PASS[1], d))
    }
    let r = Math.hypot(x - MID, z - MID) / MID
    h += smooth(0.78, 1.0, r) * (1 - open) *
      (12 + fbm(x / 4.5, z / 4.5, 9 + s) * 9)
    return clamp(h, 0.5, 30)
  }
}

// A level's land as its places shape it, before its roads are laid and the
// mountains at its rim raised.
let landOf = (lv: Level) => {
  let s = lv.seed * 101
  let places = Object.values(lv.places).filter((p) => FEATURES[p.kind])
  let order = [
    ...places.filter((p) => !FEATURES[p.kind].last),
    ...places.filter((p) => FEATURES[p.kind].last),
  ]
  return (x: number, z: number): number => {
    let h = 6.5 + (fbm(x / 22, z / 22, 1 + s) - 0.5) * 4.5
    for (let p of order) {
      h = FEATURES[p.kind].shape(h, dist(x, z, p.at), x, z, s)
    }
    return h
  }
}

// A way from `a` to `b` that wobbles as a trodden one does, by up to `wob`
// metres, but for its last `straight` metres; its middle sampled every metre.
type Course = {
  a: Spot
  dx: number
  dz: number
  xs: Float64Array
  zs: Float64Array
}
let course = (a: Spot, b: Spot, s: number, wob = 7, straight = 0): Course => {
  let dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || 1
  let n = Math.ceil(len) + 1
  let bend = Math.max(0.01, 1 - straight / len)
  let xs = new Float64Array(n), zs = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let t = i / (n - 1)
    let w = (fbm(t * 6, a[0] + b[0], 21 + s, 2) - 0.5) * wob *
      Math.sin(Math.PI * Math.min(1, t / bend))
    xs[i] = a[0] + dx * t - (dz / len) * w
    zs[i] = a[1] + dz * t + (dx / len) * w
  }
  return { a, dx, dz, xs, zs }
}
// How far along a course (x, z) lies, from 0 at its start to 1 at its end;
// and how far it is from the course's middle there, in metres.
let along = (c: Course, x: number, z: number) =>
  clamp(
    ((x - c.a[0]) * c.dx + (z - c.a[1]) * c.dz) / (c.dx * c.dx + c.dz * c.dz),
    0,
    1,
  )
let off = (c: Course, x: number, z: number, t: number) => {
  let f = t * (c.xs.length - 1)
  let i = Math.min(c.xs.length - 2, Math.floor(f)), u = f - i
  return Math.hypot(
    x - (c.xs[i] + (c.xs[i + 1] - c.xs[i]) * u),
    z - (c.zs[i] + (c.zs[i + 1] - c.zs[i]) * u),
  )
}

// A level's roads, each a course from where a hero arrives out to the middle
// of its side, and the height of its bed every metre along it: the land
// evened out, cut down where it would climb too steeply, and never under
// water.
type Way = { side: Side; to: string; c: Course; bed: Float64Array }
let waysOf = (lv: Level): Way[] => {
  let got = laid.get(lv)
  if (got) return got
  let s = lv.seed * 101
  let from = lv.places[lv.arrive].at
  let land = landOf(lv)
  let sides = Object.entries(lv.roads) as [Side, string][]
  let ways = sides.map(([side, to]): Way => {
    let c = course(from, EDGE[side], s, 7, STRAIGHT)
    let n = c.xs.length
    let raw = c.xs.map((x, i) => Math.max(DRY, land(x, c.zs[i])))
    let bed = raw.map((_, i) => {
      let lo = Math.max(0, i - EVEN), hi = Math.min(n - 1, i + EVEN)
      let sum = 0
      for (let j = lo; j <= hi; j++) sum += raw[j]
      return sum / (hi - lo + 1)
    })
    for (let i = 1; i < n; i++) bed[i] = Math.min(bed[i], bed[i - 1] + GRADE)
    for (let i = n - 2; i >= 0; i--) {
      bed[i] = Math.min(bed[i], bed[i + 1] + GRADE)
    }
    return { side, to, c, bed: bed.map((h) => Math.max(DRY, h)) }
  })
  laid.set(lv, ways)
  return ways
}
let laid = new WeakMap<Level, Way[]>()
let bedAt = (bed: Float64Array, t: number) => {
  let f = t * (bed.length - 1)
  let i = Math.min(bed.length - 2, Math.floor(f))
  return lerp(bed[i], bed[i + 1], f - i)
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

// The lanes that run from the village out to each place.
let lanesOf = (lv: Level): Course[] => {
  let home = Object.values(lv.places).find((p) => p.kind == 'village')
  if (!home) return []
  return Object.values(lv.places)
    .filter((p) => dist(p.at[0], p.at[1], home.at) >= 1)
    .map((p) => course(home.at, p.at, lv.seed * 101))
}

// How far a point is from the nearest lane, as a share of the lane's width
// there: a lane widens as it goes.
let toLane = (lanes: Course[], x: number, z: number) => {
  let best = Infinity
  for (let c of lanes) {
    let t = along(c, x, z)
    best = Math.min(best, off(c, x, z, t) / (0.6 + t))
  }
  return best
}

// How far a point is from the middle of the nearest road, in metres.
let toRoad = (ways: Way[], x: number, z: number) => {
  let best = Infinity
  for (let { c } of ways) best = Math.min(best, off(c, x, z, along(c, x, z)))
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
  let ways = waysOf(lv)
  let h = new Int16Array(n * n)
  let hue = new Float32Array(n * n)
  let lanes = new Float32Array(n * n)
  let roads = new Float32Array(n * n)
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      let x = mid(i), z = mid(k)
      h[at(i, k)] = Math.round(height(x, z) / V)
      hue[at(i, k)] = fbm(x / 11, z / 11, 31 + s, 3)
      lanes[at(i, k)] = toLane(paths, x, z)
      roads[at(i, k)] = toRoad(ways, x, z)
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
  // sand at the water, a path where a road or a lane runs, and elsewhere
  // whatever the places holding it cover it with, strongest first.
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
        : roads[at(i, k)] < ROAD || lanes[at(i, k)] < 0.85 && w.rim < 0.4
        ? Top.path
        : coverOf(w, fbm(x / 3, z / 3, 11 + s, 2)) ??
          (w.rim > 0.45 ? Top.dry : Top.grass)
    }
  }

  // Each village paved where people gather; what each place builds round its
  // middle; and each road's signpost, where a hero coming in by it stands.
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
  let out = ways.map(({ side, to, c }): Road => {
    let [x, z] = EDGE[side], len = Math.hypot(c.dx, c.dz)
    let [ux, uz] = [-c.dx / len, -c.dz / len]
    let door: Spot = [x + ux * DOOR, z + uz * DOOR]
    let sign: Spot = [snap(door[0] - uz * 2.75), snap(door[1] + ux * 2.75)]
    built.push({ kind: 'signpost', x: sign[0], z: sign[1], seed: 0 })
    return { side, to, x, z, door, sign }
  })

  let props: Prop[] = [...built]
  let taken = (x: number, z: number, lane: number, road: number) =>
    built.some((p) => dist(x, z, [p.x, p.z]) < (KINDS[p.kind].foot ?? 0) + 1) ||
    villages.some((p) => dist(x, z, p.at) < 6) ||
    lane < 1.3 || road < ROAD + 1.5

  // Trees and rocks, one chance per cell of a jittered grid, decided on the
  // smooth ground so they stand in the same places at every voxel size; none
  // in the glade where a hero comes in by a road, so they see where they
  // are.
  let CELL = 3
  for (let ck = 0; ck < SIZE / CELL; ck++) {
    for (let ci = 0; ci < SIZE / CELL; ci++) {
      let x = snap(ci * CELL + rand(ci, ck, 1 + s) * (CELL - GRID))
      let z = snap(ck * CELL + rand(ci, ck, 2 + s) * (CELL - GRID))
      if (x < 1 || z < 1 || x > SIZE - 1.5 || z > SIZE - 1.5) continue
      let y = height(x, z)
      if (y <= SHORE || y >= 18 || steep(height, x, z) >= 2) continue
      if (taken(x, z, toLane(paths, x, z), toRoad(ways, x, z))) continue
      if (out.some((r) => dist(x, z, r.door) < GLADE)) continue
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
      if (BARE.has(t) || taken(x, z, lanes[j], roads[j])) continue
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
    roads: out,
  }
  v.walls = wallsOf(v)
  return v
}

// What a walker bumps into: what is solid, trunks and posts, the village's
// buildings and a ruin's walls (props.ts `KINDS`). A building is a row of
// circles along each wall, so its door is a gap.
let wallsOf = (v: Vale): Wall[] => {
  let walls: Wall[] = []
  for (let p of v.props) {
    let y = standAt(v, p), k = KINDS[p.kind]
    if (k.solid) {
      let { r, tall } = bulk(p.kind, p.seed)
      walls.push({ x: p.x, z: p.z, r, top: y + tall })
    } else if (k.girth) {
      // A trunk or a post is too tall to jump; a row as tall as it is drawn.
      let tall = k.row ? bulk(p.kind, p.seed).tall : 3
      let row = k.row ?? 0
      for (let dx = -row; dx <= row + 1e-9; dx += k.girth) {
        walls.push({ x: p.x + dx, z: p.z, r: k.girth, top: y + tall })
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
    roads: [],
  }
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
 * // The ground falls away to 3.5 m on its west side.
 * v.h[Math.floor(49.75 / v.voxel) + Math.floor(50.25 / v.voxel) * v.cols] =
 *   3.5 / v.voxel
 * assertEquals(foundation(v, well)?.[0][1], 3.5)
 * assertEquals(foundation(v, well)?.[1][1], 1.48)
 * ```
 */
export let foundation = (
  v: Vale,
  p: Prop,
): [[number, number, number], [number, number, number]] | null => {
  let span = KINDS[p.kind].span
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
  if (KINDS[p.kind].span) return groundAt(v, p.x, p.z)
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
