import { assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { rootOf, sessionTree } from './tree.ts'
let row = (id: string, parent?: string, status = 'running'): Bundle => ({
  entity: { eid: id },
  session: { id, status },
  ...parent ? { spawned: { parent } } : {},
})
Deno.test('tree is always open, retains selected ancestry and hides archived subtrees', () => {
  let rows = [row('a'), row('b'), row('c', 'a'), row('d', 'c', 'settled')]
  let ids = (o = {}) =>
    sessionTree(rows, o).map((r) => [r.bundle.entity.eid, r.depth])
  assertEquals(ids(), [['a', 0], ['c', 1], ['b', 0]])
  assertEquals(ids(), [['a', 0], ['c', 1], ['b', 0]])
  assertEquals(ids({ selected: 'd' }), [['a', 0], ['c', 1], ['d', 2], ['b', 0]])
  assertEquals(rootOf(rows, 'd'), 'a')
  rows[0].archived = {}
  assertEquals(ids(), [['b', 0]])
  assertEquals(ids({ showArchived: true }), [['a', 0], ['c', 1], ['b', 0]])
})
Deno.test('orphan roots and corrupt cycles never loop', () => {
  assertEquals(sessionTree([row('orphan', 'missing')]).length, 1)
  let cycle = [row('x', 'y'), row('y', 'x')]
  assertEquals(sessionTree(cycle).length, 2)
})

Deno.test('connectors account for filtered siblings without expansion state', () => {
  let rows = [
    row('root'),
    row('a', 'root'),
    row('aa', 'a'),
    row('b', 'root'),
    row('hidden', 'root', 'settled'),
  ]
  assertEquals(sessionTree(rows).map((r) => [r.bundle.entity.eid, r.prefix]), [
    ['root', ''],
    ['a', '├─'],
    ['aa', '│ └─'],
    ['b', '└─'],
  ])
})
