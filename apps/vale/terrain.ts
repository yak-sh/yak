// The world's ground: its shape, what grows where, and where things are. Pure
// numbers from rand.ts, the levels' rows as regions.ts lays them out and the
// ways between them (ways.ts), so every page grows the same world and none of
// it is stored. What lives in the store is what moves or changes: players,
// creatures, what they carry and what they have done.
//
// Everything here is in metres, from the world's origin. The ground is a
// smooth height (`rise`): the lie of the land as the places shape it
// (regions.ts), with the roads' beds laid in. A chunk of it is grown alone
// (`patch`), rounded to voxels of whatever size is asked, so a finer voxel
// draws the same hills in smaller steps, and grown beside its neighbours it
// is the same chunk. Where things stand (trees, rocks, buildings, the
// creatures' homes) is decided on the smooth height and a half-metre grid,
// never on the voxels, so it is the same at every voxel size.
//
// A chunk's ground is a stack of height maps, its layers: the surface, then
// each cave's ceiling and its floor in turn, deeper, each below the one above;
// rock between a ceiling and the floor over it. Only the surface grows yet,
// but what reads the ground (`floorUnder`, `roofOver`) reads the stack.
//
// Each place's kind (features.ts) says what the ground is topped with where
// it holds, and what grows and stands there; the region's wild says so where
// none of them holds, and near a border the two regions' wilds mix. What each
// place builds stands round its middle, laid out once for its level. A
// building among it is raised on the ground at its middle, as rounded to
// voxels, and lays the ground round it as it needs (`lay`).
import { dressed } from './buildings.ts'
import { type Feature, FEATURES, isA, Top } from './features.ts'
import { LEVELS, SIZE, type Spot } from './levels.ts'
import { bulk, KINDS, raisedOf } from './props.ts'
import { clamp, fbm, hash, lerp, rand, smooth } from './rand.ts'
import {
  type Blend,
  blend,
  lie,
  pick,
  type Placed,
  placesAt,
  placesIn,
  placesOf,
} from './regions.ts'
import { type Building, near, placed, type Station, within } from './solid.ts'
import {
  along,
  bedAt,
  EASE,
  lanesIn,
  near as close,
  off,
  ROAD,
  type Road,
  roadsIn,
  roadsOf,
  SHORE,
  toLane,
  toRoad,
  worn,
} from './ways.ts'

export { SHORE, SIZE, type Spot }

/** The voxel edge the ground is grown at unless asked for another, in
 * metres. */
export let VOXEL = 0.25
/** The water's surface, in metres. */
export let WATER = 4.8
/** A chunk's side, in metres: the ground is grown and drawn a chunk at a
 * time. */
export let CHUNK = 16
/** A height map's value where the layer is not: no cave there. */
export let NONE = -32768

// What stands on the ground stands on a grid this fine, in metres.
let GRID = 0.5

// How long (x, z) is. Not Math.hypot, which takes several times as long, and
// the ground measures a distance for every column several times over.
let norm = (x: number, z: number) => Math.sqrt(x * x + z * z)
let dist = (x: number, z: number, [a, b]: Spot) => norm(x - a, z - b)
let snap = (x: number) => (Math.floor(x / GRID) + 0.5) * GRID

// Every step a build standing aside may take from where it was planned, a
// cell of the grid at a time, up to 8 metres either way, shortest first.
let STEPS: Spot[] = Array.from({ length: 33 * 33 }, (_, j): Spot => [
  (j % 33 - 16) * GRID,
  (Math.floor(j / 33) - 16) * GRID,
]).sort((p, q) => norm(p[0], p[1]) - norm(q[0], q[1]))

/** A prop: something standing on the ground that is part of the world's
 * shape (a tree, a rock, a flower, a house, a signpost), at (x, z) metres,
 * turned `turn` quarter turns (a building's front, its south, to the east
 * for one). */
export type Prop = {
  kind: string
  x: number
  z: number
  seed: number
  turn?: number
}

/** Something a walker cannot pass: a circle at (x, z) of radius r, in metres,
 * up to height `top`. */
export type Wall = { x: number; z: number; r: number; top: number }

/** A chunk's ground as grown at one voxel size. Its layers are `n` columns
 * on a side, the chunk's own and one more all round, from the column
 * north-west of its corner (index i + k × n), in voxels: the surface, then
 * each cave's ceiling and floor in turn (NONE where a cave is not). The rest
 * is of the chunk's own columns only (index i + k × (n − 2)): what tops each,
 * its hue (how green, lush or dry: a gentle colour drift), the region it lies
 * in and the one it blends with, as indexes into `regions`, and how much it is
 * the first's, from 0 for half to 255 for all. */
export type Patch = {
  ci: number
  ck: number
  voxel: number
  n: number
  layers: Int16Array[]
  top: Uint8Array
  hue: Float32Array
  region: Uint8Array
  other: Uint8Array
  share: Uint8Array
  regions: string[]
}

/** The world's ground as a page or a worker grows it, at one voxel size: how
 * high the smooth ground is anywhere, how a chunk's ground grows, what stands
 * in it and what a walker bumps into there; and the chunks' ground grown so
 * far or handed in (`adopt`), kept for the chunks asked about last. */
