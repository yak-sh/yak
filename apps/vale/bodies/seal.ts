// A seal lies low on its belly. Its front flippers sweep the sand while the
// paired rear flippers drive a rolling slide; it has no walking legs.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import type { Box } from '../boxes.ts'
import type { Puppet } from '../figures.ts'
import { both, lunge, mirror, partOf, shade, tag } from '../parts.ts'
import { flash, soft } from '../soft.ts'

export type Seal = {
  hide: number
  ridge: number
  snout: number
  eye: number
  belly: number
}

export let seal = (o: Seal): Puppet => {
  let m = soft({ speckle: 0.1 })
  let root = new THREE.Group(), body = new THREE.Group()
  root.add(body)
  let trunk = partOf(
    [
      [[-0.34, 0.1, -0.7], [0.68, 0.4, 1.25], o.hide, 0.15],
      [[-0.2, 0.46, -0.48], [0.4, 0.08, 0.75], o.ridge, 0.07],
      [[-0.25, 0.07, -0.51], [0.5, 0.1, 0.95], o.belly, 0.08],
      [[-0.2, 0.13, -0.89], [0.4, 0.31, 0.33], o.hide, 0.12],
      [[-0.14, 0.17, -1.04], [0.28, 0.19, 0.23], o.ridge, 0.08],
    ],
    [0, 0, 0],
    0.07,
  )
  body.add(tag(trunk, 'trunk'))
  let head = partOf(
    [
      [[-0.23, -0.15, -0.04], [0.46, 0.36, 0.44], o.hide, 0.12],
      [[-0.15, -0.13, 0.3], [0.3, 0.18, 0.25], o.snout, 0.08],
      ...both([[0.13, 0.07, 0.27], [0.06, 0.06, 0.03], o.eye, 0.02]),
      ...both([[0.05, -0.07, 0.53], [0.045, 0.04, 0.02], 0x242426, 0.01]),
    ],
    [0, 0.43, 0.51],
    0.05,
  )
  body.add(tag(head, 'head', { head: {} }))
  let fin: Box[] = [
    [[0.02, -0.035, -0.22], [0.48, 0.08, 0.28], o.hide, 0.05],
    [[0.3, -0.035, -0.28], [0.25, 0.065, 0.17], shade(o.hide, 0.82), 0.04],
  ]
  let front = [1, -1].map((side) =>
    partOf(
      side > 0 ? fin : fin.map(mirror),
      [side * 0.28, 0.08, 0.27],
      0.04,
    )
  )
  for (let [i, f] of front.entries()) {
    let side = i ? -1 : 1
    tag(f, i ? 'left flipper' : 'right flipper', { leg: { phase: 0 } })
      .rotation.set(0, side * 0.18, side * 0.06)
  }
  body.add(...front)
  let rear = [1, -1].map((side) =>
    partOf(
      [
        [
          [side > 0 ? 0 : -0.15, -0.025, -0.38],
          [0.15, 0.06, 0.44],
          o.hide,
          0.04,
        ],
        [
          [side > 0 ? 0.03 : -0.22, -0.025, -0.55],
          [0.19, 0.05, 0.25],
          shade(o.hide, 0.82),
          0.04,
        ],
      ],
      [side * 0.08, 0.12, -0.97],
      0.04,
    )
  )
  for (let [i, f] of rear.entries()) {
    let side = i ? -1 : 1
    tag(f, i ? 'left hind flipper' : 'right hind flipper', {
      leg: { phase: 0.25 },
    }).rotation.set(-0.08, side * 0.2, 0)
  }
  body.add(...rear)
  root.userData.moves = { gait: 'slide', bite: 'lunge', fall: 'topple' }
  let phase = 0
  return {
    root,
    material: m,
    height: 0.93,
    animate: (a, dt) => {
      let move = Math.min(1, a.speed / 2.2)
      phase += dt * (1.5 + a.speed * 3.2)
      let s = Math.sin(phase), c = Math.cos(phase)
      let up = a.swing >= 0 ? lunge(a.swing) : 0
      body.position.z = up * 0.22 + s * 0.04 * move
      body.position.y = -0.04 + move * (0.025 + 0.04 * c * c)
      body.rotation.y = s * 0.08 * move
      body.rotation.x = -up * 0.12 + c * 0.08 * move
      head.rotation.x = Math.sin(a.t * 1.1) * 0.03 + c * 0.11 * move -
        up * 0.35
      for (let [i, f] of front.entries()) {
        let side = i == 0 ? 1 : -1
        f.rotation.y = side * (0.18 + (s + up) * 0.32 * move)
        f.rotation.z = side * (0.06 + Math.max(0, c) * 0.18 * move)
      }
      for (let [i, f] of rear.entries()) {
        let side = i == 0 ? 1 : -1
        f.rotation.y = side * (0.2 + c * 0.18 * move)
        f.rotation.x = -0.08 + s * 0.2 * move
      }
      if (a.down) {
        body.rotation.z = Math.PI / 2
        body.position.y = 0.32
      } else body.rotation.z = 0
      flash(m, a.hurt * 0.8)
    },
  }
}
