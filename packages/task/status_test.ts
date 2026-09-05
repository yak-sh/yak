// The status rule, from all three doors — and the point of the exercise: the
// three agree, because they are built from one list.

import { assert, assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { compute, derived, statusOf } from './status.ts'
import { MARKS, OPEN, settled, statuses } from './words.ts'

let task = (extra: Record<string, unknown> = {}): Bundle => ({
  entity: { eid: 't1' },
  task: { priority: 1 },
  ...extra,
})

// Every case the ladder distinguishes, as (bundle, status) pairs.
let CASES: [Bundle, string | null][] = [
  [task(), OPEN],
  [task({ completed: { at: '2026-01-01T00:00:00.000Z' } }), 'done'],
  [task({ cancelled: { at: '2026-01-01T00:00:00.000Z' } }), 'cancelled'],
  // cancelled outranks done: calling work off is a later fact than finishing
  [task({ completed: {}, cancelled: {} }), 'cancelled'],
  // blocked is a facet, never a rung — a blocked task is still open
  [task({ blocked: { on: 'legal' } }), OPEN],
  // not a task at all: no status, the same nothing a database reads
  [{ entity: { eid: 'x' }, doc: { title: 'a note' } }, null],
]

Deno.test('statusOf reads the marks, in ladder order', () => {
  for (let [b, want] of CASES) assertEquals(statusOf(b), want, b.entity.eid)
})

Deno.test('compute answers exactly what statusOf answers', () => {
  let read = compute()['task.status']
  for (let [b, want] of CASES) assertEquals(read(b), want)
})

Deno.test('the closed set is the ladder plus open, and settled is the end', () => {
  assertEquals(statuses(), ['cancelled', 'done', OPEN])
  assert(settled('done'))
  assert(settled('cancelled'))
  assert(!settled(OPEN))
})

Deno.test('an added rung reaches every reader at once', () => {
  let marks = [...MARKS, { status: 'wip', comp: 'claim', settled: false }]
  assertEquals(statusOf(task({ claim: { person: 'p1' } }), marks), 'wip')
  assertEquals(statuses(marks), ['cancelled', 'done', 'wip', OPEN])
  // a lease means somebody is ON it, which is not the same as finished
  assert(!settled('wip', marks))
  // and the ladder still ranks: a completed task that is also claimed is done
  assertEquals(statusOf(task({ claim: {}, completed: {} }), marks), 'done')
})

Deno.test('derived spells the ladder as SQL, guarded by the owner null', () => {
  let col = derived()['task.status']
  assertEquals(col.tag, 'enum')
  assertEquals(col.values, ['cancelled', 'done', OPEN])
  let sql = col.expr('"task"."entity"')
  // the null guard leads, so a non-task reads NULL rather than 'open'
  assert(sql.startsWith('(case when "task"."entity" is null then null'))
  // one exists per mark, in ladder order, and open is the fallthrough
  assert(sql.indexOf('"cancelled"') < sql.indexOf('"completed"'))
  assert(sql.endsWith(`else '${OPEN}' end)`))
})

Deno.test('derived widens its members with the ladder', () => {
  let marks = [...MARKS, { status: 'wip', comp: 'claim', settled: false }]
  let col = derived(marks)['task.status']
  assertEquals(col.values, ['cancelled', 'done', 'wip', OPEN])
  assert(col.expr('o').includes(`from "claim"`))
})
