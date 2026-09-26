// A slime: a jelly cube with moss on its back, which hops.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import type { Figure } from '../figures.ts'
import { partOf, shade } from '../parts.ts'
import { flash, soft } from '../soft.ts'

export type Slime = { body: number; moss: number; bloom: number }

export let slime = (l: Slime): Figure => {
  let m = soft({ speckle: 0.08 })
  let root = new THREE.Group()
  let jelly = new THREE.Group()
  root.add(jelly)
  jelly.add(partOf(
    [
      [[-0.42, 0, -0.42], [0.84, 0.72, 0.84], l.body],
      [[-0.44, 0.62, -0.44], [0.88, 0.14, 0.88], l.moss],
      [[-0.2, 0.76, -0.1], [0.14, 0.1, 0.14], shade(l.moss, 1.2)],
      [[0.1, 0.76, 0.12], [0.1, 0.14, 0.1], l.bloom],
      [[-0.3, 0.3, 0.42], [0.2, 0.22, 0.02], 0xffffff],
      [[0.1, 0.3, 0.42], [0.2, 0.22, 0.02], 0xffffff],
      [[-0.24, 0.32, 0.43], [0.1, 0.13, 0.02], 0x243020],
      [[0.16, 0.32, 0.43], [0.1, 0.13, 0.02], 0x243020],
      [[-0.08, 0.16, 0.42], [0.16, 0.05, 0.02], shade(l.body, 0.5)],
      [[-0.3, 0, -0.3], [0.6, 0.06, 0.6], shade(l.body, 0.8)],
    ],
    [0, 0, 0],
    0.12,
  ))
  let phase = Math.random() * 6
  return {
    root,
    material: m,
    height: 1.2,
    animate: (a, dt) => {
      phase += dt * (a.speed > 0.2 ? 7 : 2.5)
      let hop = a.speed > 0.2 ? Math.max(0, Math.sin(phase)) : 0
      let squash = a.speed > 0.2
        ? 1 - Math.max(0, -Math.sin(phase)) * 0.25 + hop * 0.12
        : 1 + Math.sin(phase) * 0.04
      jelly.position.y = hop * 0.45
      jelly.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash))
      if (a.swing >= 0) {
        let up = Math.sin(a.swing * Math.PI)
        jelly.position.z = up * 0.45
        jelly.scale.y *= 1 - up * 0.2
      } else jelly.position.z = 0
      if (a.down) jelly.scale.set(1.4, 0.2, 1.4)
      flash(m, a.hurt * 0.8)
    },
  }
}
