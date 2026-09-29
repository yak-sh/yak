// Sub-projects: everything under a project is one walk, the way up is its
// lineage, and a project is never filed under itself.

import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { Refused } from '@yaks/graph'
import { teamGraph } from './testing.ts'
import { lineage } from './tree.ts'

// p1 ⊃ p2 ⊃ p3, and x beside them; a task in each.
let tree = () => {
  let { g } = teamGraph()
  g.apply([
    { entity: { eid: 'p1' }, project: {} },
    { entity: { eid: 'p2' }, project: {}, filed: { project: 'p1' } },
    { entity: { eid: 'p3' }, project: {}, filed: { project: 'p2' } },
    { entity: { eid: 'x' }, project: {} },
    ...['p1', 'p2', 'p3', 'x'].map((p) => ({
      entity: { eid: `t-${p}` },
      task: {},
      filed: { project: p },
    })),
  ])
  return g
}

let eids = (bs: { entity: { eid: string } }[]) =>
  bs.map((b) => b.entity.eid).sort()

test('what is under a project is one walk, at any depth', async () => {
  let g = tree()
  let under = async (q: string) => eids(await g.read(q))
  assertEquals(await under('.task .filed.project->p1'), [
    't-p1',
    't-p2',
    't-p3',
  ])
  assertEquals(await under('.project .filed.project->p1'), ['p2', 'p3'])
  assertEquals(await under('.task .filed.project->p2'), ['t-p2', 't-p3'])
  assertEquals(await under('.task .filed.project=p1'), ['t-p1'])
})

test('a lineage runs from the nearest project up', async () => {
  let g = tree()
  let up = async (eid: string) =>
    (await lineage(g, eid)).map((b) => b.entity.eid)
  assertEquals(await up('t-p3'), ['p3', 'p2', 'p1'])
  assertEquals(await up('p2'), ['p2', 'p1'])
  assertEquals(await up('x'), ['x'])
  assertEquals(await up('nothing'), [])
})

test('a project is never filed under itself or anything under it', () => {
  let g = tree()
  let file = (eid: string, project: string) => () =>
    g.apply([{ entity: { eid }, filed: { project } }])
  assertThrows(file('p1', 'p1'), Refused, 'form a tree')
  assertThrows(file('p1', 'p3'), Refused, 'form a tree')
  assertThrows(
    () =>
      g.apply([
        { entity: { eid: 'x' }, filed: { project: 'p3' } },
        { entity: { eid: 'p1' }, filed: { project: 'x' } },
      ]),
    Refused,
    'form a tree',
  )
  // Moving a branch elsewhere, or out from under anything, is fine.
  file('p3', 'x')()
  file('p2', 'p3')()
  g.apply([{ entity: { eid: 'p2' }, filed: null }])
  file('p1', 'p2')()
})
