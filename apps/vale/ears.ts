// The ears: one pair, standing where the camera stands and turned the way it
// looks, behind the hero while it follows them and wherever the view is when
// it is free. Web Audio pans and fades every sound in the vale by itself
// (sound.ts gives each source a PannerNode with `FALLOFF`); `hear` is the
// same sum done by hand, so the page knows a sound too far off to hear before
// it makes one, and a test can say where a sound is heard.
// @ts-types="npm:@types/three@^0.186.0"
import type * as THREE from 'three'
import type { Vec3 } from './play.ts'

/** Where the ears are, which way they face, and which way is up for them:
 * what Web Audio's `AudioListener` is told each frame. */
export type Ear = { at: Vec3; forward: Vec3; up: Vec3 }

/** How every source is heard. HRTF places a sound all round the head, above
 * and behind as well as left and right. Out to `refDistance` a sound is at
 * its own loudness, about where the camera stands behind the hero; beyond,
 * it halves with each doubling of the distance, as sound does in the open. */
export let FALLOFF = {
  panningModel: 'HRTF',
  distanceModel: 'inverse',
  refDistance: 6,
  rolloffFactor: 1,
} satisfies PannerOptions

/** Below this loudness at the ears a sound is not made at all: a footstep
 * dies away within some 25 m, a blow carries across a level. */
export let QUIET = 0.008

let sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
let dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
let cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
let norm = (a: Vec3): Vec3 => {
  let l = Math.hypot(...a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

/** The ears of a camera: where it stands, looking down its own -z, its +y
 * up. */
export let ear = (eye: THREE.Object3D): Ear => {
  eye.updateMatrixWorld()
  let m = eye.matrixWorld.elements
  return {
    at: [m[12], m[13], m[14]],
    forward: norm([-m[8], -m[9], -m[10]]),
    up: norm([m[4], m[5], m[6]]),
  }
}

/** What the ears make of a sound at `at`: how far to their right it is, from
 * -1 hard left to 1 hard right; how far ahead, from -1 behind to 1 before
 * them; and how loud, 1 at `refDistance` or nearer. Right is forward × up,
 * as Web Audio has it.
 *
 * ```ts
 * import { assert, assertAlmostEquals, assertEquals } from '@std/assert'
 * import * as THREE from 'three'
 * // The camera behind and above a hero at (20, 6, 20), looking at them.
 * let eye = new THREE.PerspectiveCamera()
 * eye.position.set(26, 10, 28)
 * eye.lookAt(20, 6, 20)
 * let e = ear(eye)
 * // Its right and ahead, as it draws them.
 * let right = new THREE.Vector3(1, 0, 0).applyQuaternion(eye.quaternion)
 * let ahead = new THREE.Vector3(0, 0, -1).applyQuaternion(eye.quaternion)
 * let from = (dir: THREE.Vector3, d: number) => {
 *   let p = eye.position.clone().addScaledVector(dir, d)
 *   return hear(e, [p.x, p.y, p.z])
 * }
 * // A sound to the camera's right is heard on the right, and to its left
 * // on the left, whichever way the camera is turned.
 * assertAlmostEquals(from(right, 5).side, 1, 1e-9)
 * assertAlmostEquals(from(right, -5).side, -1, 1e-9)
 * // The hero it looks at is dead ahead.
 * let hero = hear(e, [20, 6, 20])
 * assertAlmostEquals(hero.side, 0, 1e-9)
 * assertAlmostEquals(hero.ahead, 1, 1e-9)
 * assertAlmostEquals(from(ahead, -5).ahead, -1, 1e-9)
 * // Near the camera a sound is at its own loudness; further off it fades,
 * // halving as the distance doubles.
 * assertEquals(from(right, 2).gain, 1)
 * assert(from(right, 12).gain < from(right, 8).gain)
 * assertAlmostEquals(from(ahead, 80).gain / from(ahead, 40).gain, 0.5, 1e-9)
 * ```
 */
export let hear = (e: Ear, at: Vec3) => {
  let to = sub(at, e.at)
  let d = Math.hypot(...to)
  let r = FALLOFF.refDistance
  return {
    side: d ? dot(to, norm(cross(e.forward, e.up))) / d : 0,
    ahead: d ? dot(to, e.forward) / d : 0,
    gain: r / (r + FALLOFF.rolloffFactor * (Math.max(d, r) - r)),
  }
}