export type Vale = {
  voxel: number
  rise: (x: number, z: number) => number
  grow: (ci: number, ck: number) => Patch
  plant: (ci: number, ck: number) => Prop[]
  bump: (ci: number, ck: number) => Wall[]
  /** the buildings whose ground comes within `r` metres of (x, z) */
  buildings: (x: number, z: number, r: number) => Building[]
  patches: Map<number, Patch>
}

/** Which chunk a point lies in. */
export let chunkOf = (m: number): number => Math.floor(m / CHUNK)
// A chunk as one number, to key it by: one of its own while it lies within
// 2^24 chunks of the origin either way.
let key = (ci: number, ck: number) =>
  (ci + 0x1000000) * 0x2000000 + ck + 0x1000000

// A cache of the last `most` things asked for, most recent last. What a
// walker asks it asks again and again of the one chunk it is in, so the last
// thing asked for is answered first, before the map is touched.
let kept = <T>(most: number, make: (ci: number, ck: number) => T) => {
  let got = new Map<number, T>()
  let last = NaN, was: T
  return (ci: number, ck: number): T => {
    let k = key(ci, ck)
    if (k === last) return was
    let v = got.get(k)
    if (v === undefined) v = make(ci, ck)
    else got.delete(k)
    got.set(k, v)
    if (got.size > most) got.delete(got.keys().next().value!)
    last = k
    return was = v
  }
}

