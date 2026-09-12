import { assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { rootOf, sessionTree } from './tree.ts'
let row = (id: string, parent?: string, status = 'running'): Bundle => ({
  entity: { eid: id },
  session: { id, status, tasksCompleted: status == 'settled' },
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

Deno.test('unnumbered task children without a call are visible and child archive is local', () => {
  let parent = row('parent')
  let child = row('child', 'parent')
  child.spawned = { parent: 'parent', call: null }
  let sibling = row('sibling', 'parent')
  assertEquals(
    sessionTree([parent, child, sibling]).map((r) => r.bundle.entity.eid),
    ['parent', 'child', 'sibling'],
  )
  child.archived = {}
  assertEquals(
    sessionTree([parent, child, sibling]).map((r) => r.bundle.entity.eid),
    ['parent', 'sibling'],
  )
  assertEquals(parent.archived, undefined)
})

Deno.test('quiet children remain unless all assigned tasks are complete', () => {
  const root = row('root')
  const child = row('child', 'root', 'settled')
  for (const tasksCompleted of [undefined, false]) {
    child.session = { status: 'settled', tasksCompleted }
    assertEquals(sessionTree([root, child]).map((r) => r.bundle.entity.eid), [
      'root',
      'child',
    ])
  }
  child.session = { status: 'settled', tasksCompleted: true }
  assertEquals(sessionTree([root, child]).length, 1)
  assertEquals(sessionTree([root, child], { showSettled: true }).length, 2)
  assertEquals(sessionTree([root, child], { selected: 'child' }).length, 2)
  child.session = { status: 'running', tasksCompleted: true }
  assertEquals(sessionTree([root, child]).length, 2)
})

Deno.test('completed parent stays visible for unfinished descendants, not archived trees', () => {
  const root = row('root')
  const parent = row('parent', 'root', 'settled')
  const child = row('child', 'parent', 'settled')
  child.session = { status: 'settled', tasksCompleted: false }
  assertEquals(sessionTree([root, parent, child]).length, 3)
  root.archived = {}
  assertEquals(sessionTree([root, parent, child]).length, 0)
})
