// How things move in the world: a walker's step over the voxel ground, and
// where a creature heads next. Plain functions over plain values; the page
// keeps each mover's values in its graph (`position` and `motion`) and calls
// these once a frame.
//
// The ground is a stack of heightfields of voxels, whatever their size: the
// surface, and under it any caves (terrain.ts). A walker steps up half a
// metre without a thought, needs a jump for more, and cannot pass a wall (a
// trunk, a rock), deep water, or a cave's roof too low for it. A building is
// solid as it is drawn (solid.ts): its walls stop a walker, its floors and
// stairs carry it, and its doors open for it unless it is a creature.
import type { Combat } from './beasts.ts'
import { wander } from './rules.ts'
import { beforeFoot, hits, over, shut, standOn } from './solid.ts'
import {
  floorUnder,
  groundAt,
  hearthNear,
  roofOver,
  spaceOf,
  streetsOf,
  type Vale,
  villagesNear,
  wallsNear,
  WATER,
} from './terrain.ts'
import { EDGE } from './streets.ts'
import { nearWay } from './ways.ts'

/** A mover as a frame steps it: where it is, how fast it rises, which way it
 * faces, how fast it went, and its gait. */
export type Body = {
  x: number
  y: number
  z: number
  vy: number
  yaw: number
  speed: number
  gait: string
}

/** Which way a walker is pushed, in world metres, at most 1 long, and
 * whether it jumps. */
export type Push = { x: number; z: number; jump: boolean }

let STEP = 0.55
let GRAVITY = 24
let JUMP = 7.6
export let RADIUS = 0.34

/** How far from a village's fire no creature comes. */
export let SAFE = 15

// How much room a walker needs over its feet, in metres.
let HEAD = 1.75

/** Whether a walker whose feet are at `y` fits at (x, z): nothing over a
 * step above its feet and under its head is in the way, and, for one that
 * `opens` none, no shut door.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { flat } from './terrain.ts'
 * // Flat ground 5 m up, and a trunk at (10, 10).
 * let v = flat(5, [{ x: 10, z: 10, r: 0.5, top: 9 }])
 * assertEquals(fits(v, 20, 20, 5), true)
 * assertEquals(fits(v, 10.3, 10, 5), false) // in the trunk
 * assertEquals(fits(v, 20, 20, 4), false) // ground over a step above its feet
 * ```
 */
export let fits = (
  v: Vale,
  x: number,
  z: number,
  y: number,
  r = RADIUS,
  opens = true,
) => {
  let [g, roof] = spaceOf(v, x, y + STEP, z)
  if (g > y + STEP || roof < y + HEAD) return false
  if (roof == Infinity && g < WATER - 0.7) return false
  for (let w of wallsNear(v, x, z)) {
    let dx = w.x - x, dz = w.z - z, reach = w.r + r
    if (dx * dx + dz * dz < reach * reach && w.top > y + STEP) return false
  }
  if (hits(v, x, z, y + STEP, y + HEAD, r)) return false
  return opens || !shut(v, x, z, y + STEP, y + HEAD, r)
}

/** What a walker whose feet are at `y` stands on at (x, z): the ground, or
 * the top of a wall or of a building's floor, stair or step no more than a
 * step above its feet, as it steps up onto ground.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { flat } from './terrain.ts'
 * // A rock a metre tall at (10, 10), on ground 5 m up.
 * let v = flat(5, [{ x: 10, z: 10, r: 1, top: 6 }])
 * assertEquals(floorAt(v, 10, 10, 6), 6) // on it
 * assertEquals(floorAt(v, 10.5, 10, 5.6), 6) // a jump comes down on it
 * assertEquals(floorAt(v, 14, 10, 6), 5) // past it
 * ```
 */
export let floorAt = (v: Vale, x: number, z: number, y: number) => {
  let g = floorUnder(v, x, y + STEP, z)
  for (let w of wallsNear(v, x, z)) {
    let dx = w.x - x, dz = w.z - z, reach = w.r + RADIUS
    if (w.top > g && w.top <= y + STEP && dx * dx + dz * dz < reach * reach) {
      g = w.top
    }
  }
  return Math.max(g, standOn(v, x, z, y + STEP, RADIUS * 0.6))
}

/** Turn from angle `a` toward `b` by at most `k`, the short way round. */
export let turn = (a: number, b: number, k: number) => {
  let d = Math.atan2(Math.sin(b - a), Math.cos(b - a))
  return a + Math.max(-k, Math.min(k, d))
}