// How strongly a point belongs to each kind of place holding it (the
// strongest of its places of that kind, and how far that one's middle is),
// and the kind of place its wild is, where none of them holds (levels.ts
// `wild`). A holder reads every point into the one Hold it keeps, so growing
// the ground makes nothing new per column.
type Hold = {
  wild?: Feature
  fs: Feature[]
  k: number[]
  far: number[]
}
let holder = () => {
  let w: Hold = { fs: [], k: [], far: [] }
  return (near: Placed[], x: number, z: number, wild?: string): Hold => {
    w.fs.length = w.k.length = w.far.length = 0
    w.wild = wild ? FEATURES[wild] : undefined
    for (let p of near) {
      let d = dist(x, z, p.at)
      if (d >= p.holds) continue
      let k = p.f.hold(d), i = w.fs.indexOf(p.f)
      if (i < 0) {
        w.fs.push(p.f)
        w.k.push(k)
        w.far.push(d)
      } else if (k > w.k[i]) {
        w.k[i] = k
        w.far[i] = d
      }
    }
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
let coverOf = (w: Hold, n: number, x: number, z: number) => {
  for (let i = lead(w, 0.42); i >= 0; i = lead(w, 0.42, undefined, w.k[i])) {
    let t = w.fs[i].cover?.(n, w.far[i], x, z)
    if (t != null) return t
  }
}

// What tops a point: what the kinds holding it cover it with; else what the
// wild covers, or grass.
let cover = (w: Hold, n: number, x: number, z: number) =>
  coverOf(w, n, x, z) ?? w.wild?.cover?.(n, Infinity, x, z) ?? Top.grass

// Of the kinds that say `what` grows, the one holding a point strongest,
// else the wild's; `h` picks among what it grows.
let pickOf = (w: Hold, what: 'grows' | 'stones', h: number, rest: string) => {
  let i = lead(w, 0.35, (f) => f[what])
  let xs = w.fs[i]?.[what] ?? w.wild?.[what]
  return xs ? xs[h % xs.length] : rest
}

// A sum over the kinds holding a point, each weighted by `by`.
let weigh = (w: Hold, by: (f: Feature) => number | undefined) => {
  let sum = 0
  for (let i = 0; i < w.fs.length; i++) sum += (by(w.fs[i]) ?? 0) * w.k[i]
  return sum
}

// The wild of a point's region, of the two it blends with the one `roll`
// picks.
let wildOf = (b: Blend, roll: number) => LEVELS[pick(b, roll)]?.wild

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

// The ground's smooth height where the places `near` and the `roads` may
// reach: the lie of the land, eased into each road's bed.
let rising = (near: Placed[], roads: Road[]) => (x: number, z: number) => {
  let h = lie(x, z, near)
  for (let r of roads) {
    if (!close(r.c, x, z, ROAD + EASE)) continue
    let t = along(r.c, x, z), d = off(r.c, x, z, t)
    h = lerp(h, bedAt(r, t), 1 - smooth(ROAD, ROAD + EASE, d))
  }
  return clamp(h, 0.5, 30)
}

/** The ground's smooth height at (x, z), in metres, before it is rounded to
 * voxels.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * // A village's ground is flattened round its fire.
 * assertEquals(Math.round(rise(64, 64) * 10) / 10, 6.5)
 * ```
 */
export let rise = (x: number, z: number): number =>
  rising(placesAt(x, z), roadsIn(x, z, x, z, ROAD + EASE))(x, z)

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

/** A place that is a village, where it lies in the world. */
export type Village = { level: string; name: string; at: Spot }

let VILLAGES: Village[] = Object.keys(LEVELS).flatMap((id) =>
  placesOf(id).filter((p) => isA(p.kind, 'village')).map((p) => ({
    level: id,
    name: p.name,
    at: p.at,
  }))
)

/** The villages within `r` metres of (x, z), nearest first. */
export let villagesNear = (x: number, z: number, r: number): Village[] =>
  VILLAGES.filter((v) => dist(x, z, v.at) < r)
    .sort((a, b) => dist(x, z, a.at) - dist(x, z, b.at))

/** The fire of the village nearest (x, z), within `r` metres; or null. */
export let hearthNear = (x: number, z: number, r = Infinity): Spot | null =>
  villagesNear(x, z, r)[0]?.at ?? null

/** Where a level's village fire is, if it has a village. */
export let hearthOf = (id: string): Spot | null =>
  VILLAGES.find((v) => v.level == id)?.at ?? null

// What each level builds, laid out the first time it is asked for: each
// place's builds round its middle, a build that stands aside (props/kit.ts)
// taking the nearest step from where it was planned (STEPS) where none of the
// ground it takes is paved and a metre parts it from what was built before
// it, failing that where a metre parts them; and the signpost beside each
// road out. The ground a build takes is a box square to the axes, as
// structures are built (`foundation`): its span, or the trunk or row a walker
// meets, or its foot.
let raised = new Map<string, Prop[]>()
/** The ground a structure stands on, metres east–west and north–south, as it
 * stands turned. */
export let spanOf = (p: Prop): [number, number] | undefined => {
  let s = KINDS[p.kind].span
  return s && (p.turn ?? 0) & 1 ? [s[1], s[0]] : s
}
let half = (p: Prop): [number, number] => {
  let { girth, row = 0, foot = 0 } = KINDS[p.kind], span = spanOf(p)
  return span
    ? [span[0] / 2, span[1] / 2]
    : girth
    ? [row + girth / 2, girth / 2]
    : [foot, foot]
}
/** What a level builds, in world metres: what its places build round their
 * middles, and the signpost beside each road out. */
export let builtOf = (id: string): Prop[] => {
  let got = raised.get(id)
  if (got) return got
  let built: Prop[] = []
  let places = placesOf(id)
  let paved = (x: number, z: number) =>
    toRoad(roadsIn(x, z, x, z, ROAD), x, z, ROAD) < ROAD ||
    toLane(lanesIn(x, z, x, z, 2), x, z) < 0.85
  let clear = (p: Prop, x: number, z: number, road: boolean) => {
    let [w, d] = half(p)
    return built.every((q) => {
      let [qw, qd] = half(q)
      return Math.abs(x - q.x) >= w + qw + 1 || Math.abs(z - q.z) >= d + qd + 1
    }) &&
      (!road ||
        [-1, 0, 1].every((u) =>
          [-1, 0, 1].every((t) => !paved(x + u * (w + 0.5), z + t * (d + 0.5)))
        ))
  }
  let stand = (b: Prop, [cx, cz]: Spot): Prop => {
    let x0 = snap(cx + b.x), z0 = snap(cz + b.z)
    for (let road of KINDS[b.kind].aside ? [true, false] : []) {
      for (let [dx, dz] of STEPS) {
        let x = x0 + dx, z = z0 + dz
        if (clear(b, x, z, road)) return { ...b, x, z }
      }
    }
    return { ...b, x: cx + b.x, z: cz + b.z }
  }
  for (let p of places) {
    for (let b of p.f.builds ?? []) {
      built.push(stand({ ...b, kind: dressed(b.kind, p.f.dress) }, p.at))
    }
  }
  for (let r of roadsOf(id)) {
    let [x, z] = r.signs.find((s) => s.level == id)!.at
    built.push(stand({ kind: 'signpost', x, z, seed: 0 }, [0, 0]))
  }
  raised.set(id, built)
  return built
}

// How far a build can reach from its place's middle, including its span and
// the farthest clear plot an aside build may take. A chunk uses this bound to
// find builds beyond a level's cell edge.
let SHIFT = Math.max(...STEPS.flatMap(([x, z]) => [Math.abs(x), Math.abs(z)]))
let BUILT = Math.ceil(
  Math.max(
    ...Object.values(FEATURES).flatMap((f) =>
      (f.builds ?? []).map((b) => {
        let p = { ...b, kind: dressed(b.kind, f.dress) }
        let [w, d] = half(p)
        return Math.max(Math.abs(b.x) + w, Math.abs(b.z) + d) +
          (KINDS[p.kind].aside ? SHIFT : 0)
      })
    ),
  ),
)

/** What is built within the box from (x0, z0) to (x1, z1), in metres. */
export let builtIn = (x0: number, z0: number, x1: number, z1: number): Prop[] =>
  Object.values(LEVELS).filter(({ cell: [gx, gz] }) =>
    gx * SIZE < x1 + BUILT && (gx + 1) * SIZE > x0 - BUILT &&
    gz * SIZE < z1 + BUILT && (gz + 1) * SIZE > z0 - BUILT
  ).flatMap((lv) =>
    builtOf(lv.id).filter((p) => p.x >= x0 && p.x < x1 && p.z >= z0 && p.z < z1)
  )

/** What is built within `r` metres of (x, z). */
export let builtNear = (x: number, z: number, r: number): Prop[] =>
  builtIn(x - r, z - r, x + r, z + r).filter((p) => dist(x, z, [p.x, p.z]) < r)

// The smooth height of the ground across a box, and the lists of what may
// reach it, found once for all of its points: `m` metres round the box are
// counted in, for what looks beside a point.
let area = (x0: number, z0: number, x1: number, z1: number, m = 2) => {
  let near = placesIn(x0 - m, z0 - m, x1 + m, z1 + m)
  let roads = roadsIn(x0 - m, z0 - m, x1 + m, z1 + m, ROAD + EASE + 1.5)
  let lanes = lanesIn(x0 - m, z0 - m, x1 + m, z1 + m, 3)
  let built = builtIn(x0 - 12, z0 - 12, x1 + 12, z1 + 12)
  let villages = VILLAGES.filter((v) =>
    v.at[0] > x0 - 12 && v.at[0] < x1 + 12 && v.at[1] > z0 - 12 &&
    v.at[1] < z1 + 12
  )
  return { near, roads, lanes, built, villages, height: rising(near, roads) }
}

// Whether a point, this far from the nearest lane and road, is taken: by
// what is built, a village's square, or a way.
let takenIn = (a: ReturnType<typeof area>) =>
(
  x: number,
  z: number,
  lane = toLane(a.lanes, x, z),
  road = toRoad(a.roads, x, z),
) =>
  a.built.some((p) => dist(x, z, [p.x, p.z]) < (KINDS[p.kind].foot ?? 0) + 1) ||
  a.villages.some((v) => dist(x, z, v.at) < 6) || worn(lane, road)

// Trees and rocks, one chance per cell of a jittered grid, decided on the
// smooth ground so they stand in the same places at every voxel size.
let CELL = 3
let hold = holder()
let planted = kept(400, (ci: number, ck: number): Prop[] => {
  let x0 = ci * CHUNK, z0 = ck * CHUNK, x1 = x0 + CHUNK, z1 = z0 + CHUNK
  let a = area(x0, z0, x1, z1)
  let taken = takenIn(a)
  let props = a.built.filter((p) =>
    p.x >= x0 && p.x < x1 && p.z >= z0 && p.z < z1
  )
  for (let gk = Math.floor(z0 / CELL); gk * CELL < z1; gk++) {
    for (let gi = Math.floor(x0 / CELL); gi * CELL < x1; gi++) {
      let x = snap(gi * CELL + rand(gi, gk, 1) * (CELL - GRID))
      let z = snap(gk * CELL + rand(gi, gk, 2) * (CELL - GRID))
      if (x < x0 || x >= x1 || z < z0 || z >= z1) continue
      let y = a.height(x, z)
      if (y <= SHORE || y >= 18 || steep(a.height, x, z) >= 2) continue
      if (taken(x, z)) continue
      let w = hold(a.near, x, z, wildOf(blend(x, z), rand(gi, gk, 7)))
      let tree = 0.04 + weigh(w, (f) => f.trees)
      let rock = 0.03 + weigh(w, (f) => f.rocks)
      let roll = rand(gi, gk, 3), h = hash(gi, gk, 6)
      let grow = roll < tree
      let kind = grow
        ? pickOf(w, 'grows', h, 'oak')
        : roll < tree + rock
        ? pickOf(w, 'stones', h, 'rock')
        : undefined
      if (kind) props.push({ kind, x, z, seed: hash(gi, gk, grow ? 4 : 5) })
    }
  }
  return props
})

/** What stands in chunk (ci, ck) of the world: what is built there, and its
 * trees and rocks; not what grows underfoot (`decor`). The same at every
 * voxel size. */
export let propsIn = (ci: number, ck: number): Prop[] => planted(ci, ck)

/** What grows underfoot in a patch's chunk (flowers, grass, reeds and the
 * like), one chance per cell of the grid: what the strongest place holding
 * it says, else the wild's, else on green ground flowers and grass; on sand
 * and stone only what a place strews. */
export let decor = (p: Patch): Prop[] => {
  let V = p.voxel, C = p.n - 2
  let x0 = p.ci * CHUNK, z0 = p.ck * CHUNK
  let a = area(x0, z0, x0 + CHUNK, z0 + CHUNK)
  let taken = takenIn(a)
  let out: Prop[] = []
  let cells = CHUNK / GRID
  for (let dk = 0; dk < cells; dk++) {
    for (let di = 0; di < cells; di++) {
      let gi = p.ci * cells + di, gk = p.ck * cells + dk
      let x = (gi + 0.5) * GRID, z = (gk + 0.5) * GRID
      let roll = rand(gi, gk, 9)
      if (roll >= LUSH) continue
      let t = p.top[Math.floor((x - x0) / V) + Math.floor((z - z0) / V) * C]
      if (t == Top.path || taken(x, z)) continue
      let w = hold(a.near, x, z, wildOf(blend(x, z), rand(gi, gk, 8)))
      let f = w.fs[lead(w, 0.42, (f) => f.decor)]
      if (BARE.has(t) && !f?.strewn) continue
      let list = f?.decor ?? w.wild?.decor ?? (GREEN.has(t) ? DECOR : [])
      let sum = 0
      for (let [kind, chance] of list) {
        if (roll < (sum += chance)) {
          out.push({ kind, x, z, seed: hash(gi, gk, 10) })
          break
        }
      }
    }
  }
  return out
}

// Chunk (ci, ck)'s ground, grown alone at the vale's voxel edge V. What tops
// each column: snow up high, stone where it is steep, sand at the water, a
// path where a road or a lane runs or a village gathers, and elsewhere
// whatever the places holding it cover it with, strongest first (`cover`);
// and then the ground the buildings need is laid.
let growing = (v: Vale) => (ci: number, ck: number): Patch => {
  let V = v.voxel, C = Math.round(CHUNK / V), n = C + 2
  let x0 = ci * CHUNK, z0 = ck * CHUNK
  let a = area(x0, z0, x0 + CHUNK, z0 + CHUNK)
  let mid = (j: number) => (j + 0.5) * V
  let i0 = ci * C - 1, k0 = ck * C - 1
  let h = new Int16Array(n * n)
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      h[i + k * n] = Math.round(a.height(mid(i0 + i), mid(k0 + k)) / V)
    }
  }
  let get = (i: number, k: number) => h[i + k * n]
  let top = new Uint8Array(C * C), hue = new Float32Array(C * C)
  let region = new Uint8Array(C * C), other = new Uint8Array(C * C)
  let share = new Uint8Array(C * C), regions: string[] = []
  let index = (id: string) => {
    let j = regions.indexOf(id)
    return j < 0 ? regions.push(id) - 1 : j
  }
  for (let dk = 0; dk < C; dk++) {
    for (let di = 0; di < C; di++) {
      let i = di + 1, k = dk + 1, j = di + dk * C
      let x = mid(i0 + i), z = mid(k0 + k)
      let c = get(i, k)
      let slope = Math.max(
        Math.abs(get(i + 1, k) - c),
        Math.abs(get(i - 1, k) - c),
        Math.abs(get(i, k + 1) - c),
        Math.abs(get(i, k - 1) - c),
      )
      let b = blend(x, z)
      region[j] = index(b.a)
      other[j] = index(b.b || b.a)
      share[j] = Math.round((b.t - 0.5) * 510)
      hue[j] = fbm(x / 11, z / 11, 31, 3)
      let gi = Math.floor(x / GRID), gk = Math.floor(z / GRID)
      let w = hold(a.near, x, z, wildOf(b, rand(gi, gk, 8)))
      let most = w.fs[lead(w, 0.42)]
      let paved = a.villages.some((v) =>
        dist(x, z, v.at) <
          4.75 + rand(gi, gk, 5 + LEVELS[v.level].seed * 101) * 0.75
      )
      top[j] = c * V >= 19
        ? Top.snow
        : slope >= 3
        ? most?.cliff ?? Top.stone
        : c * V <= SHORE
        ? most?.shore ?? Top.sand
        : paved || toRoad(a.roads, x, z) < ROAD || toLane(a.lanes, x, z) < 0.85
        ? Top.path
        : cover(w, fbm(x / 3, z / 3, 11, 2), x, z)
    }
  }
  layIn(v, ci, ck, h, top)
  return {
    ci,
    ck,
    voxel: V,
    n,
    layers: [h],
    top,
    hue,
    region,
    other,
    share,
    regions,
  }
}

