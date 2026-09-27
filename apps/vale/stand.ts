// Where each thing a vale places is drawn: off the ground's grid, and off
// every thing near it. The ground is columns on the vale's grid, and a prop
// or a node is a model on a grid of its own: laid where it stands, the top of
// a rock's buried layer lies in the plane of the ground's top, two oaks whose
// crowns meet share planes wherever their voxels line up, and the depth
// buffer flickers between any two faces a step (mesh.ts `STEP`) or less
// apart. So each thing is drawn the fewest steps off where it is placed, a
// step east, a step down and a step south for every step, that keep each
// plane of its parts a step from the ground's and from those of every part
// placed before it that it overlaps. Mostly a step or two, a few more in the
// thickest woods, never a grid's width: where a thing is, and what it does,
// stay where it is placed. A model a vale places is built on sixteenths of a
// metre, so its planes fall in few places past the ground's grid and a free
// step is always near.
import { cuboids } from './boxes.ts'
import {
  type Out,
  out,
  type Profile,
  profileOf,
  STEP,
  type Vec,
} from './mesh.ts'
import { modelProfile } from './props.ts'
import {
  foundation,
  type Prop,
  propsNear,
  standAt,
  type Vale,
} from './terrain.ts'

/** The room a thing takes where it is placed: its low corner and its high
 * one, in metres. */
export type Room = [Vec, Vec]

/** A part of a thing as a spacer sees it: the room it takes, and where its
 * faces' planes lie along each axis, as a distance past the line of the
 * ground's grid before each, in metres. */
export type Part = { room: Room; planes: [number[], number[], number[]] }

/** A thing as a spacer sees it: its parts, drawn together. */
export type Thing = Part[]

// How much further than its room each thing is taken to reach, in metres, so
// two rooms that only touch count as overlapping.
let SLACK = 0.01

// How wide a cell of the grid rooms are looked up by is, in metres.
let CELL = 8

let E = 1e-6

// How much a plane on the ground's counts for, against one on a neighbour's.
let GROUND = 1e6

// All current props fit inside this radius. A larger new prop fails where
// it is meshed until the search radius is raised with it.
let REACH = 20

let mod = (x: number, m: number) => ((x % m) + m) % m

// A set of planes, each where it lies past the grid line before it, `grid`
// apart, to a micron, each only once.
let past = (at: number[], grid: number) => [
  ...new Set(at.map((x) => Number(mod(x, grid).toFixed(6)) % grid)),
]

// Planes `size` apart, one at `at`, each past the grid line before it.
let overlap = ([a, b]: Room, [c, d]: Room) =>
  [0, 1, 2].every((k) =>
    Math.min(b[k], d[k]) - Math.max(a[k], c[k]) > -2 * SLACK
  )

let cells = ([lo, hi]: Room) => {
  let got: string[] = []
  let at = (m: number) => Math.floor(m / CELL)
  for (let i = at(lo[0] - SLACK); i <= at(hi[0] + SLACK); i++) {
    for (let k = at(lo[2] - SLACK); k <= at(hi[2] + SLACK); k++) {
      got.push(`${i} ${k}`)
    }
  }
  return got
}

/** How far a thing drawn `n` steps off is moved from where it is placed, in
 * metres. */
export let off = (n: number): Vec => [n * STEP, -n * STEP, n * STEP]

/** A spacer, over ground whose grid is `grid` metres: given each thing as it
 * is placed, how many steps it is drawn off. The fewest, none if none are
 * needed, that keep its planes a step from the ground's and from those of
 * each thing placed before it that it overlaps; or, where no number of steps
 * under a grid's width can, the fewest that keep them off the ground's and
 * leave the fewest closer to a neighbour's.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let at = (x: number, planes: number[]): Thing => [{
 *   room: [[x, 0, 0], [x + 2, 2, 2]],
 *   planes: [planes, [0.1], [0.1]],
 * }]
 * let next = spacer(0.25)
 * // Off the grid, it is drawn where it is placed; on it, a step off.
 * assertEquals(next(at(0, [0.1])), 0)
 * assertEquals(next(at(10, [0])), 1)
 * // Beside that, on the grid and a step past it: two steps off.
 * assertEquals(next(at(11, [0, 0.005])), 2)
 * // Crowns on one grid that meet part, and one clear of them keeps its own.
 * assertEquals([at(20, [0]), at(21, [0]), at(22, [0]), at(30, [0])].map(next), [
 *   1,
 *   2,
 *   3,
 *   1,
 * ])
 * ```
 */
export let spacer = (grid: number) => {
  let placed = new Map<string, [Part, number][]>()
  let close = (a: number, b: number) => {
    let d = mod(a - b, grid)
    return Math.min(d, grid - d) < STEP - E
  }
  // How many of a thing's planes lie closer than a step to a neighbour's,
  // were it drawn `n` steps off, and closer to the ground's counting for
  // more than all of those: its faces lie on the ground wherever it stands,
  // and a neighbour's only where their rooms are fullest.
  let clashes = (p: Part, n: number, near: [Part, number][]) => {
    let got = 0
    for (let a = 0; a < 3; a++) {
      let o = off(n)[a]
      for (let x of p.planes[a]) {
        if (close(x + o, 0)) got += GROUND
        for (let [u, m] of near) {
          let w = off(m)[a]
          for (let y of u.planes[a]) if (close(x + o, y + w)) got++
        }
      }
    }
    return got
  }
  // The parts placed before that a part's room overlaps.
  let around = (p: Part) => {
    let got: [Part, number][] = []
    for (let c of cells(p.room)) {
      for (let e of placed.get(c) ?? []) {
        if (!got.includes(e) && overlap(e[0].room, p.room)) got.push(e)
      }
    }
    return got
  }
  let add = (t: Thing, n: number) => {
    for (let p of t) {
      for (let c of cells(p.room)) {
        let list = placed.get(c)
        if (list) list.push([p, n])
        else placed.set(c, [[p, n]])
      }
    }
  }
  let next = (t: Thing): number => {
    let near = t.map(around)
    let best = 0, least = Infinity
    for (let n = 0; n * STEP < grid - STEP && least; n++) {
      let got = t.reduce((sum, p, i) => sum + clashes(p, n, near[i]), 0)
      if (got < least) [best, least] = [n, got]
    }
    add(t, best)
    return best
  }
  return Object.assign(next, { add })
}

