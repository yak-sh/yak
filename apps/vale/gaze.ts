// Where a villager looks. Their body faces the way they walk. Standing, with
// a hero near, they turn their head to look at them, as far as a neck turns,
// and turn their body only once the hero has stood behind them a while, and
// then slowly; talking to a hero, they turn to face them. The head eases,
// never snaps, and looks ahead again as the hero goes or the villager sets
// off. Whom they heed and the way they walk come in the frame (play.ts), the
// same on every page; this is the step each page takes from them.
import { turn } from './sim.ts'

// How near a villager notices a hero, in metres.
let LOOK = 8
// How far a head turns from the body, either way, in radians.
let NECK = 1.2
// How long a hero stands where the head cannot follow before the body turns,
// in seconds.
let WAIT = 1.6
// How fast the body turns to a hero, in radians a second: slowly, or sooner
// to one who talks to them.
let SLOW = 1
let TALKING = 3
// How near facing the hero a turning body stops.
let FACED = 0.1
// How quickly the head eases to where it looks.
let EASE = 4

let wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
let clamp = (a: number, k: number) => Math.max(-k, Math.min(k, a))

type Spot = { x: number; z: number }

/**
 * The hero a villager at (x, z) heeds: the nearest one near enough to notice,
 * whoever's page plays them, and how far they are.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let heroes = [{ x: 5, z: 0 }, { x: 0, z: 3 }, { x: 1, z: 1 }]
 * assertEquals(heed(0, 0, heroes.slice(0, 2)), { x: 0, z: 3, near: 3 })
 * assertEquals(heed(0, 20, heroes), null)
 * ```
 */
export let heed = (x: number, z: number, heroes: Iterable<Spot>) => {
  let best: (Spot & { near: number }) | null = null
  for (let h of heroes) {
    let near = Math.hypot(h.x - x, h.z - z)
    if (near < LOOK && near < (best?.near ?? Infinity)) {
      best = { x: h.x, z: h.z, near }
    }
  }
  return best
}

/** How a villager holds themself: which way their body faces and their eyes
 * look, as bearings, and how long a hero has stood where the head cannot
 * follow. */
export type Gaze = { body: number; eye: number; wait: number }

/** What a villager sees this frame: where they are, the way they walk or
 * null while they stand, and the hero they heed, if one, and whether that
 * hero is near enough to talk. */
export type Sight = {
  x: number
  z: number
  walk: number | null
  heed: { x: number; z: number; talk: boolean } | null
}

/**
 * How a villager holds themself `dt` seconds on from `g`.
 *
 * ```ts
 * import { assert, assertAlmostEquals, assertEquals } from '@std/assert'
 * let run = (walk: number | null, at: number, talk: boolean, secs: number) => {
 *   let g = { body: 0, eye: 0, wait: 0 }
 *   let heed = { x: 5 * Math.sin(at), z: 5 * Math.cos(at), talk }
 *   let s = { x: 0, z: 0, walk, heed }
 *   for (let i = 0; i < secs * 20; i++) g = gaze(g, s, 0.05)
 *   return g
 * }
 * // Walking, they face the way they walk and look ahead.
 * let g = run(2, -1, false, 2)
 * assertEquals(g.body, 2)
 * assertAlmostEquals(neck(g.eye, 2), 0, 0.01)
 * // Standing, they turn their head to a hero beside them, not their body,
 * // and it eases there.
 * assertEquals(run(null, 1, false, 2).body, 0)
 * assertAlmostEquals(neck(run(null, 1, false, 2).eye, 0), 1, 0.01)
 * assert(neck(run(null, 1, false, 0.1).eye, 0) < 0.5)
 * // A hero behind them: the head turns as far as a neck goes; a while later
 * // the body turns, slowly, until it faces them.
 * assertEquals(run(null, 3, false, 1).body, 0)
 * assertAlmostEquals(neck(run(null, 3, false, 1).eye, 0), 1.2, 0.05)
 * assert(run(null, 3, false, 2.5).body < 1)
 * assertAlmostEquals(run(null, 3, false, 6).body, 3, 0.1)
 * // Talking to them, they turn to face them.
 * assertAlmostEquals(run(null, 2, true, 1).body, 2, 0.1)
 * ```
 */
export let gaze = (g: Gaze, s: Sight, dt: number): Gaze => {
  let h = s.heed
  let at = h ? Math.atan2(h.x - s.x, h.z - s.z) : 0
  let body = s.walk ?? g.body
  let off = Math.abs(wrap(at - body))
  let wait = s.walk != null || !h
    ? 0
    : h.talk
    ? WAIT
    : g.wait >= WAIT
    ? off < FACED ? 0 : g.wait
    : off > NECK
    ? g.wait + dt
    : 0
  if (h && wait >= WAIT) body = turn(body, at, dt * (h.talk ? TALKING : SLOW))
  let look = h && (s.walk == null || h.talk)
    ? body + clamp(wrap(at - body), NECK)
    : body
  let eye = g.eye + wrap(look - g.eye) * (1 - Math.exp(-dt * EASE))
  return { body, eye, wait }
}

/** How far the head turns from a body facing `yaw` to look toward `eye`,
 * within a neck's reach. */
export let neck = (eye: number, yaw: number) => clamp(wrap(eye - yaw), NECK)

/** Ease a hero's head toward a selected target, or back ahead when none is
 * held. The body bearing is only read; it is not steered toward the target.
 *
 * ```ts
 * import { assertAlmostEquals } from '@std/assert'
 * let at = { x: 0, z: 0, yaw: 0 }
 * let eye = 0
 * for (let i = 0; i < 30; i++) eye = focus(eye, at, { x: 4, z: 4 }, 0.05)
 * assertAlmostEquals(eye, Math.PI / 4, 0.01)
 * for (let i = 0; i < 30; i++) eye = focus(eye, at, null, 0.05)
 * assertAlmostEquals(eye, 0, 0.01)
 * assertAlmostEquals(focus(0, at, { x: 0, z: -4 }, 1), 1.2, 0.01)
 * assertAlmostEquals(neck(-Math.PI + 0.1, Math.PI - 0.1), 0.2)
 * assertAlmostEquals(focus(0, { ...at, yaw: Math.PI / 2 },
 *   { x: 4, z: 0 }, 1), 0)
 * ```
 */
export let focus = (
  eye: number,
  at: Spot & { yaw: number },
  target: Spot | null,
  dt: number,
) => {
  let toward = target && (target.x != at.x || target.z != at.z)
    ? Math.atan2(target.x - at.x, target.z - at.z)
    : at.yaw
  let wanted = neck(toward, at.yaw)
  return eye + (wanted - eye) * (1 - Math.exp(-dt * 8))
}