// How far round a building's box the ground it needs is laid, in metres.
let LAID = 5.5

/** The ground a building needs at (x, z), where the ground is `h` metres
 * high: under its walls no higher than its foot, so its floor is never
 * buried; level with its foot a metre and a half out before each door; and
 * a path from there four metres on. A rule of the point and the building, so
 * wherever the ground is grown it is laid the same.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let v = flat(5, [], [{ kind: 'smithy.plaster', x: 64, z: 64, seed: 0 }])
 * let b = v.buildings(64, 64, 0)[0]
 * assertEquals(lay(b, 63, 64, 7), { h: 5, path: false }) // inside
 * assertEquals(lay(b, b.doors[0].hinge[0], 67.5, 4), { h: 5, path: false })
 * assertEquals(lay(b, b.doors[0].hinge[0], 70, 4).path, true)
 * assertEquals(lay(b, 50, 50, 4), { h: 4, path: false })
 * ```
 */
export let lay = (b: Building, x: number, z: number, h: number) => {
  let [w, n, e, s] = b.foot
  if (x > w && x < e && z > n && z < s) {
    return { h: Math.min(h, b.y), path: false }
  }
  for (let d of b.doors) {
    let mx = d.hinge[0] + d.along[0] * d.wide / 2
    let mz = d.hinge[2] + d.along[1] * d.wide / 2
    let out = -((x - mx) * d.into[0] + (z - mz) * d.into[1])
    let side = Math.abs((x - mx) * d.along[0] + (z - mz) * d.along[1])
    if (out > 0 && out < 1.6 && side < d.wide / 2 + 0.75) {
      return { h: b.y, path: false }
    }
    if (out >= 1.6 && out < 5.6 && side < 0.65) return { h, path: true }
  }
  return { h, path: false }
}

