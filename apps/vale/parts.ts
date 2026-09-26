// The joinery every figure is built from (figures.ts, bodies/): a part is a
// few soft boxes (mesh.ts `cuboid`) turning about a pivot, and a figure is
// parts hung on parts. Most of a creature is left and right alike, so a box
// can be given once and mirrored (`both`).
//
// A part is a bone, and a figure's parts are drawn together as one skinned
// mesh (`knit`): one draw call and one shadow for the whole figure, however
// many joints it bends at.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import { cuboid, type Out, out, place, type Vec } from './mesh.ts'
import { geometry } from './soft.ts'

/** One box of a part: its low corner and its size, in metres from the part's
 * pivot, and its colour. */
export type Box = [Vec, Vec, number]

/** A part: boxes turning about `pivot`, tinted in voxels of edge `cell`. It
 * is drawn once its figure is knitted. */
export let partOf = (boxes: Box[], pivot: Vec, cell = 0.1): THREE.Bone => {
  let o = out()
  for (let [min, size, color] of boxes) cuboid(o, min, size, color, cell)
  let b = new THREE.Bone()
  b.position.set(...pivot)
  b.userData.part = o
  return b
}

/** Draw every part under `root` as one skinned mesh in `material`, each part
 * a bone of it. A part's boxes stay in its own space and its bone carries
 * them wherever the part is turned, so a pose is set on the parts as before.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import * as THREE from 'three'
 * let root = new THREE.Group()
 * let arm = partOf([[[0, 0, 0], [0.2, 0.6, 0.2], 0xffffff]], [0.3, 1, 0])
 * root.add(partOf([[[0, 0, 0], [0.4, 1, 0.3], 0xffffff]], [0, 0, 0]), arm)
 * let mesh = knit(root, new THREE.MeshLambertMaterial())
 * assertEquals([mesh.skeleton.bones.length, root.children.length], [2, 3])
 * ```
 */
export let knit = (root: THREE.Object3D, material: THREE.Material) => {
  let bones: THREE.Bone[] = []
  root.traverse((o) => {
    if (o instanceof THREE.Bone && o.userData.part) bones.push(o)
  })
  let all = out(), index: number[] = [], weight: number[] = []
  for (let [i, b] of bones.entries()) {
    let part: Out = b.userData.part
    place(all, part, [0, 0, 0])
    for (let v = 0; v < part.pos.length; v += 3) {
      index.push(i, 0, 0, 0)
      weight.push(1, 0, 0, 0)
    }
  }
  let g = geometry(all)
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
