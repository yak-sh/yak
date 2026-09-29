// What the vale sounds like from one frame to the next, beyond what play.ts
// says happened: the footsteps of everyone who walks, the swings and rolls of
// the other players, and the creatures' cries, a growl as each bite winds up
// and a call now and then while they wander. And where each thing that makes
// a sound stands: the heroes and creatures by their eids, the nearest hearth,
// and the water nearest the ears. sound.ts makes the sounds.
import { BEASTS } from './beasts.ts'
import { isA } from './features.ts'
import type { Spot } from './levels.ts'
import type { Mob, Other, Vec3 } from './play.ts'
import type { Body } from './sim.ts'
import { placesOf, regionOf } from './regions.ts'
import { groundAt, hearthNear, type Vale, WATER } from './terrain.ts'

/** Something heard: `of` is the eid of whoever made it, and a creature's
 * body plan (beasts.ts) and size say how it sounds; a hero's plan is
 * `hero`. */
export type Noise =
  | { type: 'step'; of: string; plan: string; size: number }
  | { type: 'swing'; of: string }
  | { type: 'roll'; of: string }
  | {
    type: 'cry'
    of: string
    kind: string
    plan: string
    size: number
    loud: boolean
  }

/** As much of a frame as is heard. */
export type Scene = {
  body: Body
  others: (Pick<Other, 'eid' | 'swing' | 'roll'> & { body: Body })[]
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
// How far from the ears water is looked for, in metres: further off it is
// not heard (ears.ts `NEAR`).
let REACH = 24
// Every step from the ears water is looked for at, a metre apart out to
// REACH, nearest first.
let AROUND = Array.from({ length: (2 * REACH + 1) ** 2 }, (_, j): Spot => [
  j % (2 * REACH + 1) - REACH,
  Math.floor(j / (2 * REACH + 1)) - REACH,
]).filter(([x, z]) => Math.hypot(x, z) <= REACH)
  .sort(([a, b], [c, d]) => Math.hypot(a, b) - Math.hypot(c, d))
// What a level's water sounds like, by the first of these kinds of place it
// has: a marsh's own, else still water where it has a lake or a pool. The
// sea is still to be given a voice.
let WATERS: [string, 'water' | 'marsh' | 'surf'][] = [
  ['coast', 'surf'],
  ['marsh', 'marsh'],
  ['lake', 'water'],
  ['oasis', 'water'],
]

/** A listener to the frames: each call hears one, and says what was heard
 * since the last.
 *
 * ```ts
 * import { seedDesigns } from './designs_fixture.ts'
 * seedDesigns()
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
        out.push({
          type: 'cry',
          of: m.eid,
          kind: m.kind,
          plan,
          size,
          loud: true,
        })
      } else if (m.bite < 0 && rand() < dt / CALL) {
        out.push({
          type: 'cry',
          of: m.eid,
          kind: m.kind,
          plan,
          size,
          loud: false,
        })
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

/** Where the water nearest ears at `ear` is heard from: the nearest of it
 * within REACH of them, or none.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { flat, WATER } from './terrain.ts'
 * // Dry ground, and a pool 8 m round (60, 60).
 * let v = flat((x, z) => Math.hypot(x - 60, z - 60) < 8 ? 3 : 6, [], [], 1)
 * // Heard from the east, it is at its east shore.
 * assertEquals(shore(v, [70, 12, 60]), [67, WATER, 60])
 * // Standing in it, it is all round.
 * assertEquals(shore(v, [62, 12, 60]), [62, WATER, 60])
 * // Further off, it is not heard.
 * assertEquals(shore(v, [100, 12, 60]), null)
 * ```
 */
export let shore = (v: Vale, [x, , z]: Vec3): Vec3 | null => {
  for (let [i, k] of AROUND) {
    if (groundAt(v, x + i, z + k) < WATER) return [x + i, WATER, z + k]
  }
  return null
}

// The village fire dies out beyond the buildings (their centres sit 13–28 m
// from the hearth). Keep the source only while its quiet tail can be heard.
let HEARD = 30

/** The sounds the world keeps making, by an id of their own, and where each
 * is heard from by ears at `ear`: the nearest village's fire, and the water
 * nearest them, a marsh's, still water's or ocean's by the kinds of place
 * the region they are in has.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { originOf } from './regions.ts'
 * import { flat } from './terrain.ts'
 * import { seedThemes } from './themes_fixture.ts'
 * seedThemes()
 * // A pool 8 m round a spot in a region's cell, in the vale and in a marsh.
 * let heard = (level: string, dx: number) => {
 *   let [ox, oz] = originOf(level), px = ox + 60, pz = oz + 60
 *   let v = flat((x, z) => Math.hypot(x - px, z - pz) < 8 ? 3 : 6, [], [], 1)
 *   return ambience(v, [px + dx, 12, pz]).map((a) => a.kind)
 *     .filter((k) => k != 'fire')
 * }
 * assertEquals(heard('mossvale', 10), ['water'])
 * assertEquals(heard('reedmarsh', 10), ['marsh'])
 * assertEquals(heard('stormhead', 10), ['surf'])
 * // Far from it, it is not heard.
 * assertEquals(heard('mossvale', 40), [])
 * ```
 */
export let ambience = (v: Vale, ear: Vec3) => {
  let out: {
    id: string
    kind: 'fire' | 'forge' | 'water' | 'marsh' | 'surf'
    at: Vec3
  }[] = []
  let fire = hearthNear(ear[0], ear[2], HEARD)
  if (fire) {
    let [x, z] = fire
    out.push({
      id: `hearth:${x},${z}`,
      kind: 'fire',
      at: [x, groundAt(v, x, z) + 0.5, z],
    })
  }
  for (let b of v.buildings(ear[0], ear[2], 30)) {
    for (let g of b.glows) {
      if (!g.fire || Math.hypot(g.at[0] - ear[0], g.at[2] - ear[2]) > 30) {
        continue
      }
      out.push({
        id: `forge:${b.x}:${b.z}`,
        kind: 'forge',
        at: g.at,
      })
    }
  }
  let places = placesOf(regionOf(ear[0], ear[2]))
  let kind = WATERS.find(([k]) => places.some((p) => isA(p.kind, k)))?.[1]
  let at = kind && shore(v, ear)
  if (kind && at) out.push({ id: kind, kind, at })
  return out
}
