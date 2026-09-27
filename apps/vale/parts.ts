// The joinery every figure is built from (figures.ts, bodies/): a part is a
// few soft boxes (boxes.ts) turning about a pivot, and a figure is
// parts hung on parts. A limb is two parts bending at a knee or an elbow
// (`limb`), its halves overlapping at the joint so a bend opens no gap. Most
// of a creature is left and right alike, so a box can be given once and
// mirrored (`both`).
//
// A part is a bone, and a figure's parts are drawn together as one skinned
// mesh (`knit`): one draw call and one shadow for the whole figure, however
// many joints it bends at. A part's boxes are one solid, each worn over those
// before it (boxes.ts), and a part is worn over the parts before it where
// they lie square to each other as the figure is built: a thigh against a
// flank, a hand round a hilt.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import { type Box, drawn, moved, type Solid, worn } from './boxes.ts'
import { out, pack, place, type Vec } from './mesh.ts'
import { geometry } from './soft.ts'

/** A limb: the part at the hip or shoulder, and the one below the joint. */
export type Limb = [THREE.Bone, THREE.Bone]

/** A leg: one part, or a limb. */
export type Leg = THREE.Object3D | Limb

/** A part: boxes turning about `pivot`, tinted in voxels of edge `cell`. It
 * is drawn once its figure is knitted. */
export let partOf = (boxes: Box[], pivot: Vec, cell = 0.1): THREE.Bone => {
  let b = new THREE.Bone()
  b.position.set(...pivot)
  b.userData.boxes = boxes
  b.userData.cell = cell
  return b
}

/** A limb bending partway down, at a knee or an elbow: `upper` turning at
 * `pivot`, and `lower` hung from it, turning at `joint` in the upper's space.
 */
export let limb = (
  upper: Box[],
  lower: Box[],
  pivot: Vec,
  joint: Vec,
): Limb => {
  let a = partOf(upper, pivot), b = partOf(lower, joint)
  a.add(b)
  return [a, b]
}

// Where a point in `from`'s space lies in `to`'s, as the figure stands, when
// the two are turned square to each other, by quarter turns; otherwise null.
let square = (from: THREE.Object3D, to: THREE.Object3D) => {
  let m = to.matrixWorld.clone().invert().multiply(from.matrixWorld)
  let e = m.elements
  for (let c = 0; c < 12; c += 4) {
    let col = [e[c], e[c + 1], e[c + 2]], n = Math.hypot(...col)
    if (col.filter((x) => Math.abs(x) > n * 1e-6).length != 1) return null
  }
  let v = new THREE.Vector3()
  return ([x, y, z]: Vec): Vec => {
    v.set(x, y, z).applyMatrix4(m)
    return [v.x, v.y, v.z]
  }
}

/** Draw every part under `root` as one skinned mesh in `material`, each part
 * a bone of it. A part's boxes stay in its own space and its bone carries
 * them wherever the part is turned, so a pose is set on the parts as before.
 * Each part is worn over the parts before it that lie square to it, and what
 * it is drawn as is kept on its bone (`userData.part`).
 *
 * ```ts
 * import { assertAlmostEquals, assertEquals } from '@std/assert'
 * import * as THREE from 'three'
 * import { STEP } from './mesh.ts'
 * let root = new THREE.Group()
 * let flank = partOf([[[-0.3, 0, -0.5], [0.6, 0.4, 1], 0x806040]], [0, 1, 0])
 * // A thigh hung beside the flank, its outer side in the flank's plane.
 * let thigh = partOf([[[-0.1, -0.5, -0.1], [0.2, 0.7, 0.2], 0x604830]], [0.2, 1, 0])
 * root.add(flank, thigh)
 * let mesh = knit(root, new THREE.MeshLambertMaterial())
 * assertEquals([mesh.skeleton.bones.length, root.children.length], [2, 3])
 * // It is worn over the flank: its side stands a step outside.
 * let xs = thigh.userData.part.pos.filter((_: number, i: number) => i % 3 == 0)
 * assertAlmostEquals(Math.max(...xs), 0.1 + STEP, 1e-9)
 * ```
 */
