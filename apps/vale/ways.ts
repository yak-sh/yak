// The ways across the world: the roads between levels next to each other, and
// in each level the lanes from its village out to its places. A road runs from
// where a hero arrives in one level to where they arrive in the other, and
// wobbles as a trodden way does; its bed is the lie of the land along it
// (regions.ts), evened out, cut down where it would climb too steeply, and
// never under water, so it is a causeway over a lake. A signpost stands
// beside each end, naming where it leads. Pure numbers from the levels' rows,
// laid once and kept, the same on every page and in every chunk.
import { isA } from './features.ts'
import { LEVELS, type Side, SIZE, type Spot } from './levels.ts'
import { lie } from './regions.ts'
import { clamp, fbm, lerp } from './rand.ts'

/** Ground at or under this height, in metres, is shore: sand, never dry. */
export let SHORE = 5

/** A road's half-width, and how far round it its bed eases into the ground,
 * in metres. */
export let ROAD = 1.5
export let EASE = 3.5
// The lowest a road's bed runs, in metres: dry, a causeway over water.
let DRY = SHORE + 0.3
// How steep a road's bed may run, in metres a metre, and how far either way
// along it its bed is evened out, in metres.
let GRADE = 0.45
let EVEN = 5
// How far along a road from its end, and how far aside it, its signpost
// stands, in metres.
let POST = 18
let ASIDE = 2.75

let norm = (x: number, z: number) => Math.sqrt(x * x + z * z)

/** A way from `a` to `b` that wobbles as a trodden one does, by up to `wob`
 * metres, but for its last `straight` metres; its middle sampled every
 * metre. */
export type Course = {
  a: Spot
  dx: number
  dz: number
  xs: Float64Array
  zs: Float64Array
  box: [number, number, number, number]
}
export let course = (
  a: Spot,
  b: Spot,
  s: number,
  wob = 7,
  straight = 0,
): Course => {
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
  let box: Course['box'] = [
    Math.min(...xs),
    Math.min(...zs),
    Math.max(...xs),
    Math.max(...zs),
  ]
  return { a, dx, dz, xs, zs, box }
}

/** Whether (x, z) may lie within `r` metres of a course: it does not when it
 * lies further than that outside the box round the course's middle. */
export let near = ({ box }: Course, x: number, z: number, r: number) =>
  x > box[0] - r && x < box[2] + r && z > box[1] - r && z < box[3] + r

/** How far along a course (x, z) lies, from 0 at its start to 1 at its
 * end. */
export let along = (c: Course, x: number, z: number) =>
  clamp(
    ((x - c.a[0]) * c.dx + (z - c.a[1]) * c.dz) / (c.dx * c.dx + c.dz * c.dz),
    0,
    1,
  )

/** How far (x, z) is from a course's middle `t` of the way along it, in
 * metres. */
export let off = (c: Course, x: number, z: number, t: number) => {
  let f = t * (c.xs.length - 1)
  let i = Math.min(c.xs.length - 2, Math.floor(f)), u = f - i
  return norm(
    x - (c.xs[i] + (c.xs[i + 1] - c.xs[i]) * u),
    z - (c.zs[i] + (c.zs[i + 1] - c.zs[i]) * u),
  )
}

/** A signpost: the level it stands in, where it leads and which way that
 * lies, and where it stands, in world metres. */
export type Sign = { level: string; to: string; side: Side; at: Spot }

/** A road between two levels: its course, from the first's arrival to the
 * second's, the height of its bed every metre along it, and its two
 * signposts. */
export type Road = {
  from: string
  to: string
  c: Course
  bed: Float64Array
  signs: [Sign, Sign]
}

/** Where a hero arrives in a level, in world metres: one of its places. */
export let arriveOf = (id: string): Spot => {
  let lv = LEVELS[id]
  let [x, z] = lv.places[lv.arrive].at
  return [lv.cell[0] * SIZE + x, lv.cell[1] * SIZE + z]
}

let sideTo = (from: string, to: string) =>
  (Object.entries(LEVELS[from].roads) as [Side, string][])
    .find(([, id]) => id == to)![0]

let snap = (x: number) => (Math.floor(x / 0.5) + 0.5) * 0.5

// A road's signpost, `m` metres along it from the end at `t` (0 or 1),
// standing aside to the right of a hero leaving by it.
let post = (c: Course, t: number, level: string, to: string): Sign => {
  let len = c.xs.length - 1
  let i = Math.round(
    t ? len - Math.min(POST, len / 2) : Math.min(POST, len / 2),
  )
  let j = Math.min(len, Math.max(0, i + (t ? -1 : 1)))
  let ux = c.xs[j] - c.xs[i], uz = c.zs[j] - c.zs[i]
  let u = norm(ux, uz) || 1
  return {
    level,
    to,
    side: sideTo(level, to),
    at: [snap(c.xs[i] - (uz / u) * ASIDE), snap(c.zs[i] + (ux / u) * ASIDE)],
  }
}

// The road between two levels' arrivals: its course, its bed graded along
// it, and a signpost at each end.
let road = (from: string, to: string): Road => {
  let s = (LEVELS[from].seed + LEVELS[to].seed) * 101
  let c = course(arriveOf(from), arriveOf(to), s)
  let n = c.xs.length
  let raw = c.xs.map((x, i) => Math.max(DRY, lie(x, c.zs[i])))
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
  return {
    from,
    to,
    c,
    bed: bed.map((h) => Math.max(DRY, h)),
    signs: [post(c, 0, from, to), post(c, 1, to, from)],
  }
}

