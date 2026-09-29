// Where each level lies in the one world: its cell on the lattice, its places
// in world metres, and the ground it holds, its region. A region is the
// ground nearer one of its level's sites (the middle of its cell and each of
// its places) than any other level's, measured after noise has pushed the
// ground about, so a border wanders the way a stream does and never runs
// straight. Near a border two regions blend: `blend` says how much of a point
// is the nearer one's, all of it well inside and half at the border, and what
// covers the ground or grows there is picked by that share (terrain.ts).
//
// And the lie of the land: the ground as the places shape it, each within its
// reach, before roads are laid over it (ways.ts). A place's reach is where its
// shape stops mattering, found by trying the shape, so a kind of place written
// anywhere in features/ needs no reach of its own. Everything here is a pure
// function of where a point is, so a chunk grown alone agrees with its
// neighbours, and every page with every other. Far beyond the authored lands,
// every lattice cell grows another named region.
import { type Feature, FEATURES } from './features.ts'
import { levelAt, levelOf, LEVELS, SIZE, type Spot } from './levels.ts'
import { fbm, hashOf, lerp, smooth } from './rand.ts'

/** A place of a level where it lies in the world: its level, its name, its
 * kind, its feature, and its middle in metres; its shape's noise salt; and
 * how far out its shape and its hold reach, in metres. */
export type Placed = {
  level: string
  name: string
  kind: string
  f: Feature
  at: Spot
  s: number
  reach: number
  holds: number
  /** where it comes in shaping the ground: after every place before it */
  order: number
}

let norm = (x: number, z: number) => Math.sqrt(x * x + z * z)

// How far in from its reach a place's shape fades out, in metres, so that
// past its reach it changes nothing and a point that leaves it off sees no
// step.
let FADE = 6
// How far out a place is measured for its reach, in metres, and the least a
// shape or a hold changes the ground to count, in metres and in hold.
let FAR = 256
let SLIGHT = 0.002

let samples: [number, number, number][] = [
  [3, 37.5, 911.25],
  [12, 604.75, 213.5],
  [6.5, -455.25, -77.75],
]
// How far out a kind shapes the ground, and holds it.
let reaches = new Map<string, [number, number]>()
let reachOf = (kind: string): [number, number] => {
  let got = reaches.get(kind)
  if (got) return got
  let f = FEATURES[kind]
  let shape = 0, holds = 0
  for (let d = FAR; d > 0 && !shape; d -= 2) {
    for (let [h, x, z] of samples) {
      if (Math.abs(f.shape(h, d, x, z, 97) - h) > SLIGHT) shape = d + 2 + FADE
    }
  }
  for (let d = FAR; d > 0 && !holds; d -= 2) {
    if (f.hold(d) > SLIGHT) holds = d + 2
  }
  reaches.set(kind, got = [shape, holds])
  return got
}

/** Where a level's cell starts, its north-west corner, in world metres.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(originOf('mossvale'), [0, 0])
 * assertEquals(originOf('birchmere'), [-256, 0])
 * ```
 */
export let originOf = (id: string): Spot => {
  let [gx, gz] = levelOf(id)?.cell ?? [0, 0]
  return [gx * SIZE, gz * SIZE]
}

/** Every place of the authored levels, in the order they shape the ground: those
 * that flatten what the others raised (features.ts `last`) after the rest. */
export let PLACES: Placed[] = ((): Placed[] => {
  let all = Object.values(LEVELS).flatMap((lv) => {
    let [ox, oz] = originOf(lv.id)
    return Object.entries(lv.places).filter(([, p]) => FEATURES[p.kind]).map((
      [name, p],
    ) => ({
      level: lv.id,
      name,
      kind: p.kind,
      f: FEATURES[p.kind],
      at: [ox + p.at[0], oz + p.at[1]] as Spot,
      s: lv.seed * 101,
      reach: 0,
      holds: 0,
      order: 0,
    }))
  })
  return [
    ...all.filter((p) => !p.f.last),
    ...all.filter((p) => p.f.last),
  ].map((p, order) => ({ ...p, order }))
})()

