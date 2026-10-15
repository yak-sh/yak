// Particle weather from a caller's catalogue of emitter values.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import { bits } from './fx.ts'

export type Air = {
  color: number
  glow?: boolean
  rate: number
  spread: number
  low: number
  high: number
  speed: number
  up: number
  fall: number
  life: number
  size: number
}

export type AirView = {
  tick: (at: THREE.Vector3, dt: number, name?: string) => void
}

/** The air over `scene`: `tick` sends what drifts in the air named, if
 * any, round `at`, and lets what drifts in any other it sent settle, so a
 * focus moving between emitter kinds sees the one air give way to the
 * other. */
export let airOf = (
  scene: THREE.Scene,
  airs: Readonly<Record<string, Air>>,
): AirView => {
  let blowing = new Map<
    string,
    { pool: ReturnType<typeof bits>; owed: number }
  >()
  let p = new THREE.Vector3()
  return {
    tick: (at: THREE.Vector3, dt: number, name?: string) => {
      let a = name ? airs[name] : undefined
      if (a && name && !blowing.has(name)) {
        let pool = bits(scene, !a.glow, Math.ceil(a.rate * a.life * 1.2))
        blowing.set(name, { pool, owed: 0 })
      }
      for (let [n, b] of blowing) {
        let air = airs[n]
        if (n == name) b.owed += air.rate * Math.min(dt, 0.1)
        for (; b.owed >= 1; b.owed--) {
          let r = air.spread * Math.sqrt(Math.random()), t = Math.random() * 7
          p.set(
            at.x + Math.cos(t) * r,
            at.y + air.low + Math.random() * (air.high - air.low),
            at.z + Math.sin(t) * r,
          )
          b.pool.emit(p, air.color, 1, {
            speed: air.speed,
            up: air.up,
            fall: air.fall,
            life: air.life,
            size: air.size,
          })
        }
        b.pool.tick(dt)
      }
    },
  }
}
