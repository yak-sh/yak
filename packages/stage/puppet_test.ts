// A rig's rest pose is restored each frame, its named roles move, and falling
// places its lowest point on the ground without changing the app's input.
import { equal, test } from '@yaks/testing'
import type { Box } from '@yaks/voxel/boxes'
import { puppet, type Rig } from './puppet.ts'

let leg = (name: string, x: number, phase: number) => ({
  name,
  pivot: [x, 0.4, 0] as [number, number, number],
  cell: 1,
  boxes: [[[-0.05, -0.4, -0.05], [0.1, 0.42, 0.1], 0x604830]] as Box[],
  move: { leg: { phase } },
})

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

let walker = puppet({
  ...rig,
  parts: [
    {
      ...rig.parts[0],
      pivot: [0, 0.4, 0],
      boxes: [[[-0.2, 0, -0.4], [0.4, 0.3, 0.8], 0x806040]],
    },
    leg('left', -0.12, 0),
    leg('right', 0.12, 0.5),
  ],
})
let walk = { ...idle, speed: 3, t: 1 }

test('legs stride half a step apart', () => {
  walker.animate(walk, 0.1)
  let [l, r] = ['left', 'right'].map((n) => walker.root.getObjectByName(n)!)
  equal(Math.abs(l.rotation.x + r.rotation.x) < 1e-9, true)
  equal(l.rotation.x != 0, true)
})

test('fallen, it lies on its side with its flank on the ground', () => {
  walker.animate({ ...walk, down: true }, 0.1)
  let trunk = walker.root.children[0]
  equal(trunk.rotation.z, Math.PI / 2)
  equal(Math.abs(trunk.position.y - 0.2) < 1e-9, true)
})
