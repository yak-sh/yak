// A creature that walks on two legs: a goblin with its club, a capling under
// its mushroom, a barkling crowned in leaves, a troll, a golem of stone. A man
// is the measure; its build makes it slight or hulking, and its head says
// what it is.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import type { Figure } from '../figures.ts'
import {
  both,
  type Box,
  given,
  type Limb,
  limb,
  lunge,
  partOf,
  shade,
  stride,
} from '../parts.ts'
import { flash, soft } from '../soft.ts'

export type Biped = {
  /** its hands and face, or all of it for a creature of stone or bark */
  skin: number
  /** what covers its body: rags, fur, bark, straw */
  garb: number
  eye: number
  /** how it is built, against a man: wide and tall */
  build?: [number, number]
  /** what sets its head apart: a goblin's long ears, a mushroom's cap, a
   * kobold's snout, a crown of leaves, horns, a straw hat */
  head?: 'ears' | 'cap' | 'snout' | 'crown' | 'horns' | 'hat'
  /** the colour of the cap, leaves, horns or hat */
  top?: number
  /** a club in its right hand, in this colour */
  club?: number
  /** arms that hang to its knees */
  long?: boolean
  /** how far it stoops forward, in radians */
  stoop?: number
}

let HEADS: Record<string, (skin: number, top: number) => Box[]> = {
  plain: () => [],
  ears: (skin) => [
    ...both([[0.17, 0.14, -0.02], [0.18, 0.08, 0.06], skin]),
    ...both([[0.33, 0.18, -0.02], [0.08, 0.06, 0.05], skin]),
    [[-0.04, 0.06, 0.16], [0.08, 0.1, 0.08], shade(skin, 0.9)],
  ],
  cap: (_, top) => [
    [[-0.5, 0.24, -0.5], [1, 0.2, 1], top],
    [[-0.4, 0.44, -0.4], [0.8, 0.16, 0.8], top],
    [[-0.26, 0.6, -0.26], [0.52, 0.08, 0.52], shade(top, 1.08)],
    [[-0.38, 0.18, -0.38], [0.76, 0.06, 0.76], 0xefe6cf],
    [[-0.3, 0.52, 0.1], [0.14, 0.12, 0.14], 0xf8f2e2],
    [[0.14, 0.52, -0.22], [0.16, 0.12, 0.16], 0xf8f2e2],
    [[0.34, 0.3, 0.2], [0.12, 0.12, 0.12], 0xf8f2e2],
    [[-0.46, 0.3, -0.2], [0.1, 0.1, 0.12], 0xf8f2e2],
  ],
  snout: (skin, top) => [
    [[-0.1, -0.02, 0.16], [0.2, 0.14, 0.18], shade(skin, 0.92)],
    ...both([[0.1, 0.26, -0.08], [0.06, 0.14, 0.06], top]),
  ],
  crown: (_, top) => [
    [[-0.44, 0.24, -0.4], [0.88, 0.3, 0.8], top],
    [[-0.32, 0.52, -0.28], [0.64, 0.22, 0.56], shade(top, 1.12)],
    [[0.26, 0.36, 0.12], [0.3, 0.24, 0.3], shade(top, 0.88)],
    [[-0.58, 0.3, -0.14], [0.26, 0.22, 0.3], shade(top, 0.92)],
    [[-0.12, 0.7, -0.1], [0.24, 0.14, 0.22], shade(top, 1.2)],
  ],
  horns: (_, top) => [
    ...both([[0.16, 0.22, -0.02], [0.16, 0.08, 0.08], top]),
    ...both([[0.26, 0.28, -0.02], [0.07, 0.2, 0.07], shade(top, 1.1)]),
  ],
  hat: (_, top) => [
    [[-0.34, 0.3, -0.34], [0.68, 0.05, 0.68], top],
    [[-0.19, 0.35, -0.19], [0.38, 0.2, 0.38], shade(top, 0.9)],
    [[-0.2, 0.36, -0.2], [0.4, 0.05, 0.4], 0x8a3a2a],
  ],
}