/** One step of a walker: move as pushed, slide along what is in the way,
 * climb a voxel, jump and bump its head, fall. `speed` is metres a second at
 * a full push; one that `opens` doors goes through them.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { flat } from './terrain.ts'
 * let v = flat(5, [{ x: 21, z: 20, r: 0.5, top: 9 }])
 * let b = { x: 20, y: 5, z: 20, vy: 0, yaw: 0, speed: 0, gait: 'idle' }
 * // A trunk ahead: pushed into it at a slant, the walker slides along it.
 * let slid = walk(v, b, { x: 0.7, z: 0.7, jump: false }, 0.1, 5)
 * assertEquals([slid.x, slid.z > 20], [20, true])
 * // A jump leaves the ground.
 * assertEquals(walk(v, b, { x: 0, z: 0, jump: true }, 0.1, 5).gait, 'jump')
 * // Run at a rock a metre tall and jump: up onto it. A ledge of ground as
 * // tall is the same.
 * let run = (at: ReturnType<typeof flat>) => {
 *   let c = b
 *   for (let f = 0; f < 32; f++) {
 *     c = walk(at, c, { x: 1, z: 0, jump: f == 2 }, 1 / 60, 5)
 *   }
 *   return [c.x > 22, c.y]
 * }
 * assertEquals(run(flat(5, [{ x: 22.5, z: 20, r: 0.8, top: 6 }])), [true, 6])
 * let ledge = flat((x, z) => x > 21.5 && z > 20 && z < 20.25 ? 6 : 5)
 * assertEquals(run(ledge), [true, 6])
 * ```
 */
export let walk = (
  v: Vale,
  b: Body,
  push: Push,
  dt: number,
  speed: number,
  keepOut?: (x: number, z: number) => boolean,
  opens = true,
): Body => {
  let air = b.gait == 'jump'
  let wading = groundAt(v, b.x, b.z) < WATER - 0.15
  let pace = speed * (wading ? 0.6 : 1)
  let dx = push.x * pace * dt, dz = push.z * pace * dt
  let len = Math.hypot(dx, dz)
  // The ground a walker's edge meets decides whether it passes, so a cliff
  // stops it a body's width short rather than halfway in.
  let ok = (x: number, z: number) => {
    if (keepOut?.(x, z) && !keepOut(b.x, b.z)) return false
    if (!fits(v, x, z, b.y, RADIUS, opens)) return false
    let mx = x - b.x, mz = z - b.z, m = Math.hypot(mx, mz)
    return !m ||
      fits(v, x + (mx / m) * RADIUS, z + (mz / m) * RADIUS, b.y, 0.05, opens)
  }
  let x = b.x, z = b.z
  if (len > 1e-5) {
    if (ok(b.x + dx, b.z + dz)) [x, z] = [b.x + dx, b.z + dz]
    else if (ok(b.x + dx, b.z)) x = b.x + dx
    else if (ok(b.x, b.z + dz)) z = b.z + dz
  }
  let yaw = Math.hypot(push.x, push.z) > 0.05
    ? turn(b.yaw, Math.atan2(push.x, push.z), dt * 14)
    : b.yaw
  let g = floorAt(v, x, z, b.y)
  let vy = b.vy, y = b.y
  if (!air && push.jump) {
    vy = JUMP
    air = true
  }
  if (!air && y - g > STEP) air = true
  if (air) {
    vy -= GRAVITY * dt
    y += vy * dt
    let roof = Math.min(
      over(v, x, z, b.y + STEP, RADIUS),
      roofOver(v, x, b.y + STEP, z),
    )
    if (vy > 0 && y + HEAD > roof) {
      y = Math.max(b.y, roof - HEAD)
      vy = 0
    }
    if (y <= g) {
      y = g
      vy = 0
      air = false
    }
  } else {
    y = g
    vy = 0
  }
  let moved = Math.hypot(x - b.x, z - b.z) / Math.max(dt, 1e-3)
  return {
    ...b,
    x,
    y,
    z,
    vy,
    yaw,
    speed: moved,
    gait: air ? 'jump' : moved > 3.2 ? 'run' : moved > 0.25 ? 'walk' : 'idle',
  }
}

/** Where a creature is when nothing is after it: where its wandering puts it
 * at time `t` (ms), stood clear of any wall, facing the way it is going.
 * Every page puts it in the same place, so a wandering creature needs no
 * position of its own.
 *
 * ```ts
 * import { assert, assertEquals } from '@std/assert'
 * import { flat } from './terrain.ts'
 * let v = flat(5)
 * let a = rest(v, [60, 60], 5, 7, 1000)
 * assertEquals(a, rest(v, [60, 60], 5, 7, 1000))
 * assert(Math.hypot(a.x - 60, a.z - 60) <= 5)
 * assertEquals(a.y, 5)
 * ```
 */
