// A four-legged beast: a trunk, a head with its snout, four legs, and
// whatever sets its kind apart. A boar is the measure: longer legs make a
// deer, a longer muzzle and a bushy tail a wolf, a deeper trunk and round
// ears a bear, curled horns a ram, a ridge of thorns Old Thornback.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import type { Figure } from '../figures.ts'
import { both, type Box, given, lunge, partOf, shade, trot } from '../parts.ts'
import { flash, soft } from '../soft.ts'

export type Quadruped = {
  hide: number
  /** the bristles down its back, and its ears */
  ridge: number
  snout: number
  eye: number
  /** tusks, in this colour */
  tusk?: number
  /** a ridge of thorns down its back */
  thorns?: boolean
  horns?: 'curl' | 'spike' | 'antler'
  /** the horns' colour */
  horn?: number
  /** its ears, when not a boar's little ones */
  ears?: 'point' | 'round' | 'tuft' | 'long'
  tail?: 'thin' | 'bush' | 'stub' | 'flat'
  /** its underside and its tail's tip */
  belly?: number
  /** a stripe down its face */
  mask?: number
  /** how long its legs are, against a boar's */
  legs?: number
  /** its trunk against a boar's: wide, deep and long */
  build?: [number, number, number]
  /** how far its muzzle reaches, against a boar's */
  muzzle?: number
}

let EARS: Record<string, (c: number) => Box[]> = {
  nub: (c) => both([[0.12, 0.18, 0.06], [0.12, 0.14, 0.06], c]),
  point: (c) => [
    ...both([[0.1, 0.2, 0.1], [0.12, 0.16, 0.06], c]),
    ...both([[0.12, 0.36, 0.1], [0.07, 0.1, 0.06], c]),
  ],
  round: (c) => both([[0.13, 0.17, 0.08], [0.15, 0.13, 0.07], c]),
  tuft: (c) => [
    ...EARS.point(c),
    ...both([[0.135, 0.46, 0.11], [0.04, 0.12, 0.04], 0x2a2420]),
  ],
  long: (c) => both([[0.24, 0.08, 0.1], [0.2, 0.09, 0.05], c]),
}

let HORNS: Record<string, (c: number) => Box[]> = {
  curl: (c) => [
    ...both([[0.18, 0.1, 0], [0.14, 0.16, 0.22], c]),
    ...both([[0.26, -0.08, 0.1], [0.12, 0.2, 0.14], c]),
    ...both([[0.22, -0.16, 0.22], [0.1, 0.1, 0.1], shade(c, 0.9)]),
  ],
  spike: (c) => [
    ...both([[0.22, 0.12, 0.14], [0.26, 0.09, 0.09], c]),
    ...both([[0.42, 0.18, 0.14], [0.08, 0.2, 0.08], shade(c, 1.1)]),
  ],
  antler: (c) => [
    ...both([[0.12, 0.2, 0.08], [0.06, 0.44, 0.06], c]),
    ...both([[0.18, 0.34, 0.08], [0.16, 0.05, 0.05], c]),
    ...both([[0.3, 0.34, 0.08], [0.05, 0.22, 0.05], c]),
    ...both([[0.14, 0.62, 0.02], [0.05, 0.16, 0.05], c]),
    ...both([[0.02, 0.56, 0.12], [0.12, 0.05, 0.05], c]),
  ],
}

// Each tail hangs from the rump, and how far it droops.
let TAILS: Record<string, (c: number, tip: number) => [Box[], number]> = {
  thin: (c) => [[[[-0.03, -0.03, -0.44], [0.06, 0.06, 0.44], c]], -0.9],
  bush: (c, tip) => [[
    [[-0.1, -0.1, -0.5], [0.2, 0.2, 0.5], c],
    [[-0.08, -0.08, -0.6], [0.16, 0.16, 0.12], tip],
  ], -0.55],
  stub: (_, tip) => [[[[-0.07, -0.05, -0.14], [0.14, 0.14, 0.14], tip]], 0.3],
  flat: (
    c,
  ) => [[[[-0.16, -0.03, -0.5], [0.32, 0.06, 0.48], shade(c, 0.5)]], -0.2],
}