// Each vale's buildings, raised the first time each is asked for.
let raising = new WeakMap<Vale, WeakMap<Prop, Building | null>>()

/** The building prop `p` is in vale `v`, raised on the ground at its middle
 * as rounded to the vale's voxels; null for any other prop. */
export let buildingOf = (v: Vale, p: Prop): Building | null => {
  if (!KINDS[p.kind].raise) return null
  let got = raising.get(v)
  if (!got) raising.set(v, got = new WeakMap())
  let b = got.get(p)
  if (b !== undefined) return b
  let V = v.voxel, mid = (m: number) => (Math.floor(m / V) + 0.5) * V
  let base = Math.round(v.rise(mid(p.x), mid(p.z)) / V) * V
  let r = raisedOf(p.kind, p.seed)
  b = r && placed(p.kind, r, [p.x, base, p.z], p.turn ?? 0)
  got.set(p, b)
  return b
}

// The ground the buildings need (`lay`), laid into chunk (ci, ck)'s surface
// `h` (its columns and one more all round, in voxels), and a path in `top`
// (its own columns) where one leads from a door.
let layIn = (
  v: Vale,
  ci: number,
  ck: number,
  h: Int16Array,
  top: Uint8Array,
) => {
  let V = v.voxel, C = Math.round(CHUNK / V), n = C + 2
  let i0 = ci * C - 1, k0 = ck * C - 1
  let mid = (j: number) => (j + 0.5) * V
  let col = (m: number, o: number) =>
    Math.max(0, Math.min(n - 1, Math.floor(m / V) - o))
  let cx = (ci + 0.5) * CHUNK, cz = (ck + 0.5) * CHUNK
  for (let b of v.buildings(cx, cz, CHUNK / 2 + V + LAID)) {
    for (let k = col(b.box[1] - LAID, k0); k <= col(b.box[3] + LAID, k0); k++) {
      for (
        let i = col(b.box[0] - LAID, i0);
        i <= col(b.box[2] + LAID, i0);
        i++
      ) {
        let j = i + k * n, got = lay(b, mid(i0 + i), mid(k0 + k), h[j] * V)
        h[j] = Math.round(got.h / V)
        let own = i > 0 && i <= C && k > 0 && k <= C
        if (got.path && own) top[i - 1 + (k - 1) * C] = Top.path
      }
    }
  }
}

