// The board guard: a query that would quietly match nothing is refused at the
// door, and everything else lands.

import { assertEquals, assertThrows } from '@std/assert'
import { Refused } from '@yaks/graph'
import { unroutable } from './guard.ts'
import { team, teamGraph } from './harness.ts'

let board = (query: string) => [{
  entity: { eid: 'b1' },
  doc: { title: 'A board' },
  board: { query },
}]

Deno.test('a query that routes is fine', () => {
  for (
    let q of [
      '.status=open',
      '.status=done,cancelled',
      '.status!=done',
      '.priority<3',
      '.task!',
      '.task.project=p1',
      'widget', // a bare word is a text term, and a valid board query
      '', // the empty query selects nothing, on purpose
    ]
  ) assertEquals(unroutable(q, team), null, q)
})

Deno.test('a column the vocabulary does not know is refused', () => {
  // the typo that is otherwise invisible forever
  let why = unroutable('.staus=open', team)
  assertEquals(typeof why, 'string')
})

Deno.test('a status outside the closed set is refused, by name', () => {
  let why = unroutable('.status=complete', team)
  assertEquals(
    why,
    'no such status: complete — this board knows cancelled, done, open',
  )
  // and in a list, where one bad member is just as invisible
  assertEquals(typeof unroutable('.status=open,finished', team), 'string')
})

Deno.test('an added rung widens what a board may say', () => {
  let marks = [
    { status: 'cancelled', comp: 'cancelled' },
    { status: 'done', comp: 'completed' },
    { status: 'wip', comp: 'claim', settled: false },
  ]
  assertEquals(unroutable('.status=wip', team, marks), null)
  // and without it, the same query is refused
  assertEquals(typeof unroutable('.status=wip', team), 'string')
})

Deno.test('the graph refuses the bad board and keeps the good one', () => {
  let { g } = teamGraph()
  g.install()
  g.apply(board('.status=open'))
  assertEquals((g.read('.board!') as unknown[]).length, 1)

  assertThrows(() => g.apply(board('.status=complete')), Refused)
  // refused whole: the doc patch in the same batch did not land either
  let after = g.read('.board!') as { board?: { query?: string } }[]
  assertEquals(after[0].board?.query, '.status=open')
})

Deno.test('dropping a board states no query and is never refused', () => {
  let { g } = teamGraph()
  g.install()
  g.apply(board('.status=open'))
  g.apply([{ entity: { eid: 'b1' }, board: null }])
  assertEquals((g.read('.board!') as unknown[]).length, 0)
})
