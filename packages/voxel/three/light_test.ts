import { equal, test } from '@yaks/testing'
import { cuboids } from '../boxes.ts'
import { out } from '../mesh.ts'
import { light, warmth } from './light.ts'

test('lamp light keeps rim flags and brightens only faces toward its source', () => {
  let lamp = [{ at: [2, 0, 0] as [number, number, number], size: 2 }]
  equal(warmth([0, 0, 0], [-1, 0, 0], lamp), 0)
  equal(warmth([-20, 0, 0], [1, 0, 0], lamp), 0)
  let mesh = cuboids(out(), [[[0, 0, 0], [1, 1, 1], 0x807060]])
  let before = mesh.edge.map((n) => n & 15)
  light(mesh, lamp)
  equal(mesh.edge.map((n) => n & 15), before)
  equal(mesh.edge.some((n) => n > 15), true)
})
