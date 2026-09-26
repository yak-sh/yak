// A wisp: a lantern of light hanging in the air, a glowing heart in a paler
// shell, with motes wheeling about it and a flicker trailing below. It glows
// by its own light, and flares when it strikes.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import type { Figure } from '../figures.ts'
import { lunge, partOf, shade } from '../parts.ts'
import { flash, soft } from '../soft.ts'

export type Wisp = {
  core: number
  glow: number
  mote: number
  /** how high it floats, in its own metres */
  fly?: number
}

export let wisp = (o: Wisp): Figure => {
  let m = soft({ speckle: 0.04 })
  if (m instanceof THREE.MeshLambertMaterial) {
    m.emissive.setHex(o.glow)
    m.emissiveIntensity = 0.7
  }
  let rest = (o.fly ?? 1) + 0.3
  let root = new THREE.Group()
  let body = new THREE.Group()
  body.position.y = rest
  root.add(body)
  let heart = partOf(
    [
      [[-0.24, -0.24, -0.24], [0.48, 0.48, 0.48], shade(o.glow, 1.1)],
      [[-0.15, -0.15, -0.26], [0.3, 0.3, 0.52], o.core],
      [[-0.26, -0.15, -0.15], [0.52, 0.3, 0.3], o.core],
      [[-0.15, -0.26, -0.15], [0.3, 0.52, 0.3], o.core],
    ],
    [0, 0, 0],
    0.08,
  )
  body.add(heart)
  let trail = partOf(
    [
      [[-0.12, -0.5, -0.12], [0.24, 0.22, 0.24], o.glow],
      [[-0.07, -0.72, -0.07], [0.14, 0.18, 0.14], shade(o.glow, 1.1)],
      [[-0.04, -0.86, -0.04], [0.08, 0.1, 0.08], o.mote],
    ],
    [0, 0, 0],
    0.05,
  )
  body.add(trail)
  let motes = [0, 1, 2].map(() =>
    partOf([[[-0.05, -0.05, -0.05], [0.1, 0.1, 0.1], o.mote]], [0, 0, 0], 0.05)
  )
  body.add(...motes)
  let phase = Math.random() * 6
  return {
    root,
    material: m,
    height: rest + 0.45,
    animate: (a, dt) => {
      phase += dt * (1.5 + a.speed * 0.8)
      let up = a.swing >= 0 ? lunge(a.swing) : 0
      body.position.set(0, rest + Math.sin(a.t * 1.8 + phase) * 0.12, up * 0.6)
      heart.rotation.set(a.t * 0.7, a.t * 1.1, 0)
      heart.scale.setScalar(1 + Math.sin(a.t * 5) * 0.04 + up * 0.35)
      trail.position.x = Math.sin(a.t * 3 + phase) * 0.06
      trail.rotation.z = Math.sin(a.t * 3 + phase) * 0.2
      for (let [i, mote] of motes.entries()) {
        let t = phase * 2 + (i * Math.PI * 2) / 3
        let r = 0.45 + up * 0.25
        mote.position.set(
          Math.cos(t) * r,
          Math.sin(t * 1.3) * 0.2,
          Math.sin(t) * r,
        )
      }
      if (a.down) {
        body.position.y = 0.2
        heart.scale.setScalar(0.6)
      }
      flash(m, a.hurt * 0.8)
    },
  }
}