export let quadruped = (o: Quadruped): Figure => {
  let m = soft({ speckle: 0.1 })
  let { hide, ridge, snout, eye } = o
  let [bw, bh, bl] = o.build ?? [1, 1, 1]
  let mz = o.muzzle ?? 1
  let ll = 0.4 * (o.legs ?? 1)
  let hip = ll + 0.02, y0 = hip - 0.06, top = y0 + 0.58 * bh
  let belly = o.belly ?? shade(hide, 0.85)
  let root = new THREE.Group()
  let body = new THREE.Group()
  root.add(body)
  let trunk = partOf([
    [[-0.33 * bw, y0, -0.6 * bl], [0.66 * bw, 0.58 * bh, 1.2 * bl], hide],
    [[-0.08, top - 0.02, -0.5 * bl], [0.16, 0.1, 0.95 * bl], ridge],
    [[-0.3 * bw, y0 - 0.02, -0.55 * bl], [0.6 * bw, 0.1, 1.05 * bl], belly],
    ...given(!o.tail && ridge, (c) => [
      [[-0.04, y0 + 0.24, -0.6 * bl - 0.08], [0.08, 0.18, 0.1], c],
    ]),
    ...given(o.thorns, () =>
      [0, 1, 2, 3, 4].flatMap((i) => [
        [
          [-0.05, top + 0.04, (-0.42 + i * 0.2) * bl],
          [0.1, 0.22 + (i % 2) * 0.08, 0.1],
          0xe0d0b0,
        ],
        ...both([
          [0.19, top - 0.08, (-0.36 + i * 0.2) * bl],
          [0.07, 0.16, 0.07],
          0xd8c29a,
        ]),
      ])),
  ], [0, 0, 0])
  body.add(trunk)
  let nose = 0.38 + 0.14 * mz
  let head = partOf([
    [[-0.25, -0.24, 0], [0.5, 0.46, 0.4], hide],
    [[-0.14, -0.2, 0.38], [0.28, 0.2, 0.14 * mz], snout],
    ...both([[0.04, -0.14, nose], [0.05, 0.06, 0.01], 0x3a2a26]),
    ...given(
      o.tusk,
      (c) => both([[0.14, -0.16, 0.38 + 0.06 * mz], [0.06, 0.2, 0.06], c]),
    ),
    ...both([[0.11, 0.04, 0.4], [0.08, 0.08, 0.01], eye]),
    ...given(o.mask, (c) => [[[-0.07, -0.1, 0.395], [0.14, 0.34, 0.01], c]]),
    ...EARS[o.ears ?? 'nub'](ridge),
    ...given(o.horns, (h) => HORNS[h](o.horn ?? 0xe8dcc0)),
  ], [0, y0 + 0.3 * bh, 0.6 * bl - 0.02])
  head.scale.setScalar(Math.sqrt(bw * bh))
  body.add(head)
  let tail: THREE.Bone | null = null, droop = 0
  if (o.tail) {
    let [boxes, d] = TAILS[o.tail](ridge, o.belly ?? 0xf0ebe0)
    tail = partOf(boxes, [0, y0 + 0.44 * bh, -0.6 * bl])
    droop = d
    body.add(tail)
  }
  let lw = 0.16 * Math.sqrt(bw)
  let leg = (x: number, z: number) =>
    partOf([
      [[-lw / 2, -ll, -lw / 2], [lw, ll, lw], shade(hide, 0.8)],
      [
        [-lw / 2 - 0.005, -ll, -lw / 2 - 0.005],
        [lw + 0.01, 0.08, lw + 0.01],
        0x3a2a22,
      ],
    ], [x * bw, hip, z * bl])
  let legs = [
    leg(-0.21, 0.38),
    leg(0.21, 0.38),
    leg(-0.21, -0.4),
    leg(0.21, -0.4),
  ]
  body.add(...legs)
  let stride = 1 / Math.sqrt(o.legs ?? 1)
  let phase = 0
  return {
    root,
    material: m,
    height: top + 0.41 + (o.horns == 'antler' ? 0.45 : 0),
    animate: (a, dt) => {
      phase += dt * (1.5 + a.speed * 2.6) * stride
      let amp = Math.min(1, a.speed / 3.5) * 0.7
      trot(legs, Math.sin(phase) * amp)
      body.position.y = Math.abs(Math.cos(phase)) * 0.05 * amp
      head.rotation.set(Math.sin(a.t * 1.3) * 0.05 * (1 - amp), 0, 0)
      if (tail) tail.rotation.set(droop, Math.sin(a.t * 2.4) * 0.25, 0)
      if (a.swing >= 0) {
        let up = lunge(a.swing)
        head.rotation.x = 0.1 - up * 0.65
        body.position.z = up * 0.25
      } else body.position.z = 0
      if (a.down) {
        body.rotation.z = Math.PI / 2
        body.position.y = 0.3 * bw
      } else body.rotation.z = 0
      flash(m, a.hurt * 0.8)
    },
  }
}
