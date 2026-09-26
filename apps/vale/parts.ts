// The joinery every figure is built from (figures.ts, bodies/): a part is a
// few soft boxes (mesh.ts `cuboid`) turning about a pivot, and a figure is
// parts hung on parts. Most of a creature is left and right alike, so a box
// can be given once and mirrored (`both`).
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import { cuboid, out, type Vec } from './mesh.ts'
import { geometry } from './soft.ts'

/** One box of a part: its low corner and its size, in metres from the part's
 * pivot, and its colour. */
export type Box = [Vec, Vec, number]

/** A part: boxes turning about `pivot`, tinted in voxels of edge `cell`. */
export let partOf = (
  material: THREE.Material,
  boxes: Box[],
  pivot: Vec,
  cell = 0.1,
): THREE.Group => {
  let o = out()
  for (let [min, size, color] of boxes) cuboid(o, min, size, color, cell)
  let mesh = new THREE.Mesh(geometry(o), material)
  mesh.castShadow = true
  let g = new THREE.Group()
  g.position.set(...pivot)
  g.add(mesh)
  return g
}

/** A box mirrored across the middle, from right to left.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(mirror([[0.25, 0, 0], [0.5, 1, 1], 7]), [[-0.75, 0, 0], [0.5, 1, 1], 7])
 * ```
 */
export let mirror = ([[x, y, z], size, color]: Box): Box => [
  [-x - size[0], y, z],
  size,
  color,
]

/** A box and its mirror, right and left. */
export let both = (b: Box): Box[] => [b, mirror(b)]

/** The boxes `f` makes of `v`, or none without a `v`: what a figure has only
 * when its look says so.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let tusks = (c: number): Box[] => both([[0.1, 0, 0], [0.1, 0.2, 0.1], c])
 * assertEquals(given(undefined, tusks), [])
 * assertEquals(given(0xffffff, tusks).length, 2)
 * ```
 */
export let given = <T>(v: T | undefined | false, f: (v: T) => Box[]): Box[] =>
  v === undefined || v === false ? [] : f(v)

/** A colour, darker (`k` under 1) or lighter. */
export let shade = (hex: number, k: number) => {
  let c = new THREE.Color(hex)
  c.multiplyScalar(k)
  return c.getHex()
}

export let ease = (t: number) => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2

/** How far into a blow: rising to 1 at `peak` of the swing, and back.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals([lunge(0), lunge(0.4), lunge(1)], [0, 1, 0])
 * ```
 */
export let lunge = (swing: number, peak = 0.4) =>
  swing < peak ? ease(swing / peak) : 1 - ease((swing - peak) / (1 - peak))

/** Four legs in a walk: each diagonal pair together. */
export let trot = (legs: THREE.Object3D[], s: number) => {
  legs[0].rotation.x = legs[3].rotation.x = s
  legs[1].rotation.x = legs[2].rotation.x = -s
}
