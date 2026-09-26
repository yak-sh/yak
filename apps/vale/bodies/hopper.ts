// A small thing that hops: a hare with its long ears, a squirrel with its
// bushy tail, a frog wide and flat with its eyes on top. It sits, twitches,
// and bounds away on its hind legs.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import type { Figure } from '../figures.ts'
import { both, type Box, given, partOf, shade } from '../parts.ts'
import { flash, soft } from '../soft.ts'

export type Hopper = {
  fur: number
  belly: number
  eye: number
  ears?: 'long' | 'round'
  tail?: 'puff' | 'bush'
  /** wide and flat, with its eyes on top: a frog or a toad */
  frog?: boolean
}

// A hare's shape, or a frog's: its body, its head, and its hind legs.
let furry = (o: Hopper): [Box[], Box[], Box[]] => [
  [
    [[-0.17, 0.1, -0.24], [0.34, 0.3, 0.44], o.fur],
    [[-0.13, 0.08, -0.12], [0.26, 0.1, 0.32], o.belly],
    [[-0.12, 0.16, 0.16], [0.24, 0.2, 0.06], o.belly],
  ],
  [
    [[-0.13, -0.04, -0.02], [0.26, 0.24, 0.24], o.fur],
    [[-0.07, -0.02, 0.2], [0.14, 0.1, 0.06], o.belly],
    [[-0.025, 0.05, 0.255], [0.05, 0.03, 0.01], 0x3a2a2a],
    ...both([[0.1, 0.08, 0.13], [0.04, 0.05, 0.05], o.eye]),
    ...given(o.ears == 'long' && o.fur, (c) => [
      ...both([[0.04, 0.18, 0.02], [0.07, 0.34, 0.05], c]),
      ...both([[0.055, 0.22, 0.065], [0.04, 0.26, 0.01], shade(o.belly, 0.9)]),
    ]),
    ...given(
      o.ears == 'round' && o.fur,
      (c) => both([[0.08, 0.18, 0.02], [0.09, 0.09, 0.04], c]),
    ),
  ],
  [
    [[-0.05, -0.1, -0.1], [0.1, 0.2, 0.22], o.fur],
    [[-0.05, -0.12, -0.02], [0.1, 0.04, 0.22], shade(o.fur, 0.8)],
  ],
]

let froggy = (o: Hopper): [Box[], Box[], Box[]] => [
  [
    [[-0.24, 0.04, -0.22], [0.48, 0.22, 0.42], o.fur],
    [[-0.2, 0.02, -0.16], [0.4, 0.06, 0.36], o.belly],
    [[-0.12, 0.25, -0.16], [0.24, 0.03, 0.2], shade(o.fur, 0.8)],
  ],
  [
    [[-0.2, -0.04, -0.04], [0.4, 0.17, 0.26], o.fur],
    [[-0.17, -0.06, 0.02], [0.34, 0.05, 0.2], o.belly],
    [[-0.18, 0.0, 0.215], [0.36, 0.02, 0.01], shade(o.fur, 0.55)],
    ...both([[0.07, 0.1, 0.04], [0.1, 0.1, 0.12], o.fur]),
    ...both([[0.09, 0.13, 0.155], [0.06, 0.06, 0.01], o.eye]),
  ],
  [
    [[-0.07, -0.08, -0.14], [0.14, 0.12, 0.3], o.fur],
    [[-0.08, -0.1, 0.1], [0.16, 0.03, 0.14], shade(o.fur, 0.85)],
  ],
]

let TAILS: Record<string, (fur: number, belly: number) => Box[]> = {
  puff: (_, belly) => [[[-0.06, 0.18, -0.32], [0.12, 0.12, 0.09], belly]],
  bush: (fur, belly) => [
    [[-0.08, 0.14, -0.4], [0.16, 0.42, 0.14], fur],
    [[-0.08, 0.5, -0.34], [0.16, 0.12, 0.18], fur],
    [[-0.06, 0.56, -0.2], [0.12, 0.06, 0.08], belly],
  ],
}

export let hopper = (o: Hopper): Figure => {
  let m = soft({ speckle: 0.08 })
  let [trunk, face, haunch] = o.frog ? froggy(o) : furry(o)
  let root = new THREE.Group()
  let body = new THREE.Group()
  root.add(body)
  body.add(partOf(
    [
      ...trunk,
      ...given(o.tail, (t) => TAILS[t](o.fur, o.belly)),
    ],
    [0, 0, 0],
    0.06,
  ))
  let head = partOf(face, o.frog ? [0, 0.14, 0.16] : [0, 0.34, 0.18], 0.05)
  body.add(head)
  let hind = [1, -1].map((side) =>
    partOf(haunch, [side * (o.frog ? 0.2 : 0.14), 0.12, -0.12], 0.05)
  )
  let fore = [1, -1].map((side) =>
    partOf([[[-0.03, -0.12, -0.03], [0.06, 0.14, 0.06], o.fur]], [
      side * (o.frog ? 0.16 : 0.08),
      0.12,
      0.14,
    ], 0.04)
  )
  body.add(...hind, ...fore)
  let phase = Math.random() * 6
  let leap = o.frog ? 0.34 : 0.26
  return {
    root,
    material: m,
    height: o.frog ? 0.45 : o.ears == 'long' ? 0.85 : 0.65,
    animate: (a, dt) => {
      let moving = a.speed > 0.2
      phase += dt * (moving ? 6 + a.speed : 1.5)
      let hop = moving ? Math.max(0, Math.sin(phase)) : 0
      body.position.set(0, hop * leap, 0)
      body.rotation.x = moving ? -Math.cos(phase) * 0.25 * (hop > 0 ? 1 : 0) : 0
      for (let h of hind) h.rotation.x = hop * 0.9
      for (let f of fore) f.rotation.x = -hop * 0.6
      head.rotation.set(
        moving ? 0 : Math.max(0, Math.sin(a.t * 0.8 + phase) - 0.7) * 1.2,
        moving ? 0 : Math.sin(a.t * 0.5 + phase) * 0.3,
        0,
      )
      if (o.frog) head.scale.y = 1 + Math.max(0, Math.sin(a.t * 3)) * 0.06
      if (a.swing >= 0) {
        let up = Math.sin(a.swing * Math.PI)
        body.position.set(0, up * leap * 0.6, up * 0.35)
        body.rotation.x = -up * 0.3
      }
      if (a.down) {
        body.rotation.set(0, 0, Math.PI / 2)
        body.position.set(0, 0.18, 0)
      } else body.rotation.z = 0
      flash(m, a.hurt * 0.8)
    },
  }
}
