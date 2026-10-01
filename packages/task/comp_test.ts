// The vocabulary: what it declares, and the two invariants that are decisions
// rather than details.

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { relations } from '@yaks/edge'
import { CONTAINS, REQUIRES } from './comp.ts'
import { team } from './testing.ts'

test('the components this package ships', () => {
  for (
    let c of [
      'task',
      'filed',
      'project',
      'board',
      'completed',
      'cancelled',
      'blocked',
      'requires',
      'contains',
    ]
  ) assert(team.comp(c), `declares ${c}`)
})

test('status is readable and routable, and nobody can write it', () => {
  let status = team.prop('task', 'status')!
  assertEquals(status.computed, true)
  assertEquals(status.values, ['cancelled', 'done', 'open'])
  assert(!team.comp('task')!.writable.includes('status'))
  // still routable, so a board can filter on it
  assertEquals(team.aim('task.status'), [{ comp: 'task', prop: 'status' }])
})

test('a board is a query — there is no membership property anywhere', () => {
  assertEquals(team.comp('board')!.writable, ['query'])
  assertEquals(team.prop('board', 'query')!.scalar, 'query')
  // nothing in the vocabulary points a task at a board, in either direction
  for (let [comp, prop] of team.refProps()) {
    assert(
      team.prop(comp, prop)!.ref != 'board',
      `${comp}.${prop} references a board — membership must never be stored`,
    )
  }
})

test('the two relations are declared through @yaks/edge', () => {
  assertEquals(relations(team), {
    [REQUIRES]: REQUIRES,
    [CONTAINS]: CONTAINS,
  })
})

test('the marks keep their author as history; a project only detaches', () => {
  for (let comp of ['completed', 'cancelled']) {
    assertEquals(team.prop(comp, 'by')!.death, 'keep')
  }
  assertEquals(team.prop('filed', 'project')!.death, 'detach')
  assertEquals(team.prop('filed', 'project')!.ref, 'project')
})

test('blocked carries a reason and is not a status', () => {
  assertEquals(team.comp('blocked')!.writable, ['on'])
  assert(!team.prop('task', 'status')!.values!.includes('blocked'))
})

test('a bare task has no writable properties; filing is optional and routes alone', () => {
  assertEquals(team.comp('task')!.writable, [])
  assertEquals(team.comp('filed')!.writable.sort(), [
    'assignee',
    'domain',
    'priority',
    'project',
  ])
  for (let prop of ['project', 'priority', 'domain', 'assignee']) {
    assertEquals(team.aim(`filed.${prop}`), [{ comp: 'filed', prop }])
    assertEquals(team.prop('task', prop), undefined)
  }
  assertEquals(team.prop('filed', 'assignee')!.death, 'detach')
})
