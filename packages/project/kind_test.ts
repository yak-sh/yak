// The letter an entity is shown by when it is both a project and the board of
// that project's tasks: the project it is, not the board it carries.

import { assertEquals } from '@std/assert'
import { human } from '@yaks/id'
import { team } from './harness.ts'

Deno.test('a project that carries a board is shown as the project', () => {
  let row = {
    entity: { eid: 'p1', num: 19 },
    project: {},
    board: { query: '.filed.project=P-19' },
  }
  assertEquals(team.kindOf(row), 'project')
  assertEquals(human(team)(row), 'P-19')
})
