// The vocabulary: what it declares, and the two invariants that are decisions
// rather than details.

import { assert, assertEquals } from '@std/assert'
import { relations } from '@yaks/edge'
import { CONTAINS, REQUIRES } from './comp.ts'
import { team } from './harness.ts'

Deno.test('the components this package ships', () => {
  for (
    let c of [
      'task',
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

Deno.test('status is readable and routable, and nobody can write it', () => {
  let status = team.column('task', 'status')!
  assertEquals(status.persist, false)
  assertEquals(status.values, ['cancelled', 'done', 'open'])
  assert(!team.comp('task')!.writable.includes('status'))
  // still routable, so a board can filter on it
  assertEquals(team.route('status'), { comp: 'task', prop: 'status' })
})

Deno.test('a board is a query — there is no membership column anywhere', () => {
  assertEquals(team.comp('board')!.writable, ['query'])
  assertEquals(team.column('board', 'query')!.scalar, 'query')
  // nothing in the vocabulary points a task at a board, in either direction
  for (let [comp, prop] of team.refCols()) {
    assert(
      team.column(comp, prop)!.ref != 'board',
      `${comp}.${prop} references a board — membership must never be stored`,
    )
  }
})

Deno.test('the two relations are declared through @yaks/edge', () => {
  assertEquals(relations(team), {
    [REQUIRES]: REQUIRES,
    [CONTAINS]: CONTAINS,
  })
})

Deno.test('the marks keep their author as history; a project only detaches', () => {
  for (let comp of ['completed', 'cancelled']) {
    assertEquals(team.column(comp, 'by')!.death, 'keep')
  }
  assertEquals(team.column('task', 'project')!.death, 'detach')
  assertEquals(team.column('task', 'project')!.ref, 'project')
})

Deno.test('blocked carries a reason and is not a status', () => {
  assertEquals(team.comp('blocked')!.writable, ['on'])
  assert(!team.column('task', 'status')!.values!.includes('blocked'))
})
