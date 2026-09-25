// The near match: what a failed handle lookup may name. Scoring only —
// the check that a suggestion RESOLVES belongs to the door that offers it
// (client.ts nearby), and client_test drives that half.
import { assertEquals } from '@std/assert'
import { nearest, offer } from './near.ts'

// A project's title is its NAME; a task's is a sentence about work.
let P = (id: string, alias: string, title: string) => ({
  id,
  alias,
  title,
  named: true,
})
let T = (id: string, alias: string, title: string) => ({ id, alias, title })
let fleet = [
  P('P-19', 'home', 'Task Graph'),
  P('P-20', 'holdco', 'holdco'),
  P('P-22', 'crayonbloom', 'crayonbloom'),
  P('P-26', 'harness', 'harness'),
  P('P-30', 'bindery', 'bindery'),
]

// The untargeted pool is the whole graph, so a common word opens somebody's
// ticket every time. A name outranks a sentence that merely starts with it.
Deno.test('nearest: a ticket opening with the word loses to the thing named by it', () => {
  let graph = [
    ...fleet,
    T(
      'T-801',
      'holdco-tasks-cancelled-state-per-task-timeline-history',
      'Tasks: add cancelled state + per-task timeline history',
    ),
    T(
      'T-1102',
      'board-notifications-phase-1-read-tracking-notification-cente',
      'Board notifications Phase 1: read-tracking + notification center',
    ),
    // same name, no handle: the aliased one is the one somebody decided
    // should be addressable by name
    { id: 'B-5', title: 'Task Graph', named: true },
  ]
  assertEquals(nearest('tasks', graph)?.id, 'P-19')
  assertEquals(nearest('task', graph)?.id, 'P-19')
  // nothing in this graph is NAMED `board` — silence beats the ticket
  assertEquals(nearest('board', graph), undefined)
  // `asks` is only letters found inside `tasks`; `task` opens `Task Graph`
  assertEquals(
    nearest('tasks', [...fleet, P('B-3710', '', 'Asks')])?.id,
    'P-19',
  )
})

Deno.test('nearest: a title word answers the alias nobody could guess', () => {
  // the reported shape: `tasks` IS the venture, `home` is its handle
  assertEquals(nearest('tasks', fleet)?.id, 'P-19')
  assertEquals(nearest('task graph', fleet)?.id, 'P-19')
  // a typo in the alias itself
  assertEquals(nearest('holdc', fleet)?.id, 'P-20')
  assertEquals(nearest('harnes', fleet)?.id, 'P-26')
  // a prefix of a long alias
  assertEquals(nearest('crayon', fleet)?.id, 'P-22')
})

Deno.test('nearest: nothing close is nothing offered', () => {
  assertEquals(nearest('flux', fleet), undefined)
  assertEquals(nearest('', fleet), undefined)
  assertEquals(nearest('tasks', []), undefined)
  // one letter is not evidence of anything
  assertEquals(nearest('h', fleet), undefined)
  // a stub inside a long title is coincidence, not a match: `jef` sits in
  // every task titled after jeff@yak.sh, and named one of them. Both gates
  // hold it — a task's title is not a name, and the stub covers none of it.
  let jeffish = 'Two-way email between holdco and the owner (jeff@yak.sh)'
  assertEquals(
    nearest('jef', [T('T-47', 'email-to-owner', jeffish)]),
    undefined,
  )
  assertEquals(nearest('jef', [P('P-9', '', jeffish)]), undefined)
  assertEquals(nearest('jef', [{ id: 'U-3709', alias: 'jeff' }])?.id, 'U-3709')
})

Deno.test('nearest: duplicate names are told apart by the handle', () => {
  // Ids alone do not disambiguate — both boards are titled `holdco`, so
  // the winner is whichever the caller's word matches, and offer() prints
  // the alias that tells them apart.
  let boards = [
    P('B-21', 'holdco-board', 'holdco'),
    P('B-27', 'harness-board', 'harness (dead)'),
  ]
  assertEquals(nearest('holdco', boards)?.id, 'B-21')
  assertEquals(nearest('harness', boards)?.id, 'B-27')
  assertEquals(
    offer(nearest('holdco', boards)!),
    "'holdco-board' (B-21, holdco)",
  )
})

Deno.test('offer: the handle leads, because it is what they got wrong', () => {
  assertEquals(
    offer(P('P-19', 'home', 'Task Graph')),
    "'home' (P-19, Task Graph)",
  )
  assertEquals(offer({ id: 'P-19', title: 'Task Graph' }), 'P-19 (Task Graph)')
  assertEquals(offer({ id: 'P-19', alias: 'home' }), "'home' (P-19)")
  assertEquals(offer({ id: 'P-19' }), 'P-19')
})
