// How things move in the vale: a walker's step over the voxel ground, and
// where a creature heads next. Plain functions over plain values; the page
// keeps each mover's values in its graph (the `body` component) and calls
// these once a frame.
//
// The ground is a heightfield of half-metre voxels. A walker climbs one voxel
// without a thought, needs a jump for two or three, and cannot pass a wall
// (a trunk, a rock, a house), deep water, or the edge of the world.
import { type Beast, wander } from './rules.ts'
import {
  groundAt,
  N,
  PLACES,
  spot,
  V,
  type Vale,
  type Wall,
  WATER,
} from './terrain.ts'

export type Body = {
  x: number
  y: number
  z: number
  vy: number
  yaw: number
  speed: number
  gait: string
  hunts?: string
  bite?: number
}

/** Which way a walker is pushed, in world metres, at most 1 long, and
 * whether it jumps. */
export type Push = { x: number; z: number; jump: boolean }

let SIZE = N * V
let STEP = 0.55
let GRAVITY = 24
let JUMP = 7.6
let RADIUS = 0.34

/** The village's middle, and how far from it no creature comes. */
export let HEARTH = spot(PLACES.plaza)
export let SAFE = 15

// The walls near a point, from a grid of 4 m cells built once per vale.
let CELL = 4
let grids = new WeakMap<Vale, Map<number, Wall[]>>()
let wallsNear = (v: Vale, x: number, z: number): Wall[] => {
  let grid = grids.get(v)
  if (!grid) {
    grid = new Map()
    for (let w of v.walls) {
      let r = Math.ceil((w.r + 1) / CELL)
      let ci = Math.floor(w.x / CELL), ck = Math.floor(w.z / CELL)
      for (let dk = -r; dk <= r; dk++) {
        for (let di = -r; di <= r; di++) {
          let key = (ci + di) * 1024 + ck + dk
          if (!grid.has(key)) grid.set(key, [])
          grid.get(key)!.push(w)
        }
      }
    }
    grids.set(v, grid)
  }
  return grid.get(Math.floor(x / CELL) * 1024 + Math.floor(z / CELL)) ?? []
}

/** Whether a walker whose feet are at `y` fits at (x, z).
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { N } from './terrain.ts'
 * // Flat ground 5 m up, and a trunk at (10, 10).
 * let v = {
 *   h: new Int16Array(N * N).fill(10),
 *   top: new Uint8Array(N * N),
 *   hue: new Float32Array(N * N),
 *   props: [],
 *   walls: [{ x: 10, z: 10, r: 0.5, top: 9 }],
 * }
 * assertEquals(fits(v, 20, 20, 5), true)
 * assertEquals(fits(v, 10.3, 10, 5), false) // in the trunk
 * assertEquals(fits(v, 20, 20, 4), false) // ground over a step above its feet
 * assertEquals(fits(v, -1, 20, 5), false) // off the edge of the world
 * ```
 */
export let fits = (v: Vale, x: number, z: number, y: number, r = RADIUS) => {
  if (x < 1 || z < 1 || x > SIZE - 1 || z > SIZE - 1) return false
  let g = groundAt(v, x, z)
  if (g > y + STEP || g < WATER - 0.7) return false
  for (let w of wallsNear(v, x, z)) {
    let dx = w.x - x, dz = w.z - z, reach = w.r + r
    if (dx * dx + dz * dz < reach * reach && y < w.top) return false
  }
  return true
}

/** Turn from angle `a` toward `b` by at most `k`, the short way round. */
export let turn = (a: number, b: number, k: number) => {
  let d = Math.atan2(Math.sin(b - a), Math.cos(b - a))
  return a + Math.max(-k, Math.min(k, d))
}

/** One step of a walker: move as pushed, slide along what is in the way,
 * climb a voxel, jump, fall. `speed` is metres a second at a full push.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { N } from './terrain.ts'
 * let v = {
 *   h: new Int16Array(N * N).fill(10),
 *   top: new Uint8Array(N * N),
 *   hue: new Float32Array(N * N),
 *   props: [],
 *   walls: [{ x: 21, z: 20, r: 0.5, top: 9 }],
 * }
 * let b = { x: 20, y: 5, z: 20, vy: 0, yaw: 0, speed: 0, gait: 'idle' }
 * // A trunk ahead: pushed into it at a slant, the walker slides along it.
 * let slid = walk(v, b, { x: 0.7, z: 0.7, jump: false }, 0.1, 5)
 * assertEquals([slid.x, slid.z > 20], [20, true])
 * // A jump leaves the ground.
 * assertEquals(walk(v, b, { x: 0, z: 0, jump: true }, 0.1, 5).gait, 'jump')
 * ```
 */
export let walk = (
  v: Vale,
  b: Body,
  push: Push,
  dt: number,
  speed: number,
  keepOut?: (x: number, z: number) => boolean,
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
    if (!fits(v, x, z, b.y)) return false
    let mx = x - b.x, mz = z - b.z, m = Math.hypot(mx, mz)
    return !m ||
      fits(v, x + (mx / m) * RADIUS, z + (mz / m) * RADIUS, b.y, 0.05)
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
  let g = groundAt(v, x, z)
  let vy = b.vy, y = b.y
  if (!air && push.jump) {
    vy = JUMP
    air = true
  }
  if (!air && y - g > STEP) air = true
  if (air) {
    vy -= GRAVITY * dt
    y += vy * dt
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

/** Where a creature is when nothing has moved it yet: where its wandering
 * puts it now. */
export let rest = (
  v: Vale,
  home: [number, number],
  roam: number,
  seed: number,
  t: number,
): Body => {
  let [x, z] = wander(home, roam, seed, t / 1000)
  return { x, y: groundAt(v, x, z), z, vy: 0, yaw: 0, speed: 0, gait: 'idle' }
}

let inVillage = (x: number, z: number) =>
  Math.hypot(x - HEARTH[0], z - HEARTH[1]) < SAFE

/** A creature's next step: toward its quarry when it has one, stopping at
 * the edge of its reach, and otherwise along its wandering. It never comes
 * into the village. */
export let prowl = (
  v: Vale,
  b: Body,
  beast: Beast,
  home: [number, number],
  roam: number,
  seed: number,
  t: number,
  dt: number,
  quarry: { x: number; z: number } | null,
): Body => {
  let [gx, gz] = quarry
    ? [quarry.x, quarry.z]
    : wander(home, roam, seed, t / 1000)
  let dx = gx - b.x, dz = gz - b.z
  let d = Math.hypot(dx, dz)
  let stop = quarry ? beast.reach * 0.75 : 0.25
  let far = Math.hypot(b.x - home[0], b.z - home[1]) > roam + 2
  let speed = quarry
    ? beast.speed
    : far
    ? beast.speed * 0.55
    : beast.speed * 0.3
  let push = d > stop
    ? { x: dx / d, z: dz / d, jump: false }
    : { x: 0, z: 0, jump: false }
  let n = walk(v, b, push, dt, speed, inVillage)
  if (quarry && d <= stop) n.yaw = turn(b.yaw, Math.atan2(dx, dz), dt * 10)
  return n
}
