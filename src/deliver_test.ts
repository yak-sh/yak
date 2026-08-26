// The delivery lifecycle (deliver.ts) against the singleton in-memory db: an
// outcome must be JOURNALED (so a catch-up client replays it, not just the live
// ones the cast reached) and MUTUALLY EXCLUSIVE (delivered XOR error — the
// D-14945 tri-state, so a pending query and the .error health query can never
// disagree about one deliverable). T-15458.
Deno.env.set('DB_PATH', ':memory:')
import { assertEquals } from '@std/assert'
import { apply, journalOf } from './db.ts'
import { db } from './live_db.ts'
import { delivered, errored } from './deliver.ts'
import { type Change, uuid } from './types.ts'

// A deliverable spine to hang outcomes on — a knock will do.
let mint = () => {
  let eid = uuid()
  apply(db, [{ eid, name: 'knock', comp: { target: eid } }])
  return eid
}
let has = (eid: string, table: string) =>
  !!db.prepare(
    `select 1 from ${table} where entity = (select id from entity where eid = ?)`,
  ).get(eid)

Deno.test('delivered is journaled, so a catch-up client can replay it', () => {
  let eid = mint()
  let casts: Change[] = []
  delivered(eid, 'cast S-1', (cs) => casts.push(...cs))
  // Live clients heard it on the cast, AND it is in the journal for replay.
  assertEquals(casts.some((c) => c.name == 'delivered'), true)
  assertEquals(
    journalOf(db, eid).some((e) =>
      e.changes.some((c) => c.name == 'delivered')
    ),
    true,
  )
})

Deno.test('delivered clears a prior error (one outcome)', () => {
  let eid = mint()
  errored(eid, 'boom', () => {})
  assertEquals(has(eid, 'error'), true)
  let casts: Change[] = []
  delivered(eid, 'local', (cs) => casts.push(...cs))
  assertEquals(has(eid, 'delivered'), true)
  assertEquals(has(eid, 'error'), false) // the opposite facet is gone
  // and the clearing rides the batch, so caches shed the stale error too
  assertEquals(
    casts.some((c) => c.name == 'error' && c.comp == null),
    true,
  )
})

Deno.test('errored clears a prior delivered (the other edge)', () => {
  let eid = mint()
  delivered(eid, 'local', () => {})
  assertEquals(has(eid, 'delivered'), true)
  let casts: Change[] = []
  errored(eid, 'went wrong', (cs) => casts.push(...cs))
  assertEquals(has(eid, 'error'), true)
  assertEquals(has(eid, 'delivered'), false)
  assertEquals(
    casts.some((c) => c.name == 'delivered' && c.comp == null),
    true,
  )
})
