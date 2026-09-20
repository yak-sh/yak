// A plan, checked and rendered: what a tree refuses, and what it prints.

import { assertEquals, assertThrows } from '@std/assert'
import type { Comp } from '@yaks/graph'
import { relations } from '@yaks/edge'
import { team } from './harness.ts'
import { type Node, planned } from './tree.ts'

let root = { eid: 'p19', name: 'P-19 Task Graph' }
let tags = relations(team)
let plan = (...nodes: Node[]) => planned(root, nodes, tags)
let refused = (nodes: Node[], said: string) =>
  assertThrows(() => planned(root, nodes, tags), Error, said)

let node = (key: string, over: Partial<Node> = {}): Node => ({
  key,
  title: key,
  relation: 'requires',
  ...over,
})

Deno.test('a node is a task, and its parent states the relation', () => {
  let { bundles } = plan(node('gate'), node('leaf', { parent: 'gate' }))
  assertEquals(bundles.map((b) => b.entity.eid), [
    '$gate',
    '$link~gate',
    '$leaf',
    '$link~leaf',
  ])
  let comp = (i: number, name: string) => bundles[i][name] as Comp
  assertEquals(comp(1, 'edge'), { from: 'p19', to: '$gate' })
  assertEquals(comp(1, 'requires'), {})
  assertEquals(comp(3, 'edge'), { from: '$gate', to: '$leaf' })
  assertEquals(comp(0, 'filed'), { project: 'p19' })
  assertEquals(comp(0, 'task'), {})
})

Deno.test('a node born done wears the mark that means it', () => {
  let [done] = plan(node('a', { status: 'done' })).bundles
  assertEquals(done.completed as Comp, {})
  assertEquals(plan(node('a')).bundles[0].completed, undefined)
})

Deno.test('the tree prints the sentence it states', () => {
  assertEquals(
    plan(
      node('goal', { relation: 'contains', title: 'The outcome' }),
      node('gate', { title: 'The prerequisite' }),
      node('leaf', { parent: 'goal', relation: 'contains', title: 'A piece' }),
    ).text,
    [
      'P-19 Task Graph',
      '├─ contains [goal] The outcome',
      '│  └─ contains [leaf] A piece',
      '└─ requires [gate] The prerequisite',
    ].join('\n'),
  )
})

Deno.test('a plan the graph could not hold is refused by name', () => {
  refused([], 'at least one node')
  refused([node('a'), node('a')], 'duplicate key: a')
  refused([node('a', { parent: 'nowhere' })], 'no node nowhere')
  refused([node('a', { relation: 'loves' })], 'not a relation here')
  refused([node('a', { parent: 'a' })], 'hangs from itself')
  refused([node('a', { title: ' ' })], 'needs a title')
})
