// The hero's step: the camera sets every key's direction. Once the hero
// moves, they face the camera's way unless a look drag holds their heading.

import { type Body, walk } from './sim.ts'
import { type Vale } from './terrain.ts'

/** A forward or sideways step in the hero's facing direction. */
export let steerPush = (
  yaw: number,
  steer: { forward: number; side?: number },
) => {
  let { forward, side = 0 } = steer
  return {
    x: Math.sin(yaw) * forward + Math.cos(yaw) * side,
    z: Math.cos(yaw) * forward - Math.sin(yaw) * side,
  }
}

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
 * Turning stays in hero space, including a sideways step made with A/D.
 *
 * ```ts
 * import { assert, assertAlmostEquals, assertEquals } from '@std/assert'
 * import { flat } from './terrain.ts'
 * let v = flat(5)
 * let b = { x: 20, y: 5, z: 20, vy: 0, yaw: Math.PI, speed: 0, gait: 'idle' as const }
 * let turn = steerStep(v, b, { turn: 3, forward: 0 }, 0.1, 5)
 * assertAlmostEquals(turn.yaw, Math.PI - 0.3)
 * assertEquals([turn.x, turn.z], [b.x, b.z])
 * let quick = steerStep(v, b, { turn: 6, forward: 0 }, 0.1, 5)
 * assertAlmostEquals(quick.yaw, Math.PI - 0.6)
 * let go = steerStep(v, b, { turn: 0, forward: 1 }, 0.1, 5)
 * assert(go.z < b.z)
 * let arc = steerStep(v, b, { turn: 1.5, forward: 0.5 }, 0.1, 5)
 * assert(arc.x > b.x && arc.z < b.z)
 * let back = steerStep(v, b, { turn: 0, forward: -1 }, 0.1, 5)
 * assert(back.z > b.z && back.z - b.z < b.z - go.z)
 * let side = steerStep(v, b, { turn: 0, forward: 0, side: 1 }, 0.1, 5)
 * assert(side.x < b.x && side.z == b.z && side.yaw == b.yaw)
 * ```
 */
export let steerStep = (
  v: Vale,
  b: Body,
  steer: { turn: number; forward: number; side?: number },
  dt: number,
  speed: number,
  jump = false,
): Body => {
  let { turn, forward } = steer
  let yaw = b.yaw - turn * dt
  let n = walk(
    v,
    b,
    {
      ...steerPush(yaw, steer),
      jump,
    },
    dt,
    speed * (forward < 0 ? 0.6 : 1),
  )
  return { ...n, yaw }
}