// The buildings of a vale whose ground comes within r of (x, z): of those
// whose ground reaches each cell of the lattice (levels.ts `SIZE`) that the
// square round (x, z) covers, found among what is `built` within a chunk of
// the cell, as nothing built reaches further from its middle (`bumping`). A
// walker asks of the one cell it is in, again and again.
let housing = (
  v: Vale,
  built: (x0: number, z0: number, x1: number, z1: number) => Prop[],
) => {
  let reaching = kept(64, (gi: number, gk: number): Building[] => {
    let x0 = gi * SIZE, z0 = gk * SIZE, x1 = x0 + SIZE, z1 = z0 + SIZE
    return built(x0 - CHUNK, z0 - CHUNK, x1 + CHUNK, z1 + CHUNK).flatMap(
      (p) => {
        let b = buildingOf(v, p)
        if (!b) return []
        let [w, n, e, s] = b.box
        return w <= x1 && e >= x0 && n <= z1 && s >= z0 ? [b] : []
      },
    )
  })
  let cell = (m: number) => Math.floor(m / SIZE)
  return (x: number, z: number, r: number): Building[] => {
    let out: Building[] = []
    for (let gk = cell(z - r); gk <= cell(z + r); gk++) {
      for (let gi = cell(x - r); gi <= cell(x + r); gi++) {
        for (let b of reaching(gi, gk)) {
          if (near(b, x, z, r) && !out.includes(b)) out.push(b)
        }
      }
    }
    return out
  }
}

/** Where heroes make things within `r` metres of (x, z) (craft.ts): the
 * stations standing in the open, and the ones buildings house.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let v = flat(5, [], [{ kind: 'smithy.plaster', x: 64, z: 64, seed: 0 }])
 * assertEquals(stationsNear(v, 64, 64, 12).map((s) => s.craft), ['forge'])
 * assertEquals(stationsNear(v, 90, 64, 12), [])
 * ```
 */
export let stationsNear = (
  v: Vale,
  x: number,
  z: number,
  r: number,
): Station[] => [
  ...propsNear(v, x, z, r).flatMap((p): Station[] => {
    let craft = KINDS[p.kind].station
    return craft ? [{ craft, x: p.x, y: standAt(v, p), z: p.z }] : []
  }),
  ...v.buildings(x, z, r).flatMap((b) =>
    b.stations.filter((s) => dist(x, z, [s.x, s.z]) < r)
  ),
]