// Every road, each once, laid the first time one is asked for.
let laid: Road[] | null = null
let ROADS = () =>
  laid ??= Object.values(LEVELS).flatMap((lv) =>
    Object.values(lv.roads).filter((to) => lv.id < to).map((to) =>
      road(lv.id, to)
    )
  )

/** The height of a road's bed `t` of the way along it, in metres. */
export let bedAt = ({ bed }: Road, t: number) => {
  let f = t * (bed.length - 1)
  let i = Math.min(bed.length - 2, Math.floor(f))
  return lerp(bed[i], bed[i + 1], f - i)
}

/** The roads that may pass within `r` metres of the box from (x0, z0) to
 * (x1, z1).
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * // Mossvale's road west, to Birchmere, runs past its village.
 * let [road] = roadsIn(20, 60, 30, 70, 10).filter((r) => r.to == 'mossvale')
 * assertEquals(road.from, 'birchmere')
 * assertEquals(road.signs[1].side, 'west')
 * ```
 */
export let roadsIn = (
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  r: number,
): Road[] =>
  ROADS().filter(({ c: { box } }) =>
    box[0] - r < x1 && box[2] + r > x0 && box[1] - r < z1 && box[3] + r > z0
  )

/** Every signpost within `r` metres of (x, z). */
export let signsNear = (x: number, z: number, r: number): Sign[] =>
  roadsIn(x, z, x, z, r + POST).flatMap((road) =>
    road.signs.filter((s) => norm(s.at[0] - x, s.at[1] - z) < r)
  )

/** The roads out of a level. */
export let roadsOf = (id: string): Road[] =>
  ROADS().filter((r) => r.from == id || r.to == id)

// Each level's lanes, from its village out to each of its places.
let lanes = new Map<string, Course[]>()
let lanesOf = (id: string): Course[] => {
  let got = lanes.get(id)
  if (got) return got
  let lv = LEVELS[id]
  let [ox, oz] = [lv.cell[0] * SIZE, lv.cell[1] * SIZE]
  let world = (at: Spot): Spot => [ox + at[0], oz + at[1]]
  let home = Object.values(lv.places).find((p) => isA(p.kind, 'village'))
  got = !home ? [] : Object.values(lv.places)
    .filter((p) => norm(p.at[0] - home.at[0], p.at[1] - home.at[1]) >= 1)
    .map((p) => course(world(home.at), world(p.at), lv.seed * 101))
  lanes.set(id, got)
  return got
}

// The levels whose cells lie within a cell of the box.
let levelsIn = (x0: number, z0: number, x1: number, z1: number) => {
  let [gx0, gz0] = [Math.floor(x0 / SIZE) - 1, Math.floor(z0 / SIZE) - 1]
  let [gx1, gz1] = [Math.floor(x1 / SIZE) + 1, Math.floor(z1 / SIZE) + 1]
  return Object.values(LEVELS).filter(({ cell: [gx, gz] }) =>
    gx >= gx0 && gx <= gx1 && gz >= gz0 && gz <= gz1
  )
}

/** The lanes that may pass within `r` metres of the box from (x0, z0) to
 * (x1, z1). */
export let lanesIn = (
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  r: number,
): Course[] =>
  levelsIn(x0, z0, x1, z1).flatMap((lv) => lanesOf(lv.id)).filter(({ box }) =>
    box[0] - r < x1 && box[2] + r > x0 && box[1] - r < z1 && box[3] + r > z0
  )

// How far round a lane, as a share of its width there, and round a road, in
// metres, nothing grows or stands.
let LANE = 1.3
let CLEAR = ROAD + 1.5

/** How far a point is from the nearest of `lanes`, as a share of the lane's
 * width there: a lane widens as it goes, to 1.6 times as wide. Only a lane
 * it may lie within a lane's width of is measured; further off, how far does
 * not matter. */
export let toLane = (lanes: Course[], x: number, z: number) => {
  let best = Infinity
  for (let c of lanes) {
    if (!near(c, x, z, LANE * 1.6)) continue
    let t = along(c, x, z)
    best = Math.min(best, off(c, x, z, t) / (0.6 + t))
  }
  return best
}

/** How far a point is from the middle of the nearest of `roads`, in metres.
 * Only a road it may lie within `r` of is measured. */
export let toRoad = (roads: Road[], x: number, z: number, r = CLEAR) => {
  let best = Infinity
  for (let { c } of roads) {
    if (near(c, x, z, r)) best = Math.min(best, off(c, x, z, along(c, x, z)))
  }
  return best
}

/** Whether a point this far from the nearest lane, in lane widths, and road,
 * in metres, is on or beside one, where nothing grows. */
export let worn = (lane: number, road: number) => lane < LANE || road < CLEAR

/** Whether (x, z) is on or beside a road or a lane, where nothing grows. */
export let trodden = (x: number, z: number): boolean =>
  worn(
    toLane(lanesIn(x, z, x, z, 2), x, z),
    toRoad(roadsIn(x, z, x, z, CLEAR), x, z),
  )
