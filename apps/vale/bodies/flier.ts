// A small thing on wings that never lands: a bee on a blur of clear wings, a
// moth on dusty ones, a darter long and thin, a bat on leather. It hangs in
// the air, weaving, and darts at what it hunts.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import type { Figure } from '../figures.ts'
import {
  both,
  type Box,
  given,
  lunge,
  mirror,
  partOf,
  shade,
} from '../parts.ts'
import { flash, soft } from '../soft.ts'

export type Flier = {
  body: number
  wing: number
  eye: number
  wings: 'clear' | 'dust' | 'leather'
  /** bands across its body */
  stripe?: number
  /** a long thin body, a darter's */
  long?: boolean
  /** a sting at its tail, in this colour */
  sting?: number
  /** a bat's ears and snout */
  ears?: boolean
  /** how high it flies, in its own metres */
  fly?: number
}

// Each kind of wing, for the right side, and how fast it beats.
let WINGS: Record<string, (c: number, long: boolean) => [Box[], number]> = {
  clear: (c, long) => [
    long
      ? [
        [[0, 0, -0.02], [0.5, 0.02, 0.08], c],
        [[0, 0, -0.14], [0.46, 0.02, 0.08], c],
      ]
      : [
        [[0, 0, -0.14], [0.32, 0.02, 0.18], c],
        [[0, 0, -0.26], [0.22, 0.02, 0.12], shade(c, 0.94)],
      ],
    long ? 26 : 40,
  ],
  dust: (c) => [[
    [[0, 0, -0.24], [0.42, 0.03, 0.36], c],
    [[0.2, 0.005, -0.14], [0.12, 0.03, 0.12], shade(c, 0.55)],
    [[0.04, 0.005, -0.34], [0.2, 0.03, 0.14], shade(c, 0.85)],
  ], 7],
  leather: (c) => [[
    [[0, 0, -0.18], [0.46, 0.03, 0.3], c],
    [[0.3, 0, -0.28], [0.16, 0.03, 0.1], c],
    [[0.02, 0.01, -0.02], [0.44, 0.03, 0.04], shade(c, 0.7)],
  ], 11],
}

export let flier = (o: Flier): Figure => {
  let m = soft({ speckle: 0.06 })
  let { body: hue, wing, eye } = o
  let long = !!o.long
  let rest = (o.fly ?? 1.2) + 0.15
  let band = (z: number): Box[] =>
    given(
      o.stripe,
      (c) =>
        long
          ? [[[-0.055, -0.055, z], [0.11, 0.11, 0.05], c]]
          : [[[-0.145, -0.155, z], [0.29, 0.29, 0.06], c]],
    )
  let tail: Box[] = long
    ? [
      [[-0.05, -0.05, -0.76], [0.1, 0.1, 0.72], hue],
      ...band(-0.3),
      ...band(-0.5),
    ]
    : [
      [[-0.14, -0.15, -0.42], [0.28, 0.28, 0.38], hue],
      ...band(-0.34),
      ...band(-0.2),
    ]
  let root = new THREE.Group()
  let body = new THREE.Group()
  body.position.y = rest
  root.add(body)
  body.add(partOf(
    m,
    [
      [[-0.09, -0.09, 0.14], [0.18, 0.18, 0.14], shade(hue, 0.8)],
      ...both([[0.06, -0.02, 0.2], [0.05, 0.08, 0.06], eye]),
      [[-0.12, -0.12, -0.06], [0.24, 0.24, 0.22], hue],
      ...tail,
      ...given(o.sting, (c) => [[[-0.02, -0.04, -0.5], [0.04, 0.04, 0.1], c]]),
      ...given(o.ears, () => [
        ...both([[0.04, 0.08, 0.14], [0.07, 0.14, 0.04], shade(hue, 0.9)]),
        [[-0.05, -0.06, 0.27], [0.1, 0.07, 0.04], shade(hue, 0.7)],
      ]),
      ...given(
        !o.ears && wing,
        (c) => both([[0.03, 0.07, 0.26], [0.02, 0.1, 0.02], shade(c, 0.7)]),
      ),
    ],
    [0, 0, 0],
    0.05,
  ))
  let [pinion, rate] = WINGS[o.wings](wing, long)
  let wings = [1, -1].map((side) =>
    partOf(
      m,
      side > 0 ? pinion : pinion.map(mirror),
      [side * 0.1, 0.1, 0],
      0.05,
    )
  )
  body.add(...wings)
  let phase = Math.random() * 6
  return {
    root,
    material: m,
    height: rest + 0.3,
    animate: (a, dt) => {
      phase += dt * rate
      let up = a.swing >= 0 ? lunge(a.swing) : 0
      body.position.set(
        Math.sin(a.t * 1.7 + phase * 0.002) * 0.1,
        rest + Math.sin(a.t * 2.6) * 0.1 - up * rest * 0.6,
        up * 0.5,
      )
      body.rotation.set(up * 0.6 + Math.min(1, a.speed / 3) * 0.25, 0, 0)
      let flap = Math.sin(phase) * (o.wings == 'clear' ? 0.5 : 0.8)
      wings[0].rotation.z = flap
      wings[1].rotation.z = -flap
      if (a.down) {
        body.position.set(0, 0.15, 0)
        body.rotation.z = Math.PI
        wings[0].rotation.z = wings[1].rotation.z = 0
      } else body.rotation.z = 0
      flash(m, a.hurt * 0.8)
    },
  }
}
