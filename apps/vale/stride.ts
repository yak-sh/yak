// The hero's step: the camera sets every key's direction. Once the hero
// moves, they face the camera's way unless a look drag holds their heading.

import { type Body, walk } from './sim.ts'
import { type Vale } from './terrain.ts'

/** Step as the player asks. Backing away is slower than walking forward.
 *
 * ```ts
 * import { assert, assertAlmostEquals, assertEquals } from '@std/assert'
 * import { flat } from './terrain.ts'
 * let v = flat(5)
 * let b = { x: 20, y: 5, z: 20, vy: 0, yaw: Math.PI, speed: 0, gait: 'idle' }
 * let back = stride(v, b, [0, -1], 0, 0.1, 5)
 * let left = stride(v, b, [-1, 0], 0, 0.1, 5)
 * let right = stride(v, b, [1, 0], 0, 0.1, 5)
 * let ahead = stride(v, b, [0, 1], 0, 0.1, 5)
 * assert(back.z > b.z && back.z - b.z < b.z - ahead.z)
 * assert(left.x < b.x && right.x > b.x)
 * assertEquals([back.yaw, left.yaw, right.yaw, ahead.yaw],
 *   [Math.PI, Math.PI, Math.PI, Math.PI])
 * assertEquals(stride(v, { ...b, yaw: 0 }, [0, 0], 0, 0.1, 5).yaw, 0)
 * assertAlmostEquals(stride(v, b, [1, 0], Math.PI / 2, 0.1, 5).yaw,
 *   -Math.PI / 2)
 * assertEquals(stride(v, b, [0, 1], 0, 0.1, 5, false, true).yaw, b.yaw)
 * ```
 */
export let stride = (
  v: Vale,
  b: Body,
  move: [number, number],
  look: number,
  dt: number,
  speed: number,
  jump = false,
  looking = false,
): Body => {
  let [x, y] = move
  let push = {
    x: Math.cos(look) * x - Math.sin(look) * y,
    z: -Math.sin(look) * x - Math.cos(look) * y,
    jump,
  }
  let n = walk(v, b, push, dt, speed * (y < 0 ? 0.6 : 1))
  let face = look + Math.PI
  return {
    ...n,
    yaw: (x || y) && !looking
      ? Math.atan2(Math.sin(face), Math.cos(face))
      : b.yaw,
  }
}

/** Walk in the hero's own facing direction while the stick or keys turn them.
 * Unlike camera-relative strafing, sideways input never translates sideways.
 *
 * ```ts
 * import { assert, assertAlmostEquals, assertEquals } from '@std/assert'
 * import { flat } from './terrain.ts'
 * let v = flat(5)
 * let b = { x: 20, y: 5, z: 20, vy: 0, yaw: Math.PI, speed: 0, gait: 'idle' as const }
 * let turn = steerStep(v, b, [1, 0], 0.1, 5)
 * assertAlmostEquals(turn.yaw, Math.PI - 0.3)
 * assertEquals([turn.x, turn.z], [b.x, b.z])
 * let go = steerStep(v, b, [0, 1], 0.1, 5)
 * assert(go.z < b.z)
 * let arc = steerStep(v, b, [0.5, 0.5], 0.1, 5)
 * assert(arc.x > b.x && arc.z < b.z)
 * let back = steerStep(v, b, [0, -1], 0.1, 5)
 * assert(back.z > b.z && back.z - b.z < b.z - go.z)
 * ```
 */
export let steerStep = (
  v: Vale,
  b: Body,
  stick: [number, number],
  dt: number,
  speed: number,
  jump = false,
): Body => {
  let [turn, forward] = stick
  let yaw = b.yaw - turn * 3 * dt
  let n = walk(
    v,
    b,
    {
      x: Math.sin(yaw) * forward,
      z: Math.cos(yaw) * forward,
      jump,
    },
    dt,
    speed * (forward < 0 ? 0.6 : 1),
  )
  return { ...n, yaw }
}
