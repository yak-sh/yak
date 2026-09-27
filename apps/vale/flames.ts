// The live flame over a hearth or forge. Every fire in sight shares one
// instanced mesh, whether its building has just streamed in or out.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import type { Vec } from './mesh.ts'

export type Fire = { at: Vec; size: number }

/** Hang a flame mesh in `scene`, sized as fires come into sight, and return
 * its motion for each frame. */
export let flames = (scene: THREE.Scene) => {
  let shape = new THREE.BoxGeometry(1, 1, 1)
  let material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  let mesh: THREE.InstancedMesh | null = null, capacity = 0
  let fit = (n: number) => {
    if (n <= capacity) return
    capacity = Math.max(n, capacity * 2, 6)
    if (mesh) scene.remove(mesh)
    mesh = new THREE.InstancedMesh(shape, material, capacity)
    mesh.frustumCulled = false
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    for (let i = 0; i < capacity; i++) {
      let color = [0xff6124, 0xffa02e, 0xffd15a][i % 3]
      mesh.setColorAt(i, new THREE.Color(color))
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    scene.add(mesh)
  }
  let matrix = new THREE.Matrix4(), at = new THREE.Vector3()
  let turn = new THREE.Quaternion(), size = new THREE.Vector3()
  return (t: number, focus: THREE.Vector3, fires: Fire[]) => {
    let near = fires.filter((f) =>
      Math.hypot(f.at[0] - focus.x, f.at[2] - focus.z) < 110
    )
    if (!near.length) {
      if (mesh) mesh.visible = false
      return
    }
    fit(near.length * 3)
    mesh!.visible = true
    mesh!.count = near.length * 3
    near.forEach((f, i) => {
      for (let j = 0; j < 3; j++) {
        let lick = 1 + Math.sin(t * (8 + j * 3) + i * 7 + j) * 0.23
        let width = f.size * (1 - j * 0.22) * (2 - lick)
        at.set(
          f.at[0] + Math.sin(t * 3 + j * 2 + i) * f.size * 0.25,
          f.at[1] + j * f.size * 0.3 + lick * f.size * 0.35,
          f.at[2] + Math.cos(t * 2 + j * 3 + i) * f.size * 0.18,
        )
        turn.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, t * (j + 1))
        size.set(width, f.size * (1 - j * 0.18) * lick * 1.3, width)
        mesh!.setMatrixAt(i * 3 + j, matrix.compose(at, turn, size))
      }
    })
    mesh!.instanceMatrix.needsUpdate = true
  }
}
