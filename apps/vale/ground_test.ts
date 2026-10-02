import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import * as THREE from 'three'
import { groundChunk } from './ground.ts'
import { out } from './mesh.ts'
import { flat, NONE } from './terrain.ts'

test('mountain steps above a cave retain their exposed sides and open space', () => {
  for (let voxel of [0.5, 1, 2]) {
    for (let [i, k] of [[1, 1], [0, 1]]) {
      for (let mouth of [false, true]) {
        let p = flat(14 * voxel, [], [], voxel).grow(0, 0)
        let j = i + 1 + (k + 1) * p.n
        p.layers.push(
          new Int16Array(p.n * p.n).fill(12),
          new Int16Array(p.n * p.n).fill(3),
        )
        if (mouth) {
          p.layers[0].fill(NONE)
          p.layers[1].fill(NONE)
        }
        p.layers[0][j] = 16
        p.layers[1][j] = 14
        let roof = out()
        groundChunk(p, out(), roof)
        let geometry = new THREE.BufferGeometry()
        geometry.setAttribute(
          'position',
          new THREE.Float32BufferAttribute(roof.pos, 3),
        )
        geometry.setIndex(roof.idx)
        let mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
        for (let [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          let hit = (y: number) =>
            new THREE.Raycaster(
              new THREE.Vector3(
                (i + 0.5 + dx * 0.75) * voxel,
                y * voxel,
                (k + 0.5 + dz * 0.75) * voxel,
              ),
              new THREE.Vector3(-dx, 0, -dz),
              0,
              0.5 * voxel,
            ).intersectObject(mesh).length > 0
          assertEquals(hit(15), true)
          assertEquals(hit(5), false)
        }
        geometry.dispose()
        mesh.material.dispose()
      }
    }
  }
})
