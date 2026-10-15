// A rig's rest pose is restored each frame, its named roles move, and falling
// places its lowest point on the ground without changing the app's input.
import { equal, test } from '@yaks/testing'
import { puppet, type Rig } from './puppet.ts'

let rig: Rig = {
  height: 1,
  gait: 'walk',
  bite: 'lunge',
  fall: 'topple',
  parts: [{
    name: 'body',
    pivot: [0, 0, 0],
    cell: 1,
    boxes: [[[-0.5, 0, -0.5], [1, 1, 1], 0x806040]],
  }],
}
let p = puppet(rig)
let idle = {
  speed: 0,
  air: false,
  swing: -1,
  hurt: 0,
  roll: -1,
  down: false,
  t: 0,
}

test('puppet restores the rest pose after a strike and fall', () => {
  let body = p.root.children[0]
  p.animate({ ...idle, swing: 0.4 }, 0)
  equal(body.position.z > 0, true)
  p.animate({ ...idle, down: true }, 0)
  equal(body.rotation.z, Math.PI / 2)
  equal(Math.abs(body.position.y - 0.5) < 1e-9, true)
  p.animate(idle, 0)
  equal(body.rotation.z, 0)
  equal(body.position.z, 0)
  equal(body.position.y, 0)
})
