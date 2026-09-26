// A crag: a walking heap of stone, moss on its shell and embers for eyes, and
// sometimes crystal, ice or cinders growing from its back.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import type { Figure } from '../figures.ts'
import { type Box, partOf, shade, trot } from '../parts.ts'
import { flash, soft } from '../soft.ts'

export type Crag = {
  stone: number
  light: number
  moss: number
  eye: number
  /** spikes of crystal, ice or cinder on its back, in this colour */
  crystals?: number
}

export let crag = (l: Crag): Figure => {
  let m = soft({ speckle: 0.14 })
  let root = new THREE.Group()
  let body = new THREE.Group()
  root.add(body)
  let { stone, light, moss, crystals } = l
  let spikes: Box[] = crystals == undefined ? [] : [
    [[-0.34, 1.3, -0.24], [0.16, 0.38, 0.16], crystals],
    [[0.08, 1.3, 0.02], [0.14, 0.5, 0.14], shade(crystals, 1.15)],
    [[0.36, 0.98, -0.46], [0.14, 0.34, 0.14], crystals],
    [[-0.58, 0.96, 0.18], [0.14, 0.3, 0.14], shade(crystals, 0.9)],
    [[-0.04, 1.36, -0.52], [0.12, 0.3, 0.12], shade(crystals, 1.2)],
  ]
  body.add(partOf(
    [
      [[-0.72, 0.3, -0.8], [1.44, 0.55, 1.6], stone],
      [[-0.56, 0.85, -0.64], [1.12, 0.35, 1.28], light],
      [[-0.36, 1.2, -0.42], [0.72, 0.25, 0.84], stone],
      [[-0.3, 1.18, -0.2], [0.44, 0.1, 0.5], moss],
      [[0.2, 1.02, 0.3], [0.3, 0.08, 0.28], moss],
      [[-0.5, 0.98, -0.5], [0.24, 0.06, 0.3], moss],
      [[0.34, 0.8, -0.6], [0.3, 0.2, 0.24], shade(stone, 0.86)],
      [[-0.66, 0.28, -0.74], [1.32, 0.1, 1.48], shade(stone, 0.78)],
      ...spikes,
    ],
    [0, 0, 0],
    0.15,
  ))
  let head = partOf(
    [
      [[-0.26, -0.22, 0], [0.52, 0.44, 0.46], light],
      [[-0.18, 0.02, 0.45], [0.12, 0.09, 0.02], l.eye],
      [[0.06, 0.02, 0.45], [0.12, 0.09, 0.02], l.eye],
      [[-0.22, 0.2, 0.05], [0.44, 0.08, 0.3], moss],
    ],
    [0, 0.6, 0.78],
    0.12,
  )
  body.add(head)
  let leg = (x: number, z: number) =>
    partOf([[[-0.16, -0.36, -0.16], [0.32, 0.4, 0.32], shade(stone, 0.9)]], [
      x,
      0.38,
      z,
    ], 0.12)
  let legs = [leg(-0.5, 0.5), leg(0.5, 0.5), leg(-0.5, -0.55), leg(0.5, -0.55)]
  body.add(...legs)
  let phase = 0
  return {
    root,
    material: m,
    height: crystals == undefined ? 2 : 2.3,
    animate: (a, dt) => {
      phase += dt * (1 + a.speed * 2.4)
      let amp = Math.min(1, a.speed / 2.4) * 0.45
      trot(legs, Math.sin(phase), Math.cos(phase), amp)
      body.rotation.z = Math.sin(phase) * 0.04 * amp
      head.position.y = 0.6 + Math.sin(a.t * 1.1) * 0.02
      if (a.swing >= 0) {
        let up = Math.sin(a.swing * Math.PI)
        head.position.z = 0.78 + up * 0.35
        body.rotation.x = -up * 0.12
      } else {
        head.position.z = 0.78
        body.rotation.x = 0
      }
      if (a.down) {
        body.rotation.z = Math.PI * 0.9
        body.position.y = 1.4
      } else body.position.y = 0
      flash(m, a.hurt * 0.8)
    },
  }
}
