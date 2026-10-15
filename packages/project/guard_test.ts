// The board guard: a query that would quietly match nothing is refused at the
// door, and everything else lands.

import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert'
import { type Bundle, Refused } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { unroutable } from './guard.ts'
import { team, teamGraph } from './testing.ts'

let board = (query: string) => [{
  entity: { eid: 'b1' },
  doc: { title: 'A board' },
  board: { query },
}]

test('a query that routes is fine', () => {
  for (
    let q of [
      '.task.status=open',
      '.task.status=done,cancelled',
      '.task.status!=done',
      '.task',
      '.filed.project=p1',
      '.filed.priority<3',
      'widget', // a bare word is a text term, and a valid board query
      '', // the empty query selects nothing, on purpose
    ]
  ) assertEquals(unroutable(q, team), null, q)
})

test('a property the vocabulary does not know is refused', () => {
  // the typo that is otherwise invisible forever
  let why = unroutable('.task.staus=open', team)
  assertEquals(typeof why, 'string')
  // and a property named without its component names the form to write
  assertStringIncludes(unroutable('.status=open', team)!, '.task.status')
})

test('a status outside the closed set is refused, by name', () => {
  let why = unroutable('.task.status=complete', team)
  assertEquals(
    why,
    'no such status: complete — this board knows cancelled, done, open',
  )
  // and in a list, where one bad member is just as invisible
  assertEquals(typeof unroutable('.task.status=open,finished', team), 'string')
})

test("the statuses a board may name are the vocabulary's ladder's", () => {
  // a graph with no lease has no `wip`
  assertEquals(typeof unroutable('.task.status=wip', team), 'string')
  // and one whose vocabulary adds the rung routes it, without @yaks/project
  // being told about leases
  let leased = loadVocab([...team.docs, {
    $defs: {
      task: { component: true, extends: true, status: { claim: 'wip' } },
    },
  }], team.keywords)
  assertEquals(unroutable('.task.status=wip', leased), null)
})

// A team graph, installed, holding `bundles`.
let holding = (...bundles: Bundle[][]) => {
  let { g } = teamGraph()
  g.install()
  for (let b of bundles) g.apply(b)
  return g
}

let empty = holding()
test('the graph keeps a good board', () => {
  empty.apply(board('.task.status=open'))
  assertEquals((empty.read('.board&*') as unknown[]).length, 1)
})

let good = holding(board('.task.status=open'))
test('the graph refuses the bad board and keeps the good one', () => {
  assertThrows(() => good.apply(board('.task.status=complete')), Refused)
  // refused whole: the doc patch in the same batch did not land either
  let after = good.read('.board&*') as { board?: { query?: string } }[]
  assertEquals(after[0].board?.query, '.task.status=open')
})

let dropped = holding(board('.task.status=open'))
test('dropping a board states no query and is never refused', () => {
  dropped.apply([{ entity: { eid: 'b1' }, board: null }])
  assertEquals((dropped.read('.board&*') as unknown[]).length, 0)
})

test('qualified filing properties no longer belong to task', () => {
  for (let prop of ['project', 'priority', 'domain', 'assignee']) {
    assertEquals(typeof unroutable(`.task.${prop}=x`, team), 'string')
  }
})

let micro = holding([{
  entity: { eid: 'micro' },
  doc: { title: 'one step' },
  task: {},
}])
test('a bare microtask stores presence, never a supplied status', () => {
  micro.apply([{ entity: { eid: 'micro' }, task: { status: 'done' } }])
  let [b] = micro.read('.task&*') as Bundle[]
  assertEquals(b.task, { status: 'open' })
  assertEquals(b.filed, undefined)
})

let filing = holding()
test('filing stores separately and a bare priority query orders filed tasks', () => {
  filing.apply([
    {
      entity: { eid: 'later' },
      task: {},
      filed: { priority: 2, domain: 'Eng' },
    },
    { entity: { eid: 'first' }, task: {}, filed: { priority: 0 } },
    { entity: { eid: 'micro' }, task: {} },
  ])
  let rows = filing.read(
    '.filed.priority>=0 .order=filed.priority ?task',
  ) as Bundle[]
  assertEquals(rows.map((b) => b.entity.eid), ['first', 'later'])
  assertEquals(rows[1].task, { status: 'open' })
  assertEquals(rows[1].filed, { priority: 2, domain: 'Eng' })
})
