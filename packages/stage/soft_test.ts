// The material accepts packed voxel arrays and updates only the requested effects.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import { equal, test } from '@yaks/testing'
import { cuboids } from '@yaks/voxel/boxes'
import { out, pack } from '@yaks/voxel/mesh'
import { cut, flash, geometry, night, sight, soft } from './soft.ts'

test('packed geometry keeps the mesher arrays and their bounds', () => {
  let p = pack(cuboids(out(), [[[1, 2, 3], [2, 4, 6], 0x807060]]))
  let g = geometry(p)
  equal(g.getAttribute('position').array, p.pos)
  equal(g.getAttribute('normal').itemSize, 4)
  equal(g.getAttribute('color').normalized, true)
  equal(g.boundingBox!.min.toArray(), [1, 2, 3])
  equal(g.boundingBox!.max.toArray(), [3, 6, 9])
  g.dispose()
})

test('material effects replace sight and cut values and clear unused entries', () => {
  let m = soft({ see: true })
  let u = m.userData.soft
  sight(m, new THREE.Vector3(1, 2, 3), new THREE.Vector3(4, 5, 6), 2, [
    new THREE.Vector4(7, 8, 9, 1),
  ])
  equal(u.seeFrom.value.toArray(), [1, 2, 3])
  equal(u.seeFeet.value.toArray(), [4, 5, 6])
  equal(u.seeTall.value, 2)
  equal(u.seeFoes.value[0].toArray(), [7, 8, 9, 1])
  sight(m, new THREE.Vector3(), new THREE.Vector3(), 1)
  equal(u.seeFoes.value[0].toArray(), [0, 0, 0, 0])
  cut(m, [{ lo: [1, 2, 3], hi: [4, 5, 6], fade: 0.5 }])
  equal(u.cutLo.value[0].toArray(), [1, 2, 3, 0.5])
  equal(u.cutHi.value[0].toArray(), [4, 5, 6])
  cut(m, [])
  equal(u.cutLo.value[0].toArray(), [0, 0, 0, 0])
  equal(u.cutHi.value[0].toArray(), [-1, -1, -1])
  flash(m, 0.4, new THREE.Color(0xff0000))
  night(m, 0.8)
  equal(u.flashing.value, 0.4)
  equal(u.flash.value.getHex(), 0xff0000)
  equal(u.night.value, 0.8)
  m.dispose()
})
