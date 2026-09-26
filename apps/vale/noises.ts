// What the vale sounds like from one frame to the next, beyond what play.ts
// says happened: the footsteps of everyone who walks, the swings and rolls of
// the other players, and the creatures' cries, a growl as each bite winds up
// and a call now and then while they wander. And where each thing that makes
// a sound stands: the heroes and creatures by their eids, the hearth, and the
// water of each lake. sound.ts makes the sounds.
import { BEASTS } from './beasts.ts'
import type { Spot } from './levels.ts'
import type { Mob, Other, Vec3 } from './play.ts'
import type { Body } from './sim.ts'
import { groundAt, type Vale, WATER } from './terrain.ts'

/** Something heard: `of` is the eid of whoever made it, and a creature's
 * body plan (beasts.ts) and size say how it sounds; a hero's plan is
 * `hero`. */
export type Noise =
  | { type: 'step'; of: string; plan: string; size: number }
  | { type: 'swing'; of: string }
  | { type: 'roll'; of: string }
  | { type: 'cry'; of: string; plan: string; size: number; loud: boolean }

/** As much of a frame as is heard. */
export type Scene = {
  body: Body
  others: Pick<Other, 'eid' | 'body' | 'swing' | 'roll'>[]
  mobs: Pick<Mob, 'eid' | 'kind' | 'body' | 'down' | 'bite'>[]
}

// How far a step carries a hero, and a creature of each body plan at size 1,
// in metres; a plan without a stride flies or slithers, and makes no steps.
let STRIDE: Record<string, number> = {
  hero: 1,
  biped: 0.9,
  quadruped: 0.55,
  crawler: 0.4,
  hopper: 1.1,
  slime: 0.9,
  crag: 1,
  bird: 0.3,
}
// A creature that is up calls about this often, in seconds.
let CALL = 18
// Further than this in a frame is not a walk: a rise by the fire, a road.
let LEAP = 4
// How high above its feet a hero is heard, in metres; a creature is heard
// from half its size up.
let HERO = 0.8

/** A listener to the frames: each call hears one, and says what was heard
 * since the last.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let body = (x: number, gait = 'walk') =>
 *   ({ x, y: 5, z: 0, vy: 0, yaw: 0, speed: 3, gait })
 * let hear = noises()
 * let heard = (x: number, swing = 0, bite = -1, gait = 'walk') =>
 *   hear({
 *     body: body(x, gait),
 *     others: [{ eid: 'wren', body: body(40, 'idle'), swing, roll: -1 }],
 *     mobs: [{
 *       eid: 'blob', kind: 'slime', body: body(60, 'idle'), down: false, bite,
 *     }],
 *   }, 'me', 1 / 60, () => 1).map((n) => `${n.type} ${n.of}`)
 * // Ten and a half metres walked is ten steps; standing still, none.
 * let steps = []
 * for (let i = 0; i <= 105; i++) steps.push(...heard(i / 10))
 * assertEquals(steps.length, 10)
 * assertEquals(new Set(steps), new Set(['step me']))
 * assertEquals(heard(10.5, 0, -1, 'idle'), [])
 * // Another hero swings; a creature winds up a bite, once.
 * assertEquals(heard(10.5, 1, -1, 'idle'), ['swing wren'])
 * assertEquals(heard(10.5, 1, 0.1, 'idle'), ['cry blob'])
 * assertEquals(heard(10.5, 1, 0.3, 'idle'), [])
 * ```
 */
