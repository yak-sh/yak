// A serpent: a head and a body of lengths behind it, each following the one
// before along a wave, so it slithers. It rears its head to strike. A grass
// snake is the measure; a hood, horns and more lengths make a basilisk or a
// wyrm.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import type { Figure } from '../figures.ts'
import { both, type Box, given, lunge, partOf, shade } from '../parts.ts'
import { flash, soft } from '../soft.ts'

export type Serpent = {
  skin: number
  belly: number
  eye: number
  /** bands down its back */
  band?: number
  /** how many lengths of body behind its head */
  length?: number
  /** how thick, against a grass snake */
  girth?: number
  /** a hood or a crest behind its head, in this colour */
  frill?: number
  /** horns, in this colour */
  horns?: number
}

export let serpent = (o: Serpent): Figure => {
  let m = soft({ speckle: 0.1 })
  let { skin, belly, eye } = o
  let n = o.length ?? 6, g = o.girth ?? 1
  let step = 0.26 * Math.sqrt(g)
  let root = new THREE.Group()
  let body = new THREE.Group()
  root.add(body)
  // Each length is a little thinner than the one before it.
  let links = Array.from({ length: n }, (_, i) => {
    let w = 0.2 * g * (1 - (i / n) * 0.65), h = w * 0.8
    let boxes: Box[] = [
      [[-w / 2, 0, -step / 2 - 0.02], [w, h, step + 0.04], skin],
      [[-w / 2 + 0.01, -0.005, -step / 2], [w - 0.02, 0.03, step], belly],
      ...given(i % 2 == 0 && o.band, (c) => [
        [[-w / 2 - 0.005, h * 0.4, -0.04], [w + 0.01, h * 0.62, 0.08], c],
      ]),
    ]
    let link = partOf(boxes, [0, 0, -(i + 0.5) * step], 0.05)
    body.add(link)
    return link
  })
  let hw = 0.26 * g
  let head = partOf(
    [
      [[-hw / 2, 0, -0.04], [hw, hw * 0.7, 0.3 * g], skin],
      [
        [-hw / 2 + 0.02, 0.02, 0.24 * g],
        [hw - 0.04, hw * 0.4, 0.1 * g],
        shade(skin, 0.9),
      ],
      ...both([[hw / 2 - 0.06, hw * 0.45, 0.14 * g], [0.07, 0.05, 0.07], eye]),
      [[-hw / 2 + 0.02, -0.01, 0], [hw - 0.04, 0.03, 0.3 * g], belly],
      ...given(o.frill, (c) => [
        ...both([[hw / 2 - 0.02, -0.02, -0.08], [0.16 * g, hw, 0.06], c]),
        [[-0.04, hw * 0.7, -0.1], [0.08, 0.14 * g, 0.2], c],
      ]),
      ...given(o.horns, (c) => [
        ...both([[hw / 2 - 0.1, hw * 0.7, -0.06], [0.06, 0.2 * g, 0.06], c]),
        ...both([
          [hw / 2 - 0.1, hw * 0.7 + 0.18 * g, -0.14],
          [0.06, 0.06, 0.12],
          c,
        ]),
      ]),
    ],
    [0, 0, 0.05],
    0.05,
  )
  body.add(head)
  let phase = Math.random() * 6
  return {
    root,
    material: m,
    height: 0.6 * g + 0.3,
    animate: (a, dt) => {
      let amp = Math.min(1, a.speed / 2.5)
      phase += dt * (1.2 + a.speed * 3)
      let sway = 0.05 + amp * 0.12
      let up = a.swing >= 0 ? lunge(a.swing, 0.5) : 0
      for (let [i, l] of links.entries()) {
        l.position.x = Math.sin(phase - i * 0.9) * sway * g * (1 + i * 0.15)
        l.rotation.y = Math.cos(phase - i * 0.9) * sway * 1.6
        // The lengths behind the head follow it into a strike.
        l.position.z = -(i + 0.5) * step +
          up * 0.35 * g * Math.max(0, 1 - i / 3)
      }
      // At rest it holds its head a little up; striking, it rears and falls.
      let rear = (0.18 + (1 - amp) * 0.12) * g + up * 0.3 * g
      head.position.set(
        Math.sin(phase + 0.9) * sway * g * 0.6,
        rear,
        0.05 + up * 0.35 * g,
      )
      head.rotation.set(
        -0.3 * (1 - up) + up * 0.5,
        Math.sin(a.t * 0.8) * 0.2,
        0,
      )
      links[0].position.y = rear * 0.45
      links[0].rotation.x = -0.6 * rear / g
      if (a.down) {
        body.rotation.z = Math.PI
        body.position.y = 0.2 * g
      } else {
        body.rotation.z = 0
        body.position.y = 0
      }
      flash(m, a.hurt * 0.8)
    },
  }
}
