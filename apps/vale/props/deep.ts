// The props of the deep places: toadstools the size of trees, and crystal.
import { ball, box, key, type Vox } from '../mesh.ts'
import { rand, stream } from '../rand.ts'
import { type Kind, type Model, pickOf } from './kit.ts'

// A toadstool the size of a tree.
let toadstool = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let tall = 10 + Math.floor(r() * 7)
  let cap = pickOf(r, [0xd9493a, 0x9a6ad0, 0x4fb8b0, 0xe89a3a, 0xc85a9a])
  box(v, [0, 0, 0], [1, tall, 1], 0xf1eadb)
  let R = 5 + Math.floor(r() * 3), H = 3 + Math.floor(r() * 2)
  for (let x = -R; x <= R + 1; x++) {
    for (let z = -R; z <= R + 1; z++) {
      let e = ((x - 0.5) ** 2 + (z - 0.5) ** 2) / (R * R)
      if (e > 1) continue
      let high = Math.round(H * Math.sqrt(1 - e))
      v.set(key(x, tall, z), 0xe9dcc4)
      for (let y = 1; y <= high; y++) {
        let spot = y == high && rand(x, z, seed) < 0.12
        v.set(key(x, tall + y, z), spot ? 0xfbf6ea : cap)
      }
    }
  }
  return { vox: v, size: 0.25 }
}

let GEMS = [
  [0x7fe3f0, 0xc2f6fb],
  [0xb58af0, 0xdcc6fb],
  [0xf08ac8, 0xfac6e4],
  [0x8af0b0, 0xc8fad8],
]

// A cluster of crystals, leaning out of a stone.
let crystal = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let [deep, pale] = pickOf(r, GEMS)
  ball(v, [0, 0, 0], 2.5, (_x, y) => y < 0 || y > 1 ? null : 0x7f7e77)
  for (let i = 0; i < 3 + Math.floor(r() * 3); i++) {
    let x = Math.floor(r() * 3) - 1, z = Math.floor(r() * 3) - 1
    let dx = Math.floor(r() * 3) - 1, dz = Math.floor(r() * 3) - 1
    let tall = 6 + Math.floor(r() * 9)
    for (let y = 0; y <= tall; y++) {
      let px = x + Math.floor((dx * y) / 4), pz = z + Math.floor((dz * y) / 4)
      let w = y < tall * 0.7 ? 1 : 0
      box(
        v,
        [px, y + 1, pz],
        [px + w, y + 1, pz + w],
        y > tall - 3 ? pale : deep,
      )
    }
  }
  return { vox: v, size: 0.25 }
}

export let DEEP: Record<string, Kind> = {
  toadstool: { make: toadstool, shapes: 6, girth: 0.6 },
  crystal: { make: crystal, shapes: 6, solid: true },
}
