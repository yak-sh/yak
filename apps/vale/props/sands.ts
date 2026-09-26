// The props of the sands: palms, cactus and wind-worn sandstone.
import { box, key, type Vox } from '../mesh.ts'
import { stream } from '../rand.ts'
import { boulders, type Kind, type Model, pickOf } from './kit.ts'

let palm = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 18 + Math.floor(r() * 8)
  let lean = (r() < 0.5 ? -1 : 1) * (2 + Math.floor(r() * 3))
  let tx = 0
  for (let y = 0; y <= tall; y++) {
    tx = Math.round(lean * (y / tall) ** 2)
    box(v, [tx, y, 0], [tx + 1, y, 1], y % 3 == 0 ? 0x8a6a48 : 0xa8865c)
  }
  box(v, [tx, tall + 1, 0], [tx + 1, tall + 1, 1], 0x4f9a3e)
  for (let [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
    let g = pickOf(r, [0x4f9a3e, 0x5fae48, 0x3f8a36])
    let x = tx + (dx > 0 ? 1 : 0), z = dz > 0 ? 1 : 0
    for (let j = 1; j <= 5 + Math.floor(r() * 3); j++) {
      v.set(key(x + dx * j, tall + 1 - Math.floor((j * j) / 9), z + dz * j), g)
    }
  }
  for (let [x, z] of [[tx - 1, 0], [tx + 2, 1]]) {
    v.set(key(x, tall - 1, z), 0x6e4a2e)
  }
  return { vox: v, size: 0.25 }
}

let cactus = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 9 + Math.floor(r() * 6)
  let skin = (x: number, y: number, z: number) =>
    (x + z) & 1 ? 0x5f9a4a : y % 4 == 0 ? 0x7bb45e : 0x6aa653
  let column = (x: number, z: number, y0: number, y1: number) => {
    for (let y = y0; y <= y1; y++) {
      for (let [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        v.set(key(x + a, y, z + b), skin(x + a, y, z + b))
      }
    }
  }
  column(0, 0, 0, tall)
  for (let side of [-1, 1]) {
    if (r() < 0.25) continue
    let y = 3 + Math.floor(r() * (tall - 6)), x = side < 0 ? -3 : 3
    box(v, [side < 0 ? -2 : 2, y, 0], [side < 0 ? -1 : 2, y + 1, 1], 0x5f9a4a)
    column(x, 0, y, y + 3 + Math.floor(r() * 3))
  }
  if (r() < 0.5) v.set(key(0, tall + 1, 0), pickOf(r, [0xf08aa8, 0xf5d451]))
  return { vox: v, size: 0.25 }
}

// Wind-worn sandstone, warm and bare.
let sandstone = boulders([0xd2a878, 0xe0bc8c, 0xc0925f], null)

export let SANDS: Record<string, Kind> = {
  palm: { make: palm, shapes: 5, girth: 0.4 },
  cactus: { make: cactus, shapes: 5, girth: 0.4 },
  sandstone: { make: sandstone, shapes: 5, solid: true },
}