export let noises = () => {
  let walked = new Map<string, [number, number, number]>()
  let swung = new Map<string, number>()
  let rolled = new Set<string>()
  let bit = new Map<string, number>()
  return (f: Scene, me: string, dt: number, rand = Math.random): Noise[] => {
    let out: Noise[] = []
    let was = walked
    walked = new Map()
    // A step each stride walked or run; none in the air, rolling or down.
    let walk = (of: string, b: Body, plan: string, size: number) => {
      let stride = (STRIDE[plan] ?? 0) * size
      if (!stride) return
      let [x, z, d] = was.get(of) ?? [b.x, b.z, 0]
      let moved = Math.hypot(b.x - x, b.z - z)
      let on = (b.gait == 'walk' || b.gait == 'run') && moved < LEAP
      let now = on ? d + moved : d
      if (Math.floor(now / stride) > Math.floor(d / stride)) {
        out.push({ type: 'step', of, plan, size })
      }
      walked.set(of, [b.x, b.z, now])
    }
    walk(me, f.body, 'hero', 1)
    let swings = new Map<string, number>(), rolls = new Set<string>()
    for (let o of f.others) {
      walk(o.eid, o.body, 'hero', 1)
      let s = swung.get(o.eid)
      if (s != null && o.swing > s) out.push({ type: 'swing', of: o.eid })
      swings.set(o.eid, o.swing)
      if (o.roll < 0) continue
      if (!rolled.has(o.eid)) out.push({ type: 'roll', of: o.eid })
      rolls.add(o.eid)
    }
    let bites = new Map<string, number>()
    for (let m of f.mobs) {
      let beast = BEASTS[m.kind]
      if (!beast || m.down) continue
      let { plan } = beast.look, size = beast.size
      walk(m.eid, m.body, plan, size)
      let b = bit.get(m.eid) ?? -1
      if (m.bite >= 0 && (b < 0 || m.bite < b)) {
        out.push({ type: 'cry', of: m.eid, plan, size, loud: true })
      } else if (m.bite < 0 && rand() < dt / CALL) {
        out.push({ type: 'cry', of: m.eid, plan, size, loud: false })
      }
      bites.set(m.eid, m.bite)
    }
    ;[swung, rolled, bit] = [swings, rolls, bites]
    return out
  }
}

/** Where each hero and creature of a frame is heard from, by eid. */
export let where = (f: Scene, me: string) => {
  let at = new Map<string, Vec3>()
  let put = (of: string, b: Body, up: number) =>
    at.set(of, [b.x, b.y + up, b.z])
  put(me, f.body, HERO)
  for (let o of f.others) put(o.eid, o.body, HERO)
  for (let m of f.mobs) put(m.eid, m.body, (BEASTS[m.kind]?.size ?? 1) / 2)
  return at
}

/** Where a lake is heard from by ears at `ear`: the nearest of its water to
 * them, out from its middle toward them.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { flat, WATER } from './terrain.ts'
 * // Dry ground, and a pool 8 m across round (60, 60).
 * let v = flat(6)
 * for (let i = 0; i < v.cols; i++) {
 *   for (let k = 0; k < v.cols; k++) {
 *     let d = Math.hypot((i + 0.5) * v.voxel - 60, (k + 0.5) * v.voxel - 60)
 *     if (d < 8) v.h[i + k * v.cols] = 12
 *   }
 * }
 * // Heard from the east, it is at its east shore.
 * assertEquals(shore(v, [60, 60], [100, 12, 60]), [67.5, WATER, 60])
 * // Standing in it, it is all round.
 * assertEquals(shore(v, [60, 60], [62, 12, 60]), [62, WATER, 60])
 * ```
 */
export let shore = (v: Vale, [x, z]: Spot, ear: Vec3): Vec3 => {
  let d = Math.hypot(ear[0] - x, ear[2] - z)
  let [dx, dz] = d ? [(ear[0] - x) / d, (ear[2] - z) / d] : [0, 0]
  let r = 0
  for (let s = 0.5; s <= d; s += 0.5) {
    if (groundAt(v, x + dx * s, z + dz * s) >= WATER) break
    r = s
  }
  return [x + dx * r, WATER, z + dz * r]
}

/** The sounds a level keeps making, by an id of their own, and where each is
 * heard from by ears at `ear`: the fire in its hearth, and each lake. */
export let ambience = (v: Vale, ear: Vec3) => {
  let out: { id: string; kind: 'fire' | 'water'; at: Vec3 }[] = []
  if (v.hearth) {
    let [x, z] = v.hearth
    out.push({
      id: 'hearth',
      kind: 'fire',
      at: [x, groundAt(v, x, z) + 0.5, z],
    })
  }
  for (let [name, p] of Object.entries(v.level.places)) {
    if (p.kind != 'lake') continue
    out.push({ id: `lake:${name}`, kind: 'water', at: shore(v, p.at, ear) })
  }
  return out
}
