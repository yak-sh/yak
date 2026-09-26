// The camera: behind and above the hero, turned by dragging and pulled in or
// out by the wheel. It follows, easing round behind the hero while they go
// forward, or it is free and stays where it was turned; either way it swings
// round behind the hero when asked (`snap`). It keeps its distance unless a
// hill or a house is in the way, when it comes in at once, and it eases back
// out after.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import type { Intent } from './input.ts'
import { clamp } from './rand.ts'
import { inside, type Vale } from './terrain.ts'

export type Cam = {
  /** which way it looks from, round the hero: 0 looks from +z */
  yaw: number
  pitch: number
  /** how far back it stands, and how far it can stand this frame */
  dist: number
  reach: number
  /** the point it follows, eased after the hero */
  x: number
  y: number
  z: number
  shake: number
  /** it eases round behind the hero while they go forward */
  follow: boolean
  /** it is swinging round behind the hero */
  snap: boolean
  /** seconds since the view was last turned by hand */
  idle: number
}

// How fast it swings behind the hero, snapping and following, and how long
// after a turn by hand following waits.
let SNAP = 12
let FOLLOW = 2.5
let WAIT = 1

/** Turn the camera for a frame: as the hands turned and pulled it, and round
 * behind a hero facing `yaw`, at once when snapping and gently while
 * following them forward.
 *
 * ```ts
 * import { assert, assertAlmostEquals, assertEquals } from '@std/assert'
 * let hands = (move: [number, number], more = {}) => ({
 *   move, jump: false, strike: false, dodge: false, talk: false,
 *   drink: false, snap: false, follow: false,
 *   orbit: [0, 0] as [number, number], zoom: 0, ...more,
 * })
 * let cam = (follow: boolean) => ({
 *   yaw: 0, pitch: 0.4, dist: 9, reach: 9, x: 0, y: 0, z: 0, shake: 0,
 *   follow, snap: false, idle: 5,
 * })
 * // A hero facing +x has the camera behind them at -x, which is yaw -π/2.
 * let run = (c: ReturnType<typeof cam>, i: ReturnType<typeof hands>) => {
 *   for (let f = 0; f < 60; f++) steer(c, f ? { ...i, snap: false } : i, Math.PI / 2, 1 / 60)
 *   return c.yaw
 * }
 * assertAlmostEquals(run(cam(false), hands([0, 0], { snap: true })), -Math.PI / 2, 1e-9)
 * assertEquals(run(cam(false), hands([0, 1])), 0) // free: stays put
 * assert(run(cam(true), hands([0, 1])) < -0.5) // following: comes round
 * assertEquals(run(cam(true), hands([1, 0])), 0) // not while going sideways
 * ```
 */
export let steer = (cam: Cam, i: Intent, yaw: number, dt: number) => {
  let [dx, dy] = i.orbit
  cam.yaw += dx
  cam.pitch = clamp(cam.pitch + dy, 0.1, 1.3)
  cam.dist = clamp(cam.dist * (1 + i.zoom * 0.12), 4, 22)
  cam.idle = dx || dy ? 0 : cam.idle + dt
  if (i.follow) cam.follow = !cam.follow
  if (i.snap || (i.follow && cam.follow)) cam.snap = true
  if (!cam.idle) cam.snap = false
  let off = Math.atan2(
    Math.sin(yaw + Math.PI - cam.yaw),
    Math.cos(yaw + Math.PI - cam.yaw),
  )
  // A snap ends where it meant to: right behind the hero.
  if (cam.snap && Math.abs(off) < 0.02) {
    cam.yaw += off
    cam.snap = false
    return
  }
  let k = cam.snap
    ? SNAP
    : cam.follow && cam.idle > WAIT
    ? FOLLOW * Math.max(0, i.move[1])
    : 0
  cam.yaw += off * (1 - Math.exp(-dt * k))
}

/** Put `camera` where the camera stands, looking at `target`: its distance
 * back, or nearer when the level is in the way, shaken by a blow. */
export let aim = (
  cam: Cam,
  camera: THREE.Camera,
  target: THREE.Vector3,
  v: Vale,
  dt: number,
) => {
  let cp = Math.cos(cam.pitch)
  let dir = new THREE.Vector3(
    Math.sin(cam.yaw) * cp,
    Math.sin(cam.pitch),
    Math.cos(cam.yaw) * cp,
  )
  let clear = cam.dist
  for (let d = 1.2; d <= cam.dist; d += 0.4) {
    let p = target.clone().addScaledVector(dir, d)
    if (inside(v, p.x, p.y, p.z)) {
      clear = Math.max(1.2, d - 0.6)
      break
    }
  }
  cam.reach = clear < cam.reach
    ? clear
    : cam.reach + (clear - cam.reach) * (1 - Math.exp(-dt * 2.5))
  camera.position.copy(target).addScaledVector(dir, cam.reach)
  if (cam.shake > 0.002) {
    camera.position.x += (Math.random() - 0.5) * cam.shake
    camera.position.y += (Math.random() - 0.5) * cam.shake
    cam.shake *= Math.exp(-dt * 12)
  }
  camera.lookAt(target)
}
