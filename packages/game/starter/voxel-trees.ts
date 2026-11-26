// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import { type Box, cuboids, out, pack } from '@yaks/voxel'
import { geometry, soft } from '@yaks/voxel/three'

let boxes: Box[] = [
  [[-0.25, 0, -0.25], [0.5, 1.25, 0.5], 0x79583d],
  [[-1, 1, -1], [2, 0.5, 2], 0x315f49],
  [[-0.75, 1.5, -0.75], [1.5, 0.5, 1.5], 0x416c46],
  [[-0.5, 2, -0.5], [1, 0.5, 1], 0x557d4c],
  [[-0.25, 2.5, -0.25], [0.5, 0.5, 0.5], 0x729851],
]
let shape = geometry(pack(cuboids(out(), boxes, 0.25)))
let material = soft({ speckle: 0.1 })

export let tree = (): THREE.Mesh => new THREE.Mesh(shape, material)