// What a walker bumps into in a chunk: solid props, trunks and posts. A
// building's voxels answer beside these in solid.ts.
let bumping = (v: Vale) => (ci: number, ck: number): Wall[] => {
  let x0 = ci * CHUNK, z0 = ck * CHUNK, x1 = x0 + CHUNK, z1 = z0 + CHUNK
  let walls: Wall[] = []
  let add = (w: Wall) => {
    let dx = Math.max(x0 - w.x, 0, w.x - x1)
    let dz = Math.max(z0 - w.z, 0, w.z - z1)
    if (norm(dx, dz) < w.r + 1) walls.push(w)
  }
  for (let k = ck - 1; k <= ck + 1; k++) {
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let p of v.plant(i, k)) {
        let y = standAt(v, p), kind = KINDS[p.kind]
        if (kind.solid) {
          let { r, tall } = bulk(p.kind, p.seed)
          add({ x: p.x, z: p.z, r, top: y + tall })
        } else if (kind.girth) {
          // A trunk or a post is too tall to jump; a row as tall as it is
          // drawn.
          let tall = kind.row ? bulk(p.kind, p.seed).tall : 3
          let row = kind.row ?? 0
          for (let dx = -row; dx <= row + 1e-9; dx += kind.girth) {
            add({ x: p.x + dx, z: p.z, r: kind.girth, top: y + tall })
          }
        }
      }
    }
  }
  return walls
}

// The world's ground at each voxel size asked for, made once.
let vales = new Map<number, Vale>()

/** The world's ground grown at a voxel edge of `voxel` metres, which must
 * divide CHUNK. Deterministic: every page and worker grows the same.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { regionOf } from './regions.ts'
 * // A chunk grown alone meets its neighbour at their seam: the column past
 * // its east edge is its neighbour's first, and its last is the column
 * // before the neighbour's.
 * let v = vale(1), a = v.grow(-2, 3), n = a.n
 * let b = v.grow(-1, 3)
 * let seam = (p: typeof a, i: number) =>
 *   Array.from({ length: n }, (_, k) => p.layers[0][i + k * n])
 * assertEquals(seam(a, n - 1), seam(b, 1))
 * assertEquals(seam(a, n - 2), seam(b, 0))
 * // Each column is in the region that holds its middle, at every voxel
 * // size: here, where Mossvale meets Birchmere.
 * for (let p of [a, vale(0.5).grow(-2, 3)]) {
 *   let C = p.n - 2, V = p.voxel
 *   let at = (j: number) =>
 *     regionOf(-32 + (j % C + 0.5) * V, 48 + (Math.floor(j / C) + 0.5) * V)
 *   assertEquals([...p.region].filter((r, j) => p.regions[r] != at(j)), [])
 *   let ids = new Set([...p.region].map((r) => p.regions[r]))
 *   assertEquals([...ids].sort(), ['birchmere', 'mossvale'])
 * }
 * ```
 */
export let vale = (voxel = VOXEL): Vale => {
  let got = vales.get(voxel)
  if (got) return got
  let v: Vale = {
    voxel,
    rise,
    grow: (ci, ck) => grow(ci, ck),
    plant: propsIn,
    bump: (ci, ck) => bumps(ci, ck),
    buildings: (x, z, r) => houses(x, z, r),
    patches: new Map(),
  }
  let grow = growing(v), bumps = kept(200, bumping(v))
  let houses = housing(v, builtIn)
  vales.set(voxel, v)
  return v
}

// How many chunks' ground a vale keeps.
let PATCHES = 200

/** Keep a chunk's ground grown elsewhere (a worker) in a vale, which then
 * reads it rather than growing it. */
export let adopt = (v: Vale, p: Patch) => {
  let k = key(p.ci, p.ck)
  v.patches.delete(k)
  v.patches.set(k, p)
  if (v.patches.size > PATCHES) v.patches.delete(v.patches.keys().next().value!)
}

/** Chunk (ci, ck)'s ground in a vale: as kept, or grown now and kept. */
export let patchOf = (v: Vale, ci: number, ck: number): Patch => {
  let p = v.patches.get(key(ci, ck))
  if (!p) adopt(v, p = v.grow(ci, ck))
  return p
}

/** Ground `high` metres up, or as high as `high` says at each point, holding
 * nothing but `walls` and `props`: somewhere to try a rule with nothing else
 * in the way. */
export let flat = (
  high: number | ((x: number, z: number) => number),
  walls: Wall[] = [],
  props: Prop[] = [],
  voxel = VOXEL,
): Vale => {
  let rise = typeof high == 'number' ? () => high : high
  let within =
    <T extends { x: number; z: number }>(xs: T[], r: number) =>
    (ci: number, ck: number) =>
      xs.filter((p) =>
        p.x >= ci * CHUNK - r && p.x < (ci + 1) * CHUNK + r &&
        p.z >= ck * CHUNK - r && p.z < (ck + 1) * CHUNK + r
      )
  let v: Vale = {
    voxel,
    rise,
    grow: (ci, ck) => {
      let C = Math.round(CHUNK / voxel), n = C + 2
      let h = new Int16Array(n * n)
      for (let k = 0; k < n; k++) {
        for (let i = 0; i < n; i++) {
          h[i + k * n] = Math.round(
            rise((ci * C + i - 0.5) * voxel, (ck * C + k - 0.5) * voxel) /
              voxel,
          )
        }
      }
      let top = new Uint8Array(C * C)
      layIn(v, ci, ck, h, top)
      return {
        ci,
        ck,
        voxel,
        n,
        layers: [h],
        top,
        hue: new Float32Array(C * C),
        region: new Uint8Array(C * C),
        other: new Uint8Array(C * C),
        share: new Uint8Array(C * C).fill(255),
        regions: ['mossvale'],
      }
    },
    plant: within(props, 0),
    bump: within(walls, 8),
    buildings: (x, z, r) => houses(x, z, r),
    patches: new Map(),
  }
  let houses = housing(
    v,
    (x0, z0, x1, z1) =>
      props.filter((p) => p.x >= x0 && p.x < x1 && p.z >= z0 && p.z < z1),
  )
  return v
}