/** A prop's visible faces and foundation, at its place before spacing. */
export let propAt = (v: Vale, p: Prop): Thing => {
  let own = partOf(
    [p.x, standAt(v, p), p.z],
    modelProfile(p.kind, p.seed, p.turn),
    v.voxel,
  )
  let base = foundation(v, p)
  let t = [own]
  if (base) {
    let [lo, span] = base
    let o = cuboids(out(), [[lo, span, 0x8e8b82]], 0.25, 0.04)
    t.push(partAt([0, 0, 0], o, v.voxel))
  }
  if (radius(t, p.x, p.z) > REACH) {
    throw new Error(`${p.kind} reaches past the prop search radius`)
  }
  return t
}

/** Models placed at `at` as a spacer sees them, a part each, over ground
 * whose grid is `grid` metres: every face of each is a quad, as mesh.ts
 * writes them.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { cuboids } from './boxes.ts'
 * import { out } from './mesh.ts'
 * let post = cuboids(out(), [[[-0.25, 0, -0.25], [0.5, 2.1, 0.5], 0x8a6a4a]])
 * assertEquals(thingAt([10, 5, 20], [post], 0.25), [{
 *   room: [[9.75, 5, 19.75], [10.25, 7.1, 20.25]],
 *   planes: [[0], [0, 0.1], [0]],
 * }])
 * ```
 */
export let thingAt = (at: Vec, models: Out[], grid: number): Thing =>
  models.map((o) => partAt(at, o, grid))

let partAt = (at: Vec, o: Out, grid: number): Part =>
  partOf(at, profileOf(o), grid)

let partOf = (at: Vec, p: Profile, grid: number): Part => {
  let move = (v: Vec): Vec => [v[0] + at[0], v[1] + at[1], v[2] + at[2]]
  return {
    room: [move(p.room[0]), move(p.room[1])],
    planes: [
      past(p.planes[0].map((x) => x + at[0]), grid),
      past(p.planes[1].map((y) => y + at[1]), grid),
      past(p.planes[2].map((z) => z + at[2]), grid),
    ],
  }
}

let radius = (t: Thing, x: number, z: number) =>
  Math.max(
    ...t.map(({ room: [lo, hi] }) =>
      Math.hypot(
        Math.max(Math.abs(lo[0] - x), Math.abs(hi[0] - x)),
        Math.max(Math.abs(lo[2] - z), Math.abs(hi[2] - z)),
      )
    ),
    0,
  )

let id = (p: Prop) => `${p.x}:${p.z}:${p.kind}:${p.seed}:${p.turn ?? 0}`
let stood = new WeakMap<Vale, Map<string, number>>()

/** How many depth steps a prop is drawn off the ground and its neighbours.
 * The connected group of touching props is coloured together, in a fixed
 * order, so either side of a chunk seam gives each one the same place.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { flat } from './terrain.ts'
 * let oak = (x: number) => ({ kind: 'oak', x, z: 50.25, seed: 0 })
 * let v = flat(5, [], [oak(50.25), oak(51.25), oak(80.25)])
 * assertEquals([oak(50.25), oak(51.25), oak(80.25)].map((p) => step(v, p)),
 *   [1, 2, 1])
 * ```
 */
export let step = (v: Vale, p: Prop): number => {
  let cache = stood.get(v)
  if (!cache) stood.set(v, cache = new Map())
  let known = cache.get(id(p))
  if (known != null) return known
  let group = new Map<string, Prop>([[id(p), p]])
  let parts = new Map<string, Thing>()
  for (let queue = [p]; queue.length;) {
    let a = queue.pop()!, ak = id(a)
    let t = parts.get(ak)
    if (!t) parts.set(ak, t = propAt(v, a))
    let r = radius(t, a.x, a.z)
    for (let b of propsNear(v, a.x, a.z, REACH + r)) {
      let bk = id(b)
      if (group.has(bk)) continue
      let u = parts.get(bk)
      if (!u) parts.set(bk, u = propAt(v, b))
      if (!t.some((x) => u.some((y) => overlap(x.room, y.room)))) continue
      group.set(bk, b)
      queue.push(b)
    }
  }
  let next = spacer(v.voxel)
  for (let key of [...group.keys()].sort()) {
    cache.set(key, next(parts.get(key)!))
  }
  return cache.get(id(p))!
}

/** A spacer for nodes drawn among the vale's props and earlier nodes. */
export let among = (v: Vale) => {
  let next = spacer(v.voxel), seen = new Set<string>()
  return (at: Vec, models: Out[]): number => {
    let t = thingAt(at, models.filter((o) => o.pos.length), v.voxel)
    if (!t.length) return 0
    let r = REACH + radius(t, at[0], at[2])
    for (let p of propsNear(v, at[0], at[2], r)) {
      let key = id(p)
      if (seen.has(key)) continue
      next.add(propAt(v, p), step(v, p))
      seen.add(key)
    }
    return next(t)
  }
}
