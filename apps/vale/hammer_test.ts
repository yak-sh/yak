// A hammer's head comes down and forward through the moment its blow lands.
import { assert } from '@std/assert'
import * as THREE from 'three'
import { BUILD, hero } from './figures.ts'
import { LAND } from './strike.ts'

Deno.test('hammer head descends through the hit', () => {
  let f = hero(
    BUILD,
    { tint: '#4a7ab8', hair: '#6a4a30', skin: '#e8c0a0' },
    { main: 'hammer1' },
  )
  let hammer: THREE.Bone | undefined
  f.root.traverse((o) => {
    if (
      o instanceof THREE.Bone &&
      o.userData.boxes?.some((b: [number[], number[]]) => b[1][1] > 0.8)
    ) hammer = o
  })
  assert(hammer)
  let held = hammer
  let head: [number[], number[]] = held.userData.boxes.reduce(
    (a: [number[], number[]], b: [number[], number[]]) =>
      b[1][0] > a[1][0] ? b : a,
  )
  let at = (swing: number) => {
    f.animate({
      speed: 0,
      air: false,
      swing,
      hurt: 0,
      roll: -1,
      down: false,
      t: 0,
    }, 0)
    f.root.updateMatrixWorld(true)
    return new THREE.Vector3(
      head[0][0] + head[1][0] / 2,
      head[0][1] + head[1][1] / 2,
      head[0][2] + head[1][2] / 2,
    ).applyMatrix4(held.matrixWorld)
  }
  let raised = at(0.12), struck = at(LAND)
  assert(raised.y > struck.y)
  assert(raised.z < struck.z)
})
