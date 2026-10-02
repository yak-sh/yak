// A hero looks at the selected creature before the mouse, without body turns.
import { test, equal } from '@yaks/testing'
import { focus, neck } from './gaze.ts'

test('mouse gaze eases within the neck limits without turning the body', () => {
  let body = { x: 0, z: 0, yaw: 0 }
  let eye = 0
  for (let n = 0; n < 30; n++) eye = focus(eye, body, { x: 4, z: 0 }, 0.05)
  equal(eye > 1.19 && eye <= 1.2, true)
  equal(body.yaw, 0)
  eye = focus(eye, body, { x: -4, z: 0 }, 0.1)
  equal(eye < 1.19 && eye >= -1.2, true)
  equal(Math.abs(neck(eye, Math.PI)), 1.2)
  for (let n = 0; n < 30; n++) eye = focus(eye, body, null, 0.05)
  equal(Math.abs(eye) < 0.001, true)
})