let grown = new Map<string, Placed[]>()
let grownPlaces = (gx: number, gz: number): Placed[] => {
  let lv = levelAt(gx, gz)
  if (LEVELS[lv.id]) return []
  let got = grown.get(lv.id)
  if (got) return got
  if (grown.size >= 256) grown.delete(grown.keys().next().value!)
  got = Object.entries(lv.places).map(([name, p], order) => ({
    level: lv.id,
    name,
    kind: p.kind,
    f: FEATURES[p.kind],
    at: [gx * SIZE + p.at[0], gz * SIZE + p.at[1]] as Spot,
    s: lv.seed * 101,
    reach: reachOf(p.kind)[0],
    holds: reachOf(p.kind)[1],
    order: PLACES.length + order,
  }))
  grown.set(lv.id, got)
  return got
}

/** A level's places, in world metres. */
export let placesOf = (id: string): Placed[] => {
  let lv = levelOf(id)
  return lv && !LEVELS[id]
    ? grownPlaces(...lv.cell)
    : PLACES.filter((p) => p.level == id)
}

/** Where a place of a level lies, in world metres.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { LEVELS } from './levels.ts'
 * let [x, z] = LEVELS.birchmere.places.mere.at
 * assertEquals(spotOf('birchmere', 'mere'), [x - 256, z])
 * ```
 */
export let spotOf = (id: string, place: string): Spot | undefined => {
  let p = levelOf(id)?.places[place]
  if (!p) return undefined
  let [ox, oz] = originOf(id)
  return [ox + p.at[0], oz + p.at[1]]
}

// The places whose shape or hold may reach into each cell of the lattice, in
// order, found the first time a cell is asked about.
let reaching = new Map<string, Placed[]>()
let measured = false
let cellOf = (m: number) => Math.floor(m / SIZE)
let reachingIn = (gx: number, gz: number): Placed[] => {
  if (!measured) {
    measured = true
    for (let p of PLACES) [p.reach, p.holds] = reachOf(p.kind)
  }
  let key = `${gx} ${gz}`
  let got = reaching.get(key)
  if (got) return got
  let candidates = [
    ...PLACES,
    ...Array.from(
      { length: 25 },
      (_, j) => grownPlaces(gx + j % 5 - 2, gz + Math.floor(j / 5) - 2),
    ).flat(),
  ]
  got = candidates.filter((p) => {
    let r = Math.max(p.reach, p.holds)
    let dx = Math.max(gx * SIZE - p.at[0], 0, p.at[0] - (gx + 1) * SIZE)
    let dz = Math.max(gz * SIZE - p.at[1], 0, p.at[1] - (gz + 1) * SIZE)
    return norm(dx, dz) < r
  })
  if (reaching.size >= 512) reaching.delete(reaching.keys().next().value!)
  reaching.set(key, got)
  return got
}

/** The places whose shape or hold may reach anywhere in the box from
 * (x0, z0) to (x1, z1), in metres, in the order they shape the ground. */
export let placesIn = (
  x0: number,
  z0: number,
  x1: number,
  z1: number,
): Placed[] => {
  let seen = new Set<Placed>()
  for (let gz = cellOf(z0); gz <= cellOf(z1); gz++) {
    for (let gx = cellOf(x0); gx <= cellOf(x1); gx++) {
      for (let p of reachingIn(gx, gz)) {
        let r = Math.max(p.reach, p.holds)
        let dx = Math.max(x0 - p.at[0], 0, p.at[0] - x1)
        let dz = Math.max(z0 - p.at[1], 0, p.at[1] - z1)
        if (norm(dx, dz) < r) seen.add(p)
      }
    }
  }
  return [...seen].sort((a, b) => a.order - b.order)
}

/** The places whose shape or hold may reach (x, z). */
export let placesAt = (x: number, z: number): Placed[] =>
  reachingIn(cellOf(x), cellOf(z))

/** The lie of the land at (x, z), in metres: gently rolling ground, as the
 * places within their reach shape it, in order; `near` the places that may
 * reach it (`placesIn`), when already found.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { seedThemes } from './themes_fixture.ts'
 * seedThemes()
 * // Asked alone, or with every place that may reach a box round it, alike.
 * let x = 37.25, z = 101.75
 * assertEquals(lie(x, z), lie(x, z, placesIn(0, 64, 64, 128)))
 * ```
 */
export let lie = (
  x: number,
  z: number,
  near: Placed[] = placesAt(x, z),
): number => {
  let h = 6.5 + (fbm(x / 22, z / 22, 1) - 0.5) * 4.5
  for (let p of near) {
    let d = norm(x - p.at[0], z - p.at[1])
    if (d >= p.reach) continue
    let to = p.f.shape(h, d, x, z, p.s)
    h = d <= p.reach - FADE
      ? to
      : lerp(h, to, smooth(p.reach, p.reach - FADE, d))
  }
  return h
}

