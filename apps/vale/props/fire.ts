// The props of the fire country: cinder and basalt.
import { box, key, type Vox } from '../mesh.ts'
import { stream } from '../rand.ts'
import { boulders, type Kind, type Model, pickOf } from './kit.ts'

// Cinder: black rock the fire spat out.
let cinder = boulders([0x4e4b48, 0x5c5854, 0x423f3c], null)

// Columns of dark basalt, standing close.
let basalt = (seed: number): Model => {
  let r = stream(seed), v: Vox = new Map()
  let darks = [0x3e3c3a, 0x484542, 0x34322f]
  for (let x = -1; x <= 1; x++) {
    for (let z = -1; z <= 1; z++) {
      if (r() < 0.35 && (x || z)) continue
      let tall = 1 + Math.floor(r() * 5) + (x || z ? 0 : 2)
      box(v, [x, 0, z], [x, tall, z], pickOf(r, darks))
      v.set(key(x, tall, z), 0x5a5652)
    }
  }
  return { vox: v, size: 0.5 }
}

export let FIRE: Record<string, Kind> = {
  cinder: { make: cinder, shapes: 5, solid: true },
  basalt: { make: basalt, shapes: 5, solid: true },
}
