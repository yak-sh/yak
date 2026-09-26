// The props of the marshes: reeds, and trees long drowned.
import { box, key, type Vox } from '../mesh.ts'
import { stream } from '../rand.ts'
import { type Kind, type Model, pickOf } from './kit.ts'

let reed = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let n = 3 + Math.floor(r() * 4)
  for (let i = 0; i < n; i++) {
    let x = Math.floor(r() * 5) - 2, z = Math.floor(r() * 5) - 2
    let tall = 5 + Math.floor(r() * 5)
    box(v, [x, 0, z], [x, tall, z], pickOf(r, [0x7a9a4a, 0x8aa656, 0x6b8c42]))
    if (r() < 0.6) box(v, [x, tall + 1, z], [x, tall + 2, z], 0x6e4a2e)
  }
  return { vox: v, size: 0.125 }
}

// A tree long dead: a bare grey trunk and a few crooked limbs.
let deadtree = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 12 + Math.floor(r() * 7)
  let bark = pickOf(r, [0x6b5d50, 0x5a5048, 0x7a6d5e])
  box(v, [0, 0, 0], [1, tall, 1], bark)
  for (let i = 0; i < 3 + Math.floor(r() * 2); i++) {
    let y = 5 + Math.floor(r() * (tall - 5))
    let [dx, dz] = pickOf(r, [[1, 0], [-1, 0], [0, 1], [0, -1]])
    let x = dx > 0 ? 1 : 0, z = dz > 0 ? 1 : 0
    for (let j = 1; j <= 3 + Math.floor(r() * 3); j++) {
      v.set(key(x + dx * j, y + Math.floor(j / 2), z + dz * j), bark)
    }
  }
  return { vox: v, size: 0.25 }
}

export let MARSH: Record<string, Kind> = {
  reed: { make: reed, shapes: 6, small: true },
  deadtree: { make: deadtree, shapes: 5, girth: 0.35 },
}