export let biped = (o: Biped): Figure => {
  let m = soft({ speckle: 0.1 })
  let [bw, bt] = o.build ?? [1, 1]
  let { skin, garb, eye } = o
  let top = o.top ?? shade(garb, 0.8)
  let ll = 0.72 * bt, tl = 0.66 * bt, al = (o.long ? 0.92 : 0.62) * bt
  let root = new THREE.Group()
  let body = new THREE.Group()
  root.add(body)
  let hips = new THREE.Group()
  hips.position.y = ll
  body.add(hips)
  // A thigh, and a shin ending in a foot, bending at the knee.
  let knee = ll / 2
  let leg = (x: number) =>
    limb(
      [[
        [-0.12 * bw, -knee - 0.03, -0.13 * bw],
        [0.24 * bw, knee + 0.06, 0.26 * bw],
        shade(garb, 0.8),
        0.06,
      ]],
      [
        [
          [-0.11 * bw, -knee, -0.12 * bw],
          [0.22 * bw, knee + 0.04, 0.24 * bw],
          shade(garb, 0.8),
          0.06,
        ],
        [
          [-0.13 * bw, -knee, -0.14 * bw],
          [0.26 * bw, 0.14, 0.32 * bw],
          shade(skin, 0.8),
          0.06,
        ],
      ],
      [x * bw, 0, 0],
      [0, -knee, 0],
    )
  let legL = leg(-0.15), legR = leg(0.15)
  hips.add(legL[0], legR[0])
  let torso = partOf([
    [[-0.3 * bw, 0, -0.18 * bw], [0.6 * bw, tl, 0.36 * bw], garb],
    [
      [-0.31 * bw, 0.02, -0.19 * bw],
      [0.62 * bw, 0.1, 0.38 * bw],
      shade(garb, 0.7),
    ],
    [
      [-0.24 * bw, tl * 0.55, 0.14 * bw],
      [0.48 * bw, tl * 0.35, 0.06],
      shade(garb, 1.12),
    ],
    // Leaves on the shoulders of a thing crowned in them.
    ...given(
      o.head == 'crown' && top,
      (c) =>
        both([
          [0.18 * bw, tl - 0.06, -0.2 * bw],
          [0.2 * bw, 0.18, 0.4 * bw],
          c,
        ]),
    ),
  ], [0, 0, 0])
  torso.rotation.x = o.stoop ?? 0
  hips.add(torso)
  // An upper arm, and a forearm ending in a hand, bending at the elbow; a
  // club, if it has one, is held out before it, head up.
  let elbow = al / 2
  let arm = (x: number, club: boolean): Limb => {
    let [upper, fore] = limb(
      [[
        [-0.1 * bw, -elbow - 0.03, -0.11 * bw],
        [0.2 * bw, elbow + 0.11, 0.22 * bw],
        garb,
        0.05,
      ]],
      [
        [
          [-0.095 * bw, -elbow + 0.08, -0.105 * bw],
          [0.19 * bw, elbow - 0.04, 0.21 * bw],
          garb,
          0.05,
        ],
        [
          [-0.1 * bw, -elbow - 0.1, -0.1 * bw],
          [0.2 * bw, 0.2, 0.2 * bw],
          skin,
          0.06,
        ],
      ],
      [x * bw, tl - 0.08 * bt, 0],
      [0, -elbow, 0],
    )
    if (club && o.club != undefined) {
      let c = partOf(
        [
          [[-0.05, -0.1, -0.05], [0.1, 0.9, 0.1], o.club],
          [[-0.09, 0.5, -0.09], [0.18, 0.36, 0.18], shade(o.club, 0.85)],
        ],
        [0, -elbow - 0.02, 0.06],
        0.05,
      )
      c.rotation.x = Math.PI / 4
      fore.add(c)
    }
    return [upper, fore]
  }
  let [armL, foreL] = arm(-0.4, false), [armR, foreR] = arm(0.4, true)
  torso.add(armL, armR)
  let head = partOf([
    [[-0.17, 0, -0.16], [0.34, 0.32, 0.32], skin],
    [[-0.18, 0.2, -0.17], [0.36, 0.06, 0.34], shade(skin, 0.85)],
    ...both([[0.05, 0.13, 0.155], [0.07, 0.06, 0.02], eye]),
    ...given(o.head, (h) => HEADS[h](skin, top)),
  ], [0, tl, 0.02])
  head.scale.setScalar(Math.max(1, Math.sqrt(bw)))
  torso.add(head)
  let phase = 0
  return {
    root,
    material: m,
    height: ll + tl + 0.4 + (o.head == 'cap' || o.head == 'crown' ? 0.3 : 0),
    animate: (a, dt) => {
      phase += dt * (1.6 + a.speed * 1.9) / Math.sqrt(bt)
      let amp = Math.min(1, a.speed / 3.5) * 0.8
      let s = Math.sin(phase), c = Math.cos(phase)
      stride(legL, s, c, amp)
      stride(legR, -s, -c, amp)
      armL.rotation.set(-s * amp * 0.7, 0, -0.1)
      armR.rotation.set(s * amp * 0.7, 0, 0.1)
      foreL.rotation.x = foreR.rotation.x = -0.25 - amp * 0.3
      body.position.y = Math.abs(c) * 0.06 * amp * bt
      body.rotation.z = Math.sin(phase) * 0.04 * amp
      head.rotation.set(0, Math.sin(a.t * 0.6) * 0.2 * (1 - amp), 0)
      if (a.swing >= 0) {
        // Both arms up and down on whatever is in front of it, bent at the
        // elbow as they rise.
        let up = lunge(a.swing, 0.45)
        armR.rotation.x = 0.4 - up * 3
        foreR.rotation.x = -0.2 - up * 1.1
        if (o.club == undefined) {
          armL.rotation.x = armR.rotation.x
          foreL.rotation.x = foreR.rotation.x
        } else armL.rotation.x = -0.3
        torso.rotation.x = (o.stoop ?? 0) - up * 0.25 + (1 - up) * 0.1
      } else torso.rotation.x = o.stoop ?? 0
      if (a.down) {
        body.rotation.x = -Math.PI / 2 + 0.1
        body.position.y = 0.25 * bw
      } else body.rotation.x = 0
      flash(m, a.hurt * 0.8)
    },
  }
}