export let rest = (
  v: Vale,
  home: [number, number],
  roam: number,
  seed: number,
  t: number,
): Body => {
  let clearRoam = openRoam(v, home, roam)
  let clear = ([x, z]: [number, number]): [number, number] => {
    for (let w of wallsNear(v, x, z)) {
      let dx = x - w.x, dz = z - w.z, d = Math.hypot(dx, dz)
      let reach = w.r + RADIUS * 2
      if (d < reach && d > 1e-6) {
        ;[x, z] = [w.x + (dx / d) * reach, w.z + (dz / d) * reach]
      }
    }
    return [x, z]
  }
  let at = (time: number) => {
    let to = beforeFoot(
      v,
      home,
      clear(wander(home, roam, seed, time)),
      RADIUS * 2,
    )
    return clearRoam && Math.hypot(to[0] - home[0], to[1] - home[1]) <=
        roam + 4
      ? to
      : beforeShelter(v, home, to)
  }
  let [x, z] = at(t / 1000)
  let [px, pz] = at((t - 250) / 1000)
  let speed = Math.hypot(x - px, z - pz) / 0.25
  return {
    x,
    y: groundAt(v, x, z),
    z,
    vy: 0,
    yaw: speed > 0.05 ? Math.atan2(x - px, z - pz) : 0,
    speed,
    gait: speed > 0.25 ? 'walk' : 'idle',
  }
}

/** Whether (x, z) is within reach of a village's fire, where no creature
 * comes. */
export let inVillage = (x: number, z: number) => !!hearthNear(x, z, SAFE)

// The fire's rack stays close to its hearth. Creatures give the square,
// village streets and outer ways enough room that a walker can pass.
let SHELTER = 16
let ROOM = 3.5
/** Whether a point, or a disk of radius `r` around it, meets shelter from
 * creatures: the village square, a street, a road or a lane. */
export let sheltered = (v: Vale, x: number, z: number, r = 0): boolean =>
  // `flat()` has no world roads or villages laid in its ground.
  !!v.world && (
    !!hearthNear(x, z, SHELTER + r) || nearWay(x, z, ROOM + r) ||
    villagesNear(x, z, EDGE + ROOM + r).some((s) =>
      streetsOf(v, s).near(x, z, ROOM + 0.9 + r)
    )
  )

// The named world and a creature's home do not change between frames. If
// its whole roam clears every shelter, its wandering needs no path checks.
let open = new WeakMap<Vale, WeakMap<[number, number], Map<number, boolean>>>()
let openRoam = (v: Vale, home: [number, number], roam: number) => {
  let places = open.get(v)
  if (!places) open.set(v, places = new WeakMap())
  let sizes = places.get(home)
  if (!sizes) places.set(home, sizes = new Map())
  let got = sizes.get(roam)
  if (got != null) return got
  // A wall may push the wander point a little beyond its nominal roam.
  let clear = !sheltered(v, ...home, roam + 4)
  sizes.set(roam, clear)
  return clear
}

// Wandering is not a sequence of steps, so a sheltered destination must
// settle at the boundary before it is shown.
let beforeShelter = (v: Vale, from: [number, number], to: [number, number]) => {
  let mid: [number, number] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]
  let lo = 0, hi = sheltered(v, ...mid) ? 0.5 : sheltered(v, ...to) ? 1 : 0
  if (!hi) return to
  for (let i = 0; i < 5; i++) {
    let t = (lo + hi) / 2
    let x = from[0] + (to[0] - from[0]) * t
    let z = from[1] + (to[1] - from[1]) * t
    if (sheltered(v, x, z)) hi = t
    else lo = t
  }
  return [from[0] + (to[0] - from[0]) * lo, from[1] + (to[1] - from[1]) * lo]
}

/** A creature's next step: toward its quarry when it has one, stopping at
 * the edge of its reach, and otherwise back to its wandering. It never comes
 * into a village. */
export let prowl = (
  v: Vale,
  b: Body,
  beast: Combat,
  home: [number, number],
  roam: number,
  seed: number,
  t: number,
  dt: number,
  quarry: { x: number; z: number } | null,
): Body => {
  let back = rest(v, home, roam, seed, t)
  let [gx, gz] = quarry ? [quarry.x, quarry.z] : [back.x, back.z]
  let dx = gx - b.x, dz = gz - b.z
  let d = Math.hypot(dx, dz)
  let stop = quarry ? beast.reach * 0.75 : 0.1
  let far = Math.hypot(b.x - home[0], b.z - home[1]) > roam + 2
  let speed = quarry
    ? beast.speed
    : far
    ? beast.speed * 0.55
    : beast.speed * 0.4
  let push = d > stop
    ? { x: dx / d, z: dz / d, jump: false }
    : { x: 0, z: 0, jump: false }
  let n = walk(v, b, push, dt, speed, (x, z) => sheltered(v, x, z), false)
  if (quarry && d <= stop) n.yaw = turn(b.yaw, Math.atan2(dx, dz), dt * 10)
  return n
}
