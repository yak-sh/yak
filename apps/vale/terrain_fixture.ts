// Grown flat patches for the foundation example, kept before it measures ground.
import { adopt, flat, type Wall } from './terrain.ts'

let grown = (
  high: number | ((x: number, z: number) => number),
  walls: Wall[] = [],
  chunks = [[3, 3]],
) => {
  let v = flat(high, walls)
  for (let [ci, ck] of chunks) adopt(v, v.grow(ci, ck))
  return v
}

export let levelGround = grown(5)
export let fallenGround = grown((x) => x < 50 && x > 49.5 ? 3.5 : 5)
export let trunkGround = grown(5, [{ x: 10, z: 10, r: 0.5, top: 9 }], [
  [0, 0],
  [1, 1],
])
export let slidingGround = grown(5, [{ x: 21, z: 20, r: 0.5, top: 9 }], [[
  1,
  1,
]])
export let rockGround = grown(5, [{ x: 22.5, z: 20, r: 0.8, top: 6 }], [[1, 1]])
export let ledgeGround = grown(
  (x, z) => x > 21.5 && z > 20 && z < 20.25 ? 6 : 5,
  [],
  [[1, 1]],
)
