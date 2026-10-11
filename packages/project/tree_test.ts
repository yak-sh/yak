// Sub-projects: everything under a project is one walk, the way up is its
// lineage, and a project is never filed under itself.

import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { type Bundle, Refused } from '@yaks/graph'
import { after } from '@yaks/fp'
import { store, teamGraph } from './testing.ts'
import { lineage, nesting } from './tree.ts'

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

let planted = tree()
test('what is under a project is one walk, at any depth', async () => {
  let g = planted
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
  let g = planted
  let up = async (eid: string) =>
    (await lineage(g, eid)).map((b) => b.entity.eid)
  assertEquals(await up('t-p3'), ['p3', 'p2', 'p1'])
  assertEquals(await up('p2'), ['p2', 'p1'])
  assertEquals(await up('x'), ['x'])
  assertEquals(await up('nothing'), [])
})

// The tree hook needs only the stored parents and the batch being filed.
let moving = store()
moving.tx((tx) =>
  tx.patch([
    { entity: { eid: 'p1' }, project: {} },
    { entity: { eid: 'p2' }, project: {}, filed: { project: 'p1' } },
    { entity: { eid: 'p3' }, project: {}, filed: { project: 'p2' } },
    { entity: { eid: 'x' }, project: {} },
  ])
)
let filing = (bundles: Bundle[]) =>
  moving.tx((tx) => after(nesting(bundles, tx), (bs) => tx.patch(bs)))
test('a project is never filed under itself or anything under it', () => {
  let file = (eid: string, project: string) => () =>
    filing([{ entity: { eid }, filed: { project } }])
  assertThrows(file('p1', 'p1'), Refused, 'form a tree')
  assertThrows(file('p1', 'p3'), Refused, 'form a tree')
  assertThrows(
    () =>
      filing([
        { entity: { eid: 'x' }, filed: { project: 'p3' } },
        { entity: { eid: 'p1' }, filed: { project: 'x' } },
      ]),
    Refused,
    'form a tree',
  )
  // Moving a branch elsewhere, or out from under anything, is fine.
  file('p3', 'x')()
  file('p2', 'p3')()
  filing([{ entity: { eid: 'p2' }, filed: null }])
  file('p1', 'p2')()
})
