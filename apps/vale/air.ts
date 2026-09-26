// What drifts in a level's air (levels.ts `look.air`): snow, rain, ash, embers
// rising, spores, wisps, petals, dust, glints of salt. Each kind of air is a
// row: what colour its bits are and whether they glow, how many a second,
// where round the hero they start (`spread` metres out, `low` to `high`
// metres up), and how they move: flung out at `speed`, `up` at the start
// (down if less than nothing), pulled down by `fall`, gone after `life`
// seconds. None of it is state.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import { bits } from './fx.ts'

type Air = {
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

let air = (
  color: number,
  rate: number,
  o: Partial<Air> = {},
): Air => ({
  color,
  rate,
  spread: 16,
  low: 6,
  high: 12,
  speed: 0.5,
  up: -1.2,
  fall: 0,
  life: 7,
  size: 0.07,
  ...o,
})

/** Every kind of air, by its name. */
export let AIRS: Record<string, Air> = {
  snow: air(0xf6f8fb, 60),
  blizzard: air(0xf2f6fa, 170, { speed: 4, up: -2, life: 4, spread: 14 }),
  rain: air(0xa9bccc, 260, { up: -14, speed: 0.2, life: 0.8, size: 0.05 }),
  ash: air(0x7a746e, 45, { up: -0.6, speed: 0.4, life: 9, size: 0.06 }),
  embers: air(0xff7a2a, 40, {
    glow: true,
    low: -1,
    high: 2,
    up: 1.2,
    fall: -0.2,
    speed: 0.6,
    life: 3,
    size: 0.06,
  }),
  spores: air(0xc8e07a, 26, {
    glow: true,
    low: -1,
    high: 4,
    up: 0.25,
    speed: 0.3,
    life: 6,
    size: 0.05,
  }),
  glowspores: air(0x8ab8ff, 30, {
    glow: true,
    low: -1,
    high: 5,
    up: 0.2,
    speed: 0.25,
    life: 7,
    size: 0.05,
  }),
  wisps: air(0x9ff0d0, 5, {
    glow: true,
    low: 0,
    high: 3,
    up: 0.1,
    speed: 0.6,
    life: 5,
    size: 0.13,
  }),
  motes: air(0xffe6a0, 16, {
    glow: true,
    low: 0,
    high: 5,
    up: 0.15,
    speed: 0.2,
    life: 5,
    size: 0.04,
  }),
  sparkle: air(0xd8c4ff, 14, {
    glow: true,
    low: 0,
    high: 6,
    up: 0.05,
    speed: 0.1,
    life: 2.5,
    size: 0.05,
  }),
  glints: air(0xffffff, 18, {
    glow: true,
    low: 0,
    high: 2,
    up: 0.05,
    speed: 1.2,
    life: 2,
    size: 0.03,
  }),
  pollen: air(0xffe07a, 20, {
    glow: true,
    low: 0,
    high: 3,
    up: 0.1,
    speed: 0.3,
    life: 5,
    size: 0.035,
  }),
  petals: air(0xf6c8d8, 12, { up: -0.5, speed: 0.8, life: 6, size: 0.06 }),
  fluff: air(0xfaf6ea, 12, { up: -0.2, speed: 0.6, life: 8, size: 0.05 }),
  leaves: air(0xb8903a, 8, { up: -0.7, speed: 0.9, life: 7, size: 0.08 }),
  dust: air(0xd8c29a, 45, {
    low: 0,
    high: 3,
    speed: 2.5,
    up: 0.3,
    fall: 0.2,
    life: 3,
    size: 0.08,
  }),
  spray: air(0xe8f2f6, 30, {
    low: 0,
    high: 2,
    speed: 2,
    up: 1.5,
    fall: 2,
    life: 1.5,
    size: 0.05,
  }),
}

/** A level's air over `scene`, if it has one: `tick` sends what drifts round
 * `at`. */
export let airOf = (scene: THREE.Scene, name?: string) => {
  let a = name ? AIRS[name] : undefined
  if (!a) return { tick: (_at: THREE.Vector3, _dt: number) => {} }
  let pool = bits(scene, !a.glow, Math.ceil(a.rate * a.life * 1.2))
  let p = new THREE.Vector3()
  let owed = 0
  return {
    tick: (at: THREE.Vector3, dt: number) => {
      owed += a.rate * Math.min(dt, 0.1)
      for (; owed >= 1; owed--) {
        let r = a.spread * Math.sqrt(Math.random()), t = Math.random() * 7
        p.set(
          at.x + Math.cos(t) * r,
          at.y + a.low + Math.random() * (a.high - a.low),
          at.z + Math.sin(t) * r,
        )
        pool.emit(p, a.color, 1, {
          speed: a.speed,
          up: a.up,
          fall: a.fall,
          life: a.life,
          size: a.size,
        })
      }
      pool.tick(dt)
    },
  }
}
