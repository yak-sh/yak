// The hero's step: movement resolves in the chosen view or hero plane. Keys
// preserve a forward heading; a moving thumbstick faces its direction.

import { type Body, walk } from './sim.ts'
import { type Vale } from './terrain.ts'

/** A direction in the chosen plane, projected onto the world's ground. */
export let stepPush = (look: number, [x, y]: [number, number]) => ({
  x: Math.cos(look) * x - Math.sin(look) * y,
  z: -Math.sin(look) * x - Math.cos(look) * y,
})

/** Step as the player asks. Keyboard backing is slower than walking forward.
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
 * let touch = stride(v, b, [1, 0], 0, 0.1, 5, false, false, true)
 * assert(touch.x > b.x)
 * assertAlmostEquals(touch.yaw, Math.PI / 2)
 * let turned = stride(v, b, [1, 0], -Math.PI / 2, 0.1, 5,
 *   false, false, true)
 * assert(turned.z > b.z && Math.abs(turned.x - b.x) < 1e-9)
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
  faceMove = false,
): Body => {
  let [x, y] = move
  let push = { ...stepPush(look, move), jump }
  let n = walk(v, b, push, dt, speed * (y < 0 && !faceMove ? 0.6 : 1))
  let face = look + Math.PI
  let moving = x || y
  return {
    ...n,
    yaw: moving && faceMove
      ? Math.atan2(push.x, push.z)
      : moving && !looking
      ? Math.atan2(Math.sin(face), Math.cos(face))
      : b.yaw,
  }
}
