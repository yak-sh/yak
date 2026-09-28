// How a player's voice is heard by another (D-40615): out to 30 m, fading over
// its last 10, and clearer in front of its speaker than behind them. Asked
// for within earshot and let go past 34 m, so a voice at the edge does not
// flap. The call and the microphone are voicebox.ts's.
import { FALLOFF, type Falloff } from './ears.ts'
import type { Body } from './sim.ts'

/** Where a voice is heard out to, and where it is let go. */
export let EAR = 30
export let FAR = 34
// Where a voice starts to fade.
let FADE = 20

/** Spatialize speech without an additional distance fade. `loud` owns the
 * 20–30 m voice fade: an inverse PannerNode here used to multiply it by
 * another 3/d, making a voice at 20 m only 15% of its intended level.
 * HRTF still places speakers around the listener. */
export let TALK = {
  pan: {
    ...FALLOFF.pan,
    distanceModel: 'inverse',
    refDistance: 1,
    rolloffFactor: 0,
  },
  near: 1,
} satisfies Falloff

/** Level delivered to a listener. Whole through 20 m, then fading to zero
 * at 30 m; behind the speaker it is half as loud as in front. The panner
 * supplies direction only, not an additional attenuation.
 *
 * ```ts
 * import { assert, assertEquals } from '@std/assert'
 * let at = (x: number, z: number, yaw = 0) =>
 *   ({ x, y: 0, z, vy: 0, yaw, speed: 0, gait: 'idle' })
 * assertEquals(loud(at(0, 0), at(0, 5)), 1)
 * assertEquals(loud(at(0, 0), at(0, -5)), 0.5)
 * assertEquals(loud(at(0, 0), at(0, 20)), 1)
 * assertEquals(loud(at(0, 0), at(0, 25)), 0.5)
 * assert(loud(at(0, 0), at(0, 29)) > 0)
 * assertEquals(loud(at(0, 0), at(0, 30)), 0)
 * ```
 */
export let loud = (them: Body, me: Body) => {
  let dx = me.x - them.x, dz = me.z - them.z
  let d = Math.hypot(dx, me.y - them.y, dz)
  let flat = Math.hypot(dx, dz)
  let facing = flat
    ? (Math.sin(them.yaw) * dx + Math.cos(them.yaw) * dz) / flat
    : 1
  let fade = Math.min(1, Math.max(0, (EAR - d) / (EAR - FADE)))
  return fade * (0.75 + 0.25 * facing)
}

/** Whether a voice at `d` metres is wanted, given whether it is heard now. */
export let near = (d: number, held: boolean) => d < (held ? FAR : EAR)