// Where an authored region's ground is decided: the middle of its cell, and
// each of its places, by the cell of the lattice they lie in.
type Site = { level: string; x: number; z: number }
let SITES: Site[] = Object.values(LEVELS).flatMap((lv) => {
  let [ox, oz] = originOf(lv.id)
  return [
    { level: lv.id, x: ox + SIZE / 2, z: oz + SIZE / 2 },
    ...Object.values(lv.places).map((p) => ({
      level: lv.id,
      x: ox + p.at[0],
      z: oz + p.at[1],
    })),
  ]
})
let sited = new Map<string, Site[]>()
for (let s of SITES) {
  let key = `${cellOf(s.x)} ${cellOf(s.z)}`
  sited.set(key, [...sited.get(key) ?? [], s])
}
let sitesIn = (gx: number, gz: number): Site[] => {
  let lv = levelAt(gx, gz)
  let known = sited.get(`${gx} ${gz}`) ?? []
  if (LEVELS[lv.id]) return known
  return [
    ...known,
    { level: lv.id, x: (gx + 0.5) * SIZE, z: (gz + 0.5) * SIZE },
    ...Object.values(lv.places).map((p) => ({
      level: lv.id,
      x: gx * SIZE + p.at[0],
      z: gz * SIZE + p.at[1],
    })),
  ]
}

// How far noise pushes the ground about before a border is decided, at most,
// in metres, and how broad its swings are.
let WARP = 80
let SWING = 60
// How wide a border's blend is, in metres of difference between the two
// sites' distances: about half that either side of the border.
let EDGE = 24

/** The region a point lies in (`a`), the nearest other (`b`), and how much
 * of the point is `a`'s: 1 well inside it, falling to 0.5 at the border. */
export type Blend = { a: string; b: string; t: number }

/** The shape shared by two lands at their border. The pair, rather than the
 * side one approaches from, decides its kind. */
export type Border = { kind: 'open' | 'ridge' | 'river'; strength: number }
let borders = new Map<string, Border['kind']>()
export let borderOf = ({ a, b, t }: Blend): Border => {
  if (!b || t >= 1) return { kind: 'open', strength: 0 }
  let key = [a, b].sort().join('/')
  let kind = borders.get(key)
  if (!kind) {
    let roll = hashOf(key) % 4
    borders.set(key, kind = roll == 0 ? 'river' : roll < 3 ? 'ridge' : 'open')
  }
  return { kind, strength: smooth(1, 0.5, t) }
}

// Heights ask about a border at every voxel corner. Sample it on the world's
// metre grid and blend between samples, so finer voxels do not repeat the
// search for nearby sites. The grid is global, not a chunk's, so seams agree.
export type Boundary = { ridge: number; river: number }
let boundaryGrid = new Map<string, Boundary>()
let sampleBoundary = (x: number, z: number): Boundary => {
  let key = `${x} ${z}`
  let got = boundaryGrid.get(key)
  if (got) return got
  let { kind, strength } = borderOf(blend(x, z))
  if (boundaryGrid.size >= 32768) boundaryGrid.clear()
  boundaryGrid.set(
    key,
    got = {
      ridge: kind == 'ridge' ? strength : 0,
      river: kind == 'river' ? strength : 0,
    },
  )
  return got
}
export let boundaryAt = (x: number, z: number): Boundary => {
  let i = Math.floor(x), k = Math.floor(z), u = x - i, v = z - k
  let a = sampleBoundary(i, k), b = sampleBoundary(i + 1, k)
  let c = sampleBoundary(i, k + 1), d = sampleBoundary(i + 1, k + 1)
  return {
    ridge: lerp(lerp(a.ridge, b.ridge, u), lerp(c.ridge, d.ridge, u), v),
    river: lerp(lerp(a.river, b.river, u), lerp(c.river, d.river, u), v),
  }
}

