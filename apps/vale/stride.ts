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
