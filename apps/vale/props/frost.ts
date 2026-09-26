// The props of the frost: spruce heavy with snow, snowy rock, glacier ice.
import { ball, box, key, type Vox } from '../mesh.ts'
import { noise, stream } from '../rand.ts'
import { boulders, type Kind, type Model, pickOf } from './kit.ts'

// A spruce heavy with snow.
let spruce = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 9 + Math.floor(r() * 4)
  box(v, [0, 0, 0], [0, 2, 0], 0x6b4a33)
  let dark = pickOf(r, [0x2f5f43, 0x356b4a, 0x2a5a3e])
  for (let y = 2; y < tall; y++) {
    let t = (y - 2) / (tall - 2)
    let rad = (1 - t) * 3.2 + (y % 2) * 0.6
    ball(v, [0, y, 0], rad, (x, yy, z) => {
      if (yy != y) return null
      let edge = Math.hypot(x, z) > rad - 1.2
      return y % 2 && edge ? 0xf1f4f6 : dark
    })
  }
  v.set(key(0, tall, 0), 0xf1f4f6)
  return { vox: v, size: 0.5 }
}

// Grey rock with snow lying on it.
let snowrock = boulders([0x8f8e86, 0xa3a198, 0x7f7e77], 0xf1f4f6)

// A block of glacier ice, jagged on top.
let serac = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let blues = [0xcfe8f4, 0xa6d4ec, 0xe8f6fc]
  ball(
    v,
    [0, 1, 0],
    1.8 + r(),
    (x, y, z) =>
      y < 0 || noise(x * 0.9, z * 0.9 + y, seed % 89) < 0.25
        ? null
        : blues[(x + y + z) & 1 ? 0 : y % 3],
  )
  let tall = 3 + Math.floor(r() * 3)
  box(v, [0, 2, 0], [0, tall + 2, 0], blues[2])
  return { vox: v, size: 0.5 }
}

export let FROST: Record<string, Kind> = {
  spruce: { make: spruce, shapes: 5, girth: 0.45 },
  snowrock: { make: snowrock, shapes: 5, solid: true },
  serac: { make: serac, shapes: 5, solid: true },
}
