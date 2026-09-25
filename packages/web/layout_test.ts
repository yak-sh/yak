import { assertEquals } from '@std/assert'
import { type Change, type Pane } from './types.ts'
import {
  close,
  kids,
  mintLayout,
  resize,
  setContent,
  split,
  swap,
} from './layout.ts'

// A tree in shorthand: p('a', 'r', {order: 1}) is a pane row. Ops return
// batches; these tests read them as facts about shape, never about the
// minted uuids.
let p = (eid: string, parent?: string, more: Partial<Pane> = {}): Pane => ({
  eid,
  layout: 'L',
  parent: parent ?? null,
  ...more,
})

let comps = (batch: Change[], name = 'pane') =>
  batch.filter((c) => c.name == name && c.comp).map((c) => c.comp!)
let deads = (batch: Change[]) =>
  batch.filter((c) => c.name == 'entity' && !c.comp).map((c) => c.eid)

// r(h) ⊃ a b c — the three-pane row most cases start from.
let row = [
  p('r', undefined, { dir: 'h' }),
  p('a', 'r', { size: 1, order: 0, content: 'T1', view: 'Full' }),
  p('b', 'r', { size: 1, order: 1, content: 'T2' }),
  p('c', 'r', { size: 1, order: 2 }),
]

Deno.test('kids sorts by order, eid breaking ties', () => {
  let tied = [p('z', 'r', { order: 1 }), p('y', 'r', { order: 1 }), p('x', 'r')]
  assertEquals(kids(tied, 'r').map((k) => k.eid), ['x', 'y', 'z'])
})

Deno.test('split along the dir is one empty sibling, ordered between', () => {
  let batch = split(row, 'a', 'h')
  assertEquals(batch.length, 1)
  let born = comps(batch)[0]
  assertEquals(born.parent, 'r')
  assertEquals(born.size, 1)
  assertEquals(born.order, 0.5) // between a (0) and b (1) — nothing renumbers
  assertEquals(born.content, undefined) // empty: it renders the palette
})

Deno.test('split at the end orders past the last sibling', () => {
  assertEquals(comps(split(row, 'c', 'h'))[0].order, 3)
})

Deno.test('split across nests: the pane becomes the container', () => {
  let batch = split(row, 'a', 'v')
  assertEquals(batch.length, 3)
  let [turn, moved, empty] = batch.map((c) => c.comp!)
  assertEquals(turn, { dir: 'v', content: null, view: null })
  assertEquals(moved.parent, 'a')
  assertEquals(moved.content, 'T1') // the content moved down, view along
  assertEquals(moved.view, 'Full')
  assertEquals(empty.parent, 'a')
  assertEquals([moved.order, empty.order], [0, 1])
})

Deno.test('split a container across hoists its kids under an intermediate', () => {
  let batch = split(row, 'r', 'v')
  let reparented = batch.filter((c) =>
    ['a', 'b', 'c'].includes(c.eid) && c.comp?.parent
  )
  assertEquals(reparented.length, 3)
  let mid = batch.find((c) => c.comp?.dir == 'h')!
  assertEquals(mid.comp!.parent, 'r') // the old h-row, one level down
  assertEquals(reparented.every((c) => c.comp!.parent == mid.eid), true)
})

Deno.test('close is one delete when siblings remain — weights renormalize, no splice', () => {
  assertEquals(close(row, 'b'), [{ eid: 'b', name: 'entity', comp: null }])
})

Deno.test('close collapsing to a leaf survivor hoists content into the parent', () => {
  let pair = [
    p('r', undefined, { dir: 'h' }),
    p('a', 'r', { order: 0, content: 'T1', view: 'Full' }),
    p('b', 'r', { order: 1, content: 'T2', view: 'Board' }),
  ]
  let batch = close(pair, 'a')
  assertEquals(deads(batch), ['a', 'b']) // both children go
  assertEquals(comps(batch), [
    { dir: null, content: 'T2', view: 'Board' }, // r is the leaf now
  ])
  assertEquals(batch.at(1)!.eid, 'r')
})

Deno.test('close collapsing to a container survivor hoists dir and children', () => {
  let tree = [
    p('r', undefined, { dir: 'h' }),
    p('a', 'r', { order: 0 }),
    p('s', 'r', { order: 1, dir: 'v' }),
    p('x', 's', { order: 0 }),
    p('y', 's', { order: 1 }),
  ]
  let batch = close(tree, 'a')
  // reparents ride BEFORE the survivor's delete — the cascade must not
  // take the grandchildren down with the dissolved container.
  assertEquals(batch.map((c) => c.eid), ['a', 'x', 'y', 'r', 's'])
  assertEquals(comps(batch), [
    { parent: 'r' },
    { parent: 'r' },
    { dir: 'v' },
  ])
  assertEquals(deads(batch), ['a', 's'])
})

Deno.test('close on the root clears it — a layout always has a pane', () => {
  let batch = close(row, 'r')
  assertEquals(deads(batch), ['a', 'b', 'c'])
  assertEquals(comps(batch), [{ dir: null, content: null, view: null }])
})

Deno.test('resize transfers weight between siblings and clamps at the floor', () => {
  assertEquals(comps(resize(row, 'a', 'b', 0.5)), [{ size: 1.5 }, {
    size: 0.5,
  }])
  assertEquals(comps(resize(row, 'a', 'b', 5)), [{ size: 1.95 }, {
    size: 0.05,
  }])
  assertEquals(resize(row, 'a', 'x', 1), []) // strangers don't resize
})

Deno.test('setContent fills a leaf; swap exchanges two', () => {
  assertEquals(comps(setContent(row, 'c', 'T9', 'Board')), [
    { content: 'T9', view: 'Board' },
  ])
  assertEquals(comps(swap(row, 'a', 'b')), [
    { content: 'T2', view: null },
    { content: 'T1', view: 'Full' },
  ])
})

Deno.test('mintLayout: one leaf is the root; many make an h-row of equals', () => {
  let solo = mintLayout('desk')
  assertEquals(comps(solo.changes, 'doc'), [{ title: 'desk', body: '' }])
  assertEquals(comps(solo.changes).length, 1) // the root leaf, empty
  let three = mintLayout('desk', [{ content: 'T1' }, {}, {}])
  let panes = comps(three.changes)
  assertEquals(panes[0].dir, 'h')
  assertEquals(panes.slice(1).map((x) => x.size), [1, 1, 1])
  assertEquals(
    comps(three.changes, 'layout')[0].root,
    three.changes.find((c) => c.comp?.dir == 'h')!.eid,
  )
})