export let knit = (root: THREE.Object3D, material: THREE.Material) => {
  let bones: THREE.Bone[] = []
  root.traverse((o) => {
    if (o instanceof THREE.Bone && o.userData.boxes) bones.push(o)
  })
  root.updateMatrixWorld(true)
  let solids: Solid[][] = []
  let all = out(), index: number[] = [], weight: number[] = []
  for (let [i, b] of bones.entries()) {
    let under = bones.slice(0, i).flatMap((a, j) => {
      let f = square(a, b)
      return f ? moved(solids[j], f) : []
    })
    solids.push(worn(b.userData.boxes, undefined, under))
    let part = drawn(out(), solids[i], b.userData.cell)
    b.userData.part = part
    place(all, part, [0, 0, 0])
    for (let v = 0; v < part.pos.length; v += 3) {
      index.push(i, 0, 0, 0)
      weight.push(1, 0, 0, 0)
    }
  }
  let g = geometry(pack(all))
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(index, 4))
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weight, 4))
  let mesh = new THREE.SkinnedMesh(g, material)
  mesh.castShadow = true
  // Each bone's inverse is the identity: a part's vertices are already in its
  // bone's space, so the bone's place in the world is the part's.
  mesh.bind(
    new THREE.Skeleton(bones, bones.map(() => new THREE.Matrix4())),
    new THREE.Matrix4(),
  )
  root.add(mesh)
  // Its bounds, from the pose it is built in, with room for a limb flung out
  // or a lunge: what the camera judges whether to draw it by.
  root.updateMatrixWorld(true)
  mesh.computeBoundingSphere()
  let bound = mesh.boundingSphere!
  bound.radius = bound.radius * 1.4 + 0.3
  return mesh
}

/** A box mirrored across the middle, from right to left.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(mirror([[0.25, 0, 0], [0.5, 1, 1], 7]), [[-0.75, 0, 0], [0.5, 1, 1], 7])
 * ```
 */
export let mirror = ([[x, y, z], size, ...rest]: Box): Box => [
  [-x - size[0], y, z],
  size,
  ...rest,
]

/** A box and its mirror, right and left. */
export let both = (b: Box): Box[] => [b, mirror(b)]

/** A box toppled forward, a quarter turn about x: what stood up runs toward
 * +z, and what lay toward +z hangs below.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(topple([[0, 0, 0], [1, 2, 3], 7]), [[0, -3, 0], [1, 3, 2], 7])
 * ```
 */
export let topple = ([[x, y, z], [w, h, d], ...rest]: Box): Box => [
  [x, -z - d, y],
  [w, d, h],
  ...rest,
]

/** Boxes drawn for a part of one size, fit to a part `k` times it along
 * each axis, about the part's pivot.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(fit([[[-0.5, 0, 0], [1, 1, 1], 7]], [2, 1, 0.5]), [
 *   [[-1, 0, 0], [2, 1, 0.5], 7],
 * ])
 * ```
 */
export let fit = (boxes: Box[], k: Vec): Box[] =>
  boxes.map(([min, size, ...rest]) => [
    [min[0] * k[0], min[1] * k[1], min[2] * k[2]],
    [size[0] * k[0], size[1] * k[1], size[2] * k[2]],
    ...rest,
  ])

/** The boxes `f` makes of `v`, or none without a `v`: what a figure has only
 * when its look says so.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import type { Box } from './boxes.ts'
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

/** A leg's step in a walk, `s` and `c` the sine and cosine of how far
 * through it, `amp` how far it swings: back and forth from the hip, and bent
 * at the knee while the foot comes forward.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import * as THREE from 'three'
 * let leg: Limb = [new THREE.Bone(), new THREE.Bone()]
 * stride(leg, 0, -1, 0.5) // passing under the hip, coming forward
 * assertEquals([leg[0].rotation.x, leg[1].rotation.x], [0, 0.75])
 * stride(leg, 0, 1, 0.5) // pushing back: straight
 * assertEquals(leg[1].rotation.x, 0)
 * ```
 */
export let stride = (leg: Leg, s: number, c: number, amp: number) => {
  let [hip, knee] = Array.isArray(leg) ? leg : [leg]
  hip.rotation.x = s * amp
  if (knee) knee.rotation.x = Math.max(0, -c) * amp * 1.5
}

/** Four legs in a walk: each diagonal pair together. */
export let trot = (legs: Leg[], s: number, c: number, amp: number) =>
  legs.forEach((l, i) =>
    i == 1 || i == 2 ? stride(l, -s, -c, amp) : stride(l, s, c, amp)
  )