// The column (x, z) lies in, as a voxel index, and its layers: from a patch
// kept, or the smooth ground rounded there.
let column = (v: Vale, x: number, z: number) => {
  let V = v.voxel, ci = chunkOf(x), ck = chunkOf(z)
  let p = v.patches.get(key(ci, ck))
  if (!p) return null
  let C = p.n - 2
  let i = Math.floor(x / V) - ci * C + 1, k = Math.floor(z / V) - ck * C + 1
  return { p, j: i + k * p.n }
}

/** The ground's surface in metres under (x, z): the top of its first
 * layer. */
export let groundAt = (v: Vale, x: number, z: number): number => {
  let c = column(v, x, z), V = v.voxel
  if (c) return c.p.layers[0][c.j] * V
  let mx = (Math.floor(x / V) + 0.5) * V, mz = (Math.floor(z / V) + 0.5) * V
  let h = Math.round(v.rise(mx, mz) / V) * V
  for (let b of v.buildings(mx, mz, LAID)) {
    h = Math.round(lay(b, mx, mz, h).h / V) * V
  }
  return h
}

// The layers at a column, deepest last, in metres; NONE where a cave is not.
let layersAt = (v: Vale, x: number, z: number): number[] => {
  let c = column(v, x, z)
  return c
    ? c.p.layers.map((l) => l[c.j] == NONE ? NONE : l[c.j] * v.voxel)
    : [groundAt(v, x, z)]
}

// The open space a point at height y is in: the floor it stands over and
// the roof over it (Infinity under the sky). A point in rock is in the space
// over it.
let spaceOf = (v: Vale, x: number, y: number, z: number): [number, number] => {
  let ls = layersAt(v, x, z)
  let roof = Infinity
  for (let i = 0; i < ls.length; i += 2) {
    let floor = ls[i]
    if (floor == NONE) break
    if (y >= floor || i + 2 >= ls.length || ls[i + 1] == NONE) {
      return [floor, roof]
    }
    // Under the ceiling of the cave below? Then in it, or in its rock.
    if (y >= ls[i + 1]) return [floor, roof]
    roof = ls[i + 1]
  }
  return [ls[0], Infinity]
}

/** The floor under a point at height `y` over (x, z), in metres: the ground
 * of the open space it is in, the surface or a cave's floor.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let v = flat(5)
 * assertEquals([floorUnder(v, 3, 9, 3), roofOver(v, 3, 9, 3)], [5, Infinity])
 * ```
 */
export let floorUnder = (v: Vale, x: number, y: number, z: number): number =>
  spaceOf(v, x, y, z)[0]

/** The roof over a point at height `y` over (x, z), in metres: the ceiling
 * of the cave it is in, or Infinity under the sky. */
export let roofOver = (v: Vale, x: number, y: number, z: number): number =>
  spaceOf(v, x, y, z)[1]

/** What a walker bumps into near (x, z). */
export let wallsNear = (v: Vale, x: number, z: number): Wall[] =>
  v.bump(chunkOf(x), chunkOf(z))

/** What stands within `r` metres of (x, z). */
export let propsNear = (v: Vale, x: number, z: number, r: number): Prop[] => {
  let out: Prop[] = []
  for (let ck = chunkOf(z - r); ck <= chunkOf(z + r); ck++) {
    for (let ci = chunkOf(x - r); ci <= chunkOf(x + r); ci++) {
      for (let p of v.plant(ci, ck)) {
        if (dist(x, z, [p.x, p.z]) < r) out.push(p)
      }
    }
  }
  return out
}

/** A structure's foundation: stone from the lowest ground under it up to the
 * ground it stands on, as `[min, size]` in metres; `null` for a prop that is
 * not a structure, or where the ground under it is level.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let well = { kind: 'well', x: 50.25, z: 50.25, seed: 0 }
 * assertEquals(foundation(flat(5), well), null)
 * // The ground falls away to 3.5 m on its west side.
 * let v = flat((x) => x < 50 && x > 49.5 ? 3.5 : 5)
 * assertEquals(foundation(v, well)?.[0][1], 3.5)
 * assertEquals(foundation(v, well)?.[1][1], 1.48)
 * ```
 */
export let foundation = (
  v: Vale,
  p: Prop,
): [[number, number, number], [number, number, number]] | null => {
  let span = spanOf(p)
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
 * let b = v.buildings(30, 30, 0)[0]
 * assertEquals(inside(v, 10, 4, 10), true) // underground
 * assertEquals(inside(v, 30, b.floors[0] + 1, 30), true)
 * assertEquals(inside(v, 30, b.top + 1, 30), false)
 * ```
 */
export let inside = (v: Vale, x: number, y: number, z: number): boolean => {
  if (y < floorUnder(v, x, y, z) + 0.3) return true
  return !!within(v, x, y, z)
}
