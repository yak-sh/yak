// The hero's step: a forward step turns toward travel, while a sideways or
// backward step keeps the hero facing the foe. The camera still sets the
// direction of the keys and the phone's stick.

import { type Body, walk } from './sim.ts'
import { type Vale } from './terrain.ts'

/** Step as the player asks. Backing away is slower than walking forward.
 *
 * ```ts
 * import { assert, assertEquals } from '@std/assert'
 * import { flat } from './terrain.ts'
 * let v = flat(5)
 * let b = { x: 20, y: 5, z: 20, vy: 0, yaw: Math.PI, speed: 0, gait: 'idle' }
 * let back = stride(v, b, [0, -1], 0, 0.1, 5)
 * let left = stride(v, b, [-1, 0], 0, 0.1, 5)
 * let right = stride(v, b, [1, 0], 0, 0.1, 5)
 * let ahead = stride(v, b, [0, 1], 0, 0.1, 5)
 * assert(back.z > b.z && back.z - b.z < b.z - ahead.z)
 * assert(left.x < b.x && right.x > b.x)
 * assertEquals([back.yaw, left.yaw, right.yaw], [b.yaw, b.yaw, b.yaw])
 * assert(stride(v, { ...b, yaw: 0 }, [0, 1], 0, 0.1, 5).yaw != 0)
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
): Body => {
  let [x, y] = move
  let push = {
    x: Math.cos(look) * x - Math.sin(look) * y,
    z: -Math.sin(look) * x - Math.cos(look) * y,
    jump,
  }
  let n = walk(v, b, push, dt, speed * (y < 0 ? 0.6 : 1))
  return y > 0 ? n : { ...n, yaw: b.yaw }
}