/** Boundary heights across a box, sampled once on the world's metre grid. */
export let boundariesIn = (x0: number, z0: number, x1: number, z1: number) => {
  let ix = Math.floor(x0), iz = Math.floor(z0)
  let width = Math.ceil(x1) - ix + 2, depth = Math.ceil(z1) - iz + 2
  let ridge = new Float32Array(width * depth)
  let river = new Float32Array(width * depth)
  for (let k = 0; k < depth; k++) {
    for (let i = 0; i < width; i++) {
      let b = sampleBoundary(ix + i, iz + k)
      let j = i + k * width
      ridge[j] = b.ridge
      river[j] = b.river
    }
  }
  return (x: number, z: number): Boundary => {
    let i = Math.floor(x) - ix, k = Math.floor(z) - iz
    if (i < 0 || k < 0 || i + 1 >= width || k + 1 >= depth) {
      return boundaryAt(x, z)
    }
    let u = x - Math.floor(x), v = z - Math.floor(z)
    let interp = (xs: Float32Array) =>
      lerp(
        lerp(xs[i + k * width], xs[i + 1 + k * width], u),
        lerp(xs[i + (k + 1) * width], xs[i + 1 + (k + 1) * width], u),
        v,
      )
    return { ridge: interp(ridge), river: interp(river) }
  }
}

/** Which region (x, z) lies in, and how near its border.
 *
 * ```ts
 * import { assert, assertEquals } from '@std/assert'
 * import { levelOf } from './levels.ts'
 * import { seedThemes } from './themes_fixture.ts'
 * seedThemes()
 * // A level's places lie in its region, its village well inside it.
 * assertEquals(blend(128, 128).a, 'mossvale')
 * assertEquals(blend(-128, 128).a, 'birchmere')
 * assertEquals(blend(128, 128).t, 1)
 * // Far out past every authored level, still a named land.
 * assert(levelOf(blend(5000, 64).a))
 * ```
 */
export let blend = (x: number, z: number): Blend => {
  let wx = x + (fbm(x / SWING, z / SWING, 71, 3) - 0.5) * WARP
  let wz = z + (fbm(x / SWING, z / SWING, 79, 3) - 0.5) * WARP
  let a = '', b = '', d1 = Infinity, d2 = Infinity
  let see = (s: Site) => {
    let d = norm(s.x - wx, s.z - wz)
    if (d < d1) {
      if (s.level != a) [d2, b] = [d1, a]
      ;[d1, a] = [d, s.level]
    } else if (d < d2 && s.level != a) [d2, b] = [d, s.level]
  }
  let gx = cellOf(wx), gz = cellOf(wz)
  for (let k = gz - 1; k <= gz + 1; k++) {
    for (let i = gx - 1; i <= gx + 1; i++) {
      for (let s of sitesIn(i, k)) see(s)
    }
  }
  // A site further out than the cells looked at is two cells off at least:
  // look at every one when the two nearest found are further than that.
  return { a, b, t: 0.5 + 0.5 * smooth(0, EDGE, d2 - d1) }
}

/** The levels whose cells lie within `r` metres of (x, z), nearest first.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(levelsNear(128, 128, 10), ['mossvale'])
 * assertEquals(levelsNear(4, 128, 10), ['mossvale', 'birchmere'])
 * ```
 */
export let levelsNear = (x: number, z: number, r: number): string[] => {
  let gap = ([gx, gz]: [number, number]) =>
    norm(
      Math.max(gx * SIZE - x, 0, x - (gx + 1) * SIZE),
      Math.max(gz * SIZE - z, 0, z - (gz + 1) * SIZE),
    )
  let all = []
  for (let gz = cellOf(z - r); gz <= cellOf(z + r); gz++) {
    for (let gx = cellOf(x - r); gx <= cellOf(x + r); gx++) {
      let lv = levelAt(gx, gz)
      if (gap(lv.cell) < r) all.push(lv)
    }
  }
  return all
    .sort((a, b) => gap(a.cell) - gap(b.cell)).map((lv) => lv.id)
}

/** What each level has (`make`), for the levels whose cells lie within `r`
 * metres of a point: each made the first time it is near, and at most one a
 * call, the nearest first, so a page walking into new country spreads the
 * work over its frames. */
export let nearby = <T>(make: (id: string) => T[]) => {
  let made = new Map<string, T[]>()
  return (x: number, z: number, r: number): T[] => {
    let fresh = false
    return levelsNear(x, z, r).flatMap((id) => {
      let got = made.get(id)
      if (!got && !fresh) {
        fresh = true
        if (made.size >= 64) made.delete(made.keys().next().value!)
        made.set(id, got = make(id))
      }
      return got ?? []
    })
  }
}

/** The region (x, z) lies in: a level's id. */
export let regionOf = (x: number, z: number): string => blend(x, z).a

/** Of a point's two regions, the one a roll in [0, 1) picks: the nearer,
 * as often as the point is its. */
export let pick = (b: Blend, roll: number): string => roll < b.t ? b.a : b.b
