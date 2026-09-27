// The doors of the world's buildings, drawn with the chunk each building
// stands in (world.ts), and taken down with it. Each leaf hangs at its hinge
// (buildings/kit.ts `Door`) and swings in while anyone is near it, the hero,
// the others or a villager, and back when they have gone: the same rule on
// every page, and the one a walker meets (solid.ts `opensFor`). A leaf is
// planks an eighth of a metre across, battened and braced on the inside, with
// strap hinges and a ring on the outside.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import type { Door } from './buildings/kit.ts'
import { shade } from './buildings/kit.ts'
import { blob, box, key, metal, out, pack, type Vec, type Vox } from './mesh.ts'
import { type Building, opensFor } from './solid.ts'
import { geometry } from './soft.ts'

// A leaf's voxel edge, in metres, and how far it swings, in radians.
let E = 0.125
let SWING = 1.75
let IRON = metal(0x33333a)

// A leaf `w` by `h` voxels, its outside toward +z when `out` is 1.
let leaf = (w: number, h: number, color: number, face: number): Vox => {
  let v: Vox = new Map()
  for (let x = 0; x < w; x++) {
    let c = (x >> 1) & 1 ? color : shade(color, 0.9)
    box(v, [x, 0, 0], [x, h - 1, 0], c)
  }
  for (let y of [2, h - 3]) {
    box(v, [1, y, -face], [w - 2, y, -face], shade(color, 0.8))
  }
  for (let x = 1; x < w - 1; x++) {
    let y = Math.round(2 + (h - 5) * (x / (w - 1)))
    v.set(key(x, y, -face), shade(color, 0.8))
  }
  for (let y of [2, h - 3]) {
    box(v, [0, y, face], [Math.ceil(w * 0.6), y, face], IRON)
  }
  v.set(key(w - 2, h >> 1, face), IRON)
  v.set(key(w - 2, (h >> 1) - 1, face), metal(0xc8a84a))
  return v
}

// Which way a leaf's +x runs when it has swung `k` of the way open.
let yawOf = (d: Door, k: number) => {
  let a = k * SWING
  let x = d.along[0] * Math.cos(a) + d.into[0] * Math.sin(a)
  let z = d.along[1] * Math.cos(a) + d.into[1] * Math.sin(a)
  return Math.atan2(-z, x)
}

/** One world's door shapes and the leaves hung from them. */
export let doors = (scene: THREE.Scene, material: THREE.Material) => {
  let made = new Map<string, THREE.BufferGeometry>()
  let hanging = new Set<THREE.Mesh>()
  let gone = false
  let shape = (d: Door, face: number) => {
    let w = Math.round(d.wide / E), h = Math.round(d.tall / E)
    let id = `${w} ${h} ${d.color} ${face}`
    let g = made.get(id)
    if (!g) {
      let at: Vec = [0, 0, -E / 2]
      made.set(
        id,
        g = geometry(pack(blob(out(), leaf(w, h, d.color, face), E, at))),
      )
    }
    return g
  }
  let hang = (buildings: Building[]) => {
    if (gone) throw new Error('doors: disposed')
    let hung = buildings.flatMap((b) => b.doors).map((d) => {
      // A leaf's +z, shut, faces (−along.z, along.x): its outside when that is
      // away from where it swings.
      let face = d.into[0] * -d.along[1] + d.into[1] * d.along[0] < 0 ? 1 : -1
      let mesh = new THREE.Mesh(shape(d, face), material)
      mesh.position.set(...d.hinge)
      mesh.rotation.y = yawOf(d, 0)
      mesh.castShadow = true
      mesh.receiveShadow = true
      scene.add(mesh)
      hanging.add(mesh)
      return { d, mesh, open: 0 }
    })
    return {
      /** Swing each door toward open while someone in `near` is near it. */
      swing: (near: Vec[], dt: number) => {
        let k = 1 - Math.exp(-dt * 9)
        for (let h of hung) {
          let to = near.some(([x, y, z]) => opensFor(h.d, x, y, z)) ? 1 : 0
          if (Math.abs(to - h.open) < 1e-3) continue
          h.open += (to - h.open) * k
          h.mesh.rotation.y = yawOf(h.d, h.open)
        }
      },
      /** Take leaves down; keep their shape for the next chunk. */
      drop: () => {
        for (let h of hung) {
          scene.remove(h.mesh)
          hanging.delete(h.mesh)
        }
      },
    }
  }
  let dispose = () => {
    if (gone) return
    gone = true
    for (let mesh of hanging) scene.remove(mesh)
    hanging.clear()
    for (let g of made.values()) g.dispose()
    made.clear()
  }
  return { hang, dispose }
}

export type Hung = ReturnType<ReturnType<typeof doors>['hang']>
