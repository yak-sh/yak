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

/** How the engine fades a voice, under `loud`: whole out to 3 m, and halving
 * with each doubling of the distance beyond, as sound does in the open. Talk
 * is at full voice at talking distance, however gently the vale's other
 * sounds are heard up close (ears.ts `FALLOFF`). */
export let TALK = {
  pan: { ...FALLOFF.pan, refDistance: 3, rolloffFactor: 1 },
  near: 1,
} satisfies Falloff

/**
 * How loud a voice from `them` is to `me`, before the engine's own falloff:
 * whole out to 20 m and gone at earshot, and half as loud from behind the
 * speaker as from in front.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let at = (x: number, z: number, yaw = 0) =>
 *   ({ x, y: 0, z, vy: 0, yaw, speed: 0, gait: 'idle' })
 * // Facing +z, toward a listener 5 m ahead.
 * assertEquals(loud(at(0, 0), at(0, 5)), 1)
 * // The same, from behind.
 * assertEquals(loud(at(0, 0), at(0, -5)), 0.5)
 * // Ahead, halfway through the fade, and past earshot.
 * assertEquals(loud(at(0, 0), at(0, 25)), 0.5)
 * assertEquals(loud(at(0, 0), at(0, 31)), 0)
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
