// A thing low on many legs: a spider with its round abdomen, a beetle under
// its shell, a crab with its claws, a scorpion with its sting curled over its
// back, a turtle under its dome, a lizard with its long tail. Its legs step in
// two alternating sets, as an insect's do.
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

export type Crawler = {
  shell: number
  under: number
  leg: number
  eye: number
  /** pairs of legs; three unless it says */
  pairs?: number
  /** a spider's round abdomen behind */
  abdomen?: boolean
  /** a turtle's high dome of shell, with a head that peeps out */
  dome?: boolean
  /** claws before it, in this colour */
  claws?: number
  /** mandibles, a stag beetle's, in this colour */
  jaws?: number
  /** a sting curled over its back, in this colour */
  sting?: number
  /** a long tail behind, a lizard's */
  tail?: boolean
  /** markings on its back */
  mark?: number
}

// Its legs, one set: every other leg down each side, starting on the right.
let legsOf = (o: Crawler, set: number): Box[] => {
  let n = o.pairs ?? 3, out: Box[] = []
  let reach = o.dome ? 0.08 : 0.2
  for (let i = 0; i < n; i++) {
    for (let side of [1, -1]) {
      if ((i + (side > 0 ? 0 : 1)) % 2 != set) continue
      let z = n == 1 ? 0 : 0.2 - (0.44 * i) / (n - 1)
      let x = side > 0 ? 0.24 : -0.24 - reach
      out.push([[x, 0.2, z - 0.03], [reach, 0.05, 0.06], o.leg])
      out.push([
        [side > 0 ? 0.22 + reach : -0.26 - reach, 0, z - 0.03],
        [0.04, 0.24, 0.05],
        shade(o.leg, 0.8),
      ])
    }
  }
  return out
}

export let crawler = (o: Crawler): Figure => {
  let m = soft({ speckle: 0.1 })
  let { shell, under, eye } = o
  let root = new THREE.Group()
  let body = new THREE.Group()
  root.add(body)
  let hull: Box[] = o.dome
    ? [
      [[-0.3, 0.12, -0.34], [0.6, 0.3, 0.66], shell],
      [[-0.22, 0.42, -0.26], [0.44, 0.1, 0.5], shade(shell, 1.1)],
      [[-0.32, 0.1, -0.36], [0.64, 0.06, 0.7], under],
      ...given(o.mark, (c) => [
        [[-0.08, 0.46, -0.12], [0.16, 0.08, 0.2], c],
        ...both([[0.12, 0.3, -0.2], [0.19, 0.1, 0.18], c]),
      ]),
    ]
    : [
      [[-0.26, 0.12, -0.28], [0.52, 0.2, 0.56], shell],
      [[-0.22, 0.32, -0.24], [0.44, 0.06, 0.48], shade(shell, 1.12)],
      [[-0.24, 0.1, -0.26], [0.48, 0.04, 0.52], under],
      ...given(o.mark, (c) => [[[-0.05, 0.37, -0.2], [0.1, 0.02, 0.36], c]]),
      ...given(o.abdomen && shell, (c) => [
        [[-0.26, 0.14, -0.72], [0.52, 0.42, 0.46], c],
        [[-0.2, 0.52, -0.66], [0.4, 0.08, 0.34], shade(c, 1.1)],
        ...given(o.mark, (k) => [[[-0.08, 0.57, -0.6], [0.16, 0.02, 0.2], k]]),
      ]),
      ...given(o.tail && shell, (c) => [
        [[-0.08, 0.14, -0.62], [0.16, 0.12, 0.36], c],
        [[-0.05, 0.14, -0.9], [0.1, 0.08, 0.3], shade(c, 0.9)],
      ]),
    ]
  body.add(partOf(m, hull, [0, 0, 0], 0.08))
  let head = partOf(
    m,
    [
      [[-0.13, -0.08, 0], [0.26, 0.16, 0.16], shade(shell, 0.85)],
      ...both([[0.05, 0.02, 0.15], [0.05, 0.05, 0.02], eye]),
      ...given(
        o.abdomen && eye,
        (c) => both([[0.01, 0.05, 0.155], [0.03, 0.03, 0.01], c]),
      ),
      ...given(o.jaws, (c) => [
        ...both([[0.07, -0.04, 0.14], [0.05, 0.06, 0.26], c]),
        ...both([[0.03, -0.04, 0.34], [0.05, 0.06, 0.06], shade(c, 0.85)]),
      ]),
    ],
    [0, 0.22, o.dome ? 0.36 : 0.28],
    0.05,
  )
  body.add(head)
  let claws = given(o.claws, (c) => [
    [[0.02, -0.04, 0], [0.08, 0.08, 0.2], shade(c, 0.9)],
    [[-0.02, -0.07, 0.18], [0.16, 0.14, 0.14], c],
    [[0.06, -0.06, 0.32], [0.05, 0.05, 0.1], shade(c, 1.1)],
  ])
  let pincers = claws.length
    ? [1, -1].map((side) =>
      partOf(
        m,
        side > 0 ? claws : claws.map(mirror),
        [side * 0.18, 0.2, 0.3],
        0.05,
      )
    )
    : []
  if (pincers.length) body.add(...pincers)
  let sting = o.sting == undefined ? null : partOf(
    m,
    [
      [[-0.05, 0, -0.14], [0.1, 0.1, 0.14], shell],
      [[-0.05, 0.08, -0.22], [0.1, 0.22, 0.1], shell],
      [[-0.05, 0.28, -0.2], [0.1, 0.1, 0.16], shell],
      [[-0.03, 0.26, -0.06], [0.06, 0.06, 0.12], o.sting],
    ],
    [0, 0.26, -0.26],
    0.05,
  )
  if (sting) body.add(sting)
  let sets = [0, 1].map((s) => partOf(m, legsOf(o, s), [0, 0, 0], 0.05))
  body.add(...sets)
  let phase = Math.random() * 6
  return {
    root,
    material: m,
    height: o.abdomen ? 0.8 : o.sting != undefined ? 0.8 : o.dome ? 0.7 : 0.55,
    animate: (a, dt) => {
      let amp = Math.min(1, a.speed / 2.5)
      phase += dt * (2 + a.speed * 5)
      let s = Math.sin(phase)
      sets[0].position.set(0, Math.max(0, s) * 0.06 * amp, s * 0.05 * amp)
      sets[1].position.set(0, Math.max(0, -s) * 0.06 * amp, -s * 0.05 * amp)
      body.position.y = Math.abs(Math.cos(phase)) * 0.015 * amp
      let up = a.swing >= 0 ? lunge(a.swing) : 0
      body.position.z = up * 0.25
      body.rotation.x = -up * 0.15
      head.rotation.x = Math.sin(a.t * 1.4) * 0.05
      if (o.dome) head.position.z = 0.3 + Math.min(1, amp + up) * 0.08
      for (let [i, p] of pincers.entries()) {
        p.rotation.set(-up * 0.6, (i ? -1 : 1) * (0.2 + up * 0.5), 0)
      }
      if (sting) sting.rotation.x = up * 1.1 + Math.sin(a.t * 2) * 0.05
      if (a.down) {
        body.rotation.z = Math.PI
        body.position.y = 0.5
      } else body.rotation.z = 0
      flash(m, a.hurt * 0.8)
    },
  }
}
