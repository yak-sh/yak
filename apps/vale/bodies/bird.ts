// A bird: a body, a head with its beak, two wings and two legs. One that
// walks folds its wings along its back and pecks; one that flies hangs in the
// air on beating wings and swoops on what it hunts. A hen is the measure:
// long legs and a long neck make a heron, a flat bill a duck, a hooked beak
// and a fan of tail a hawk.
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

export type Bird = {
  feather: number
  wing: number
  beak: number
  eye: number
  belly?: number
  /** how high it flies, in its own metres; none walks */
  fly?: number
  /** how long its legs are, against a hen's */
  legs?: number
  /** how long its neck is, against a hen's */
  neck?: number
  /** how wide its wings are, against a hen's */
  span?: number
  bill?: 'flat' | 'hook' | 'long'
  tail?: 'fan' | 'long' | 'short'
  /** a comb or a crest on its head */
  crest?: number
  /** a flat face with its eyes in front, an owl's */
  face?: number
}

let BILLS: Record<string, (c: number) => Box[]> = {
  point: (c) => [[[-0.03, 0.06, 0.1], [0.06, 0.05, 0.1], c]],
  flat: (c) => [[[-0.06, 0.04, 0.1], [0.12, 0.04, 0.13], c]],
  hook: (c) => [
    [[-0.035, 0.06, 0.1], [0.07, 0.07, 0.07], c],
    [[-0.03, 0.02, 0.15], [0.06, 0.06, 0.03], shade(c, 0.8)],
  ],
  long: (c) => [[[-0.025, 0.07, 0.1], [0.05, 0.04, 0.32], c]],
}

let TAILS: Record<string, (c: number) => [Box[], number]> = {
  fan: (c) => [[[[-0.16, -0.02, -0.24], [0.32, 0.05, 0.26], c]], 0.1],
  long: (c) => [[
    [[-0.04, -0.02, -0.62], [0.08, 0.04, 0.62], c],
    [[-0.03, -0.01, -0.7], [0.06, 0.03, 0.1], shade(c, 0.7)],
  ], 0.15],
  short: (c) => [[[[-0.12, -0.02, -0.12], [0.24, 0.14, 0.12], c]], 0.5],
}

// Eyes in front, in a flat face.
let owl = (face: number, eye: number): Box[] => [
  [[-0.1, 0.02, 0.12], [0.2, 0.16, 0.01], face],
  ...both([[0.02, 0.08, 0.125], [0.06, 0.06, 0.01], eye]),
]

export let bird = (o: Bird): Figure => {
  let m = soft({ speckle: 0.08 })
  let { feather, wing, beak, eye } = o
  let fly = o.fly ?? 0
  let lg = 0.22 * (o.legs ?? 1), nk = 0.12 * (o.neck ?? 1), sp = o.span ?? 1
  let rest = fly ? fly + 0.2 : lg + 0.16
  let root = new THREE.Group()
  let body = new THREE.Group()
  body.position.y = rest
  root.add(body)
  body.add(partOf(
    [
      [[-0.18, -0.16, -0.26], [0.36, 0.32, 0.52], feather],
      [[-0.15, -0.17, -0.2], [0.3, 0.1, 0.4], o.belly ?? shade(feather, 1.2)],
      [[-0.14, 0.12, -0.24], [0.28, 0.06, 0.4], shade(wing, 0.9)],
      [[-0.07, 0.08, 0.14], [0.14, nk + 0.06, 0.12], feather],
    ],
    [0, 0, 0],
    0.06,
  ))
  let head = partOf(
    [
      [[-0.1, 0, -0.08], [0.2, 0.2, 0.2], feather],
      ...(o.face == undefined
        ? both([[0.095, 0.1, 0.02], [0.02, 0.05, 0.05], eye])
        : owl(o.face, eye)),
      ...BILLS[o.bill ?? 'point'](beak),
      ...given(o.crest, (c) => [
        [[-0.02, 0.2, -0.06], [0.04, 0.08, 0.16], c],
        [[-0.02, -0.02, 0.1], [0.04, 0.06, 0.03], c],
      ]),
    ],
    [0, 0.1 + nk, 0.18],
    0.05,
  )
  body.add(head)
  let [tailBoxes, lift] = TAILS[o.tail ?? 'short'](shade(wing, 0.85))
  let tail = partOf(tailBoxes, [0, 0.04, -0.24], 0.05)
  tail.rotation.x = -lift
  body.add(tail)
  let pinion: Box[] = [
    [[0, -0.02, -0.18], [0.42 * sp, 0.05, 0.34], wing],
    [[0.3 * sp, -0.02, -0.26], [0.16 * sp, 0.04, 0.22], shade(wing, 0.8)],
  ]
  // A wing turns about its span last, so folding it lays it flat along the
  // body's side, pointing back.
  let wings = [1, -1].map((side) => {
    let w = partOf(side > 0 ? pinion : pinion.map(mirror), [
      side * 0.17,
      0.02,
      0.1,
    ], 0.06)
    w.rotation.order = 'YXZ'
    return w
  })
  body.add(...wings)
  let leg = (x: number) =>
    partOf(
      [
        [[-0.02, -lg, -0.02], [0.04, lg, 0.04], beak],
        [[-0.04, -lg, -0.02], [0.08, 0.03, 0.1], beak],
      ],
      [x, -0.15, 0],
      0.04,
    )
  let legs = [leg(0.07), leg(-0.07)]
  body.add(...legs)
  for (let l of legs) l.visible = !fly
  let phase = Math.random() * 6
  return {
    root,
    material: m,
    height: rest + 0.3 + nk,
    animate: (a, dt) => {
      let amp = Math.min(1, a.speed / 3) * 0.7
      phase += dt * (fly ? 9 + a.speed : 3 + a.speed * 4)
      let s = Math.sin(phase)
      let up = a.swing >= 0 ? lunge(a.swing) : 0
      head.position.z = 0.18
      head.rotation.x = 0
      if (fly) {
        // Beating wings, and a swoop on its quarry.
        body.position.set(
          0,
          rest + Math.sin(a.t * 2.1) * 0.08 - up * fly * 0.7,
          up * 0.45,
        )
        body.rotation.x = amp * 0.2 + up * 0.5
        wings[0].rotation.set(0, 0.1, s * 0.75)
        wings[1].rotation.set(0, -0.1, -s * 0.75)
      } else {
        // Wings folded along its back; it bobs its head as it walks, pecks
        // now and then when it stands, and pecks hard at a foe.
        let peck = Math.max(0, Math.sin(a.t * 0.9 + phase * 0.01) - 0.8) * 5
        body.position.set(0, rest + Math.abs(Math.cos(phase)) * 0.03 * amp, 0)
        body.rotation.x = 0
        legs[0].rotation.x = s * amp
        legs[1].rotation.x = -s * amp
        head.position.z = 0.18 + Math.sin(phase * 2) * 0.03 * amp + up * 0.12
        head.rotation.x = (1 - amp) * peck * 0.8 + up * 0.7
        let fold = (1 - up) * Math.PI / 2
        wings[0].rotation.set(fold, fold, up * 0.5)
        wings[1].rotation.set(fold, -fold, -up * 0.5)
      }
      if (a.down) {
        body.position.y = 0.16
        body.rotation.z = Math.PI / 2
        for (let w of wings) w.rotation.set(0, 0, 0)
      } else body.rotation.z = 0
      flash(m, a.hurt * 0.8)
    },
  }
}
