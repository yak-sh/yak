// Grown flat patches for the foundation example, kept before it measures ground.
import { adopt, flat } from './terrain.ts'

let grown = (high: number | ((x: number, z: number) => number)) => {
  let v = flat(high)
  adopt(v, v.grow(3, 3))
  return v
}

export let levelGround = grown(5)
export let fallenGround = grown((x) => x < 50 && x > 49.5 ? 3.5 : 5)
