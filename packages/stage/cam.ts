// The camera: behind and above the hero, turned by dragging and pulled in or
// out by the wheel. It keeps the chosen orbit until asked to swing behind the
// hero (`snap`). It keeps its distance unless a hill or a house is in the way,
// when it comes in at once, and it eases back
// out after. While the hero is in a building it rises to look down into it
// over the walls, the roof and the floors over them faded (solid.ts
// `cutaway`), and that building's walls never pull it in. It sees from a
// little way before it out to where the fog hides everything, and no further
// (`depth`).
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
export type CameraIntent = {
  orbit: [number, number]
  turn: number
  zoom: number
  look: boolean
  snap: boolean
  faceMove: boolean
}
let clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

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
  /** it is swinging round behind the hero */
  snap: boolean
  /** a free look keeps movement relative to the hero until steering or snap */
  orbiting: boolean
  /** the least it looks down, raised while the hero is in a building */
  lift: number
}

/** How near the camera comes to the hero, in metres, when the level is in
 * the way. */
export let CLOSEST = 1.2

/** How near the camera sees, in metres: as far out as the hero's nearest side
 * ever comes, at its closest, so the depth buffer is as fine as it can be
 * (mesh.ts `STEP`). Nearer than that, a wall the camera backs against is
 * seen through anyway (soft.ts `see`). */
export let NEAR = 0.5

/** Fit `camera`'s depth to what it can see: from NEAR out to the far edge of
 * the level's fog, past which nothing shows. */
export let depth = (camera: THREE.PerspectiveCamera, fog: THREE.Fog): void => {
  if (camera.near == NEAR && camera.far == fog.far) return
  camera.near = NEAR
  camera.far = fog.far
  camera.updateProjectionMatrix()
}

// How fast it swings behind the hero when asked.
let SNAP = 12

/** Turn the camera for a frame: as the hands turned and pulled it, or round
 * behind a hero facing `yaw` when asked. Holding the stick sideways cannot
 * make the view spin.
 *
 * ```ts
 * import { assertAlmostEquals, assertEquals } from '@std/assert'
 * let hands = (move: [number, number], more = {}) => ({
 *   move, turn: 0, faceMove: false, jump: false, strike: false, ability: 0,
 *   dodge: false, talk: false, gather: false, drink: false, snap: false,
 *   mic: false,
 *   orbit: [0, 0] as [number, number], look: false, zoom: 0, ...more,
 * })
 * let cam = () => ({
 *   yaw: 0, pitch: 0.4, dist: 9, reach: 9, x: 0, y: 0, z: 0, shake: 0,
 *   snap: false, orbiting: false, lift: 0,
 * })
 * // A hero facing +x has the camera behind them at -x, which is yaw -π/2.
 * let run = (c: ReturnType<typeof cam>, i: ReturnType<typeof hands>) => {
 *   for (let f = 0; f < 60; f++) steer(c, f ? { ...i, snap: false } : i, Math.PI / 2, 1 / 60)
 *   return c.yaw
 * }
 * assertAlmostEquals(run(cam(), hands([0, 0], { snap: true })), -Math.PI / 2, 1e-9)
 * assertEquals(run(cam(), hands([1, 0])), 0)
 * assertEquals(run(cam(), hands([1, 0], { faceMove: true })), 0)
 * assertEquals(run(cam(), hands([0, 1], { look: true })), 0)
 * let turned = cam()
 * steer(turned, hands([0, 0], { turn: -6 }), Math.PI, 0.1)
 * assertAlmostEquals(turned.yaw, 0.6)
 * ```
 */
export let steer = (
  cam: Cam,
  i: CameraIntent,
  yaw: number,
  dt: number,
): void => {
  let [dx, dy] = i.orbit
  cam.yaw += dx - i.turn * dt
  cam.pitch = clamp(cam.pitch + dy, 0.1, 1.3)
  cam.dist = clamp(cam.dist * (1 + i.zoom * 0.12), 4, 22)
  if (i.look && (dx || dy)) cam.orbiting = true
  else if (dx || dy) cam.orbiting = false
  if (i.snap) cam.snap = true
  else if (dx || dy || i.turn || i.faceMove || i.look) cam.snap = false
  let off = Math.atan2(
    Math.sin(yaw + Math.PI - cam.yaw),
    Math.cos(yaw + Math.PI - cam.yaw),
  )
  // A snap ends where it meant to: right behind the hero.
  if (cam.snap && Math.abs(off) < 0.02) {
    cam.yaw += off
    cam.snap = false
    cam.orbiting = false
    return
  }
  if (cam.snap) cam.yaw += off * (1 - Math.exp(-dt * SNAP))
}

/** Free orbit changes the view, not where the keys say forward is. A turning
 * key changes both the camera and the hero's heading this frame. The stick
 * keeps moving in screen space so its direction remains direct on touch. */
export let moveLook = <I extends CameraIntent>(
  cam: Cam,
  i: I,
  yaw: number,
  dt: number,
) => cam.orbiting && !i.faceMove ? yaw - Math.PI - i.turn * dt : cam.yaw

/** Which way the camera looks, in whole degrees clockwise from north (-z).
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(bearing(0), 0) // from the south, looking north
 * assertEquals(bearing(-Math.PI / 2), 90) // from the west, looking east
 * assertEquals(bearing(Math.PI / 2 + 4 * Math.PI), 270)
 * ```
 */
export let bearing = (yaw: number): number =>
  (Math.round(-yaw * 180 / Math.PI) % 360 + 360) % 360

/** Orbit around target, shortening the arm immediately when blocked and
 * easing it back out. The caller supplies collision and the minimum pitch. */
export let aim = (
  cam: Cam,
  camera: THREE.Camera,
  target: THREE.Vector3,
  blocked: (point: THREE.Vector3) => boolean,
  dt: number,
  lift = 0,
): void => {
  cam.lift += (lift - cam.lift) * (1 - Math.exp(-dt * 3))
  let pitch = Math.max(cam.pitch, cam.lift)
  let cp = Math.cos(pitch)
  let dir = new THREE.Vector3(
    Math.sin(cam.yaw) * cp,
    Math.sin(pitch),
    Math.cos(cam.yaw) * cp,
  )
  let clear = cam.dist
  for (let d = CLOSEST; d <= cam.dist; d += 0.4) {
    let p = target.clone().addScaledVector(dir, d)
    if (
      blocked(p)
    ) {
      clear = Math.max(CLOSEST, d - 0.6)
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
