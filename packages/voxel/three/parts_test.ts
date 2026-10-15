// A figure's parts are knitted into one skinned mesh, each part worn over the
// parts before it that lie square to it.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import { equal, test } from '@yaks/testing'
import { STEP } from '../mesh.ts'
import { knit, partOf } from './parts.ts'

let root = new THREE.Group()
let flank = partOf([[[-0.3, 0, -0.5], [0.6, 0.4, 1], 0x806040]], [0, 1, 0], 1)
// A thigh hung beside the flank, its outer side in the flank's plane.
let thigh = partOf(
  [[[-0.1, -0.5, -0.1], [0.2, 0.7, 0.2], 0x604830]],
  [0.2, 1, 0],
  1,
)
root.add(flank, thigh)
let mesh = knit(root, new THREE.MeshLambertMaterial())

test('knit draws every part as a bone of one mesh', () => {
  equal([mesh.skeleton.bones.length, root.children.length], [2, 3])
})

test('a part is worn over the part before it: its side stands a step outside', () => {
  let xs = thigh.userData.part.pos.filter((_: number, i: number) => i % 3 == 0)
  equal(Math.abs(Math.max(...xs) - (0.1 + STEP)) < 1e-9, true)
})
