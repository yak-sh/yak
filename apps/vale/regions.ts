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
// neighbours, and every page with every other. A point far out past the last
// level lies in the nearest.
import { type Feature, FEATURES } from './features.ts'
import { LEVELS, SIZE, type Spot } from './levels.ts'
import { fbm, lerp, smooth } from './rand.ts'

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
 * assertEquals(originOf('birchmere'), [-128, 0])
 * ```
 */
export let originOf = (id: string): Spot => {
  let [gx, gz] = LEVELS[id]?.cell ?? [0, 0]
  return [gx * SIZE, gz * SIZE]
}

/** Every place of every level, in the order they shape the ground: those
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

/** A level's places, in world metres. */
export let placesOf = (id: string): Placed[] =>
  PLACES.filter((p) => p.level == id)

/** Where a place of a level lies, in world metres.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { LEVELS } from './levels.ts'
 * let [x, z] = LEVELS.birchmere.places.mere.at
 * assertEquals(spotOf('birchmere', 'mere'), [x - 128, z])
 * ```
 */
export let spotOf = (id: string, place: string): Spot | undefined => {
  let p = LEVELS[id]?.places[place]
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
  got = PLACES.filter((p) => {
    let r = Math.max(p.reach, p.holds)
    let dx = Math.max(gx * SIZE - p.at[0], 0, p.at[0] - (gx + 1) * SIZE)
    let dz = Math.max(gz * SIZE - p.at[1], 0, p.at[1] - (gz + 1) * SIZE)
    return norm(dx, dz) < r
  })
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

// Where a region's ground is decided: the middle of its level's cell, and
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

/** Which region (x, z) lies in, and how near its border.
 *
 * ```ts
 * import { assert, assertEquals } from '@std/assert'
 * import { LEVELS } from './levels.ts'
 * // A level's places lie in its region, its village well inside it.
 * assertEquals(blend(64, 64).a, 'mossvale')
 * assertEquals(blend(-64, 64).a, 'birchmere')
 * assertEquals(blend(64, 64).t, 1)
 * // Far out past every level, still a level's.
 * assert(LEVELS[blend(5000, 64).a])
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
  for (let k = gz - 2; k <= gz + 2; k++) {
    for (let i = gx - 2; i <= gx + 2; i++) {
      for (let s of sited.get(`${i} ${k}`) ?? []) see(s)
    }
  }
  // A site further out than the cells looked at is two cells off at least:
  // look at every one when the two nearest found are further than that.
  if (d2 > 2 * SIZE) SITES.forEach(see)
  return { a, b, t: 0.5 + 0.5 * smooth(0, EDGE, d2 - d1) }
}

/** The levels whose cells lie within `r` metres of (x, z), nearest first.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(levelsNear(64, 64, 10), ['mossvale'])
 * assertEquals(levelsNear(4, 64, 10), ['mossvale', 'birchmere'])
 * ```
 */
export let levelsNear = (x: number, z: number, r: number): string[] => {
  let gap = ([gx, gz]: [number, number]) =>
    norm(
      Math.max(gx * SIZE - x, 0, x - (gx + 1) * SIZE),
      Math.max(gz * SIZE - z, 0, z - (gz + 1) * SIZE),
    )
  return Object.values(LEVELS).filter((lv) => gap(lv.cell) < r)
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
