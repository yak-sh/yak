// Server stamps share a transaction with their replay journal, including when
// nested inside another writer. Failures leave neither graph nor journal residue.
import { assertEquals, assertThrows } from '@std/assert'
import { apply, cursorOf, journalSince, readComp, record, stamp } from './db.ts'
import { fed } from './effects.ts'
import { bareDb, rejectJournal } from './testdb.ts'
import type { Change } from './types.ts'

let fixture = () => {
  let db = bareDb()
  let eid = crypto.randomUUID()
  apply(db, [{ eid, name: 'web', comp: { url: 'https://example.test/' } }])
  let change: Change = { eid, name: 'web', comp: { frozen_at: '2026-09-09' } }
  let write = () => {
    db.prepare(
      'update web set frozen_at = ? where entity = (select id from entity where eid = ?)',
    )
      .run(change.comp!.frozen_at as string, eid)
    return [change]
  }
  return { db, eid, write, change, cursor: cursorOf(db) }
}

Deno.test('stamp commits its SQL and effect trace in one journal batch', () => {
  let { db, eid, write, change, cursor } = fixture()
  let effects = fed()
  effects.created.add(`web ${eid}`)
  assertEquals(stamp(db, write, undefined, effects), [change])
  assertEquals(readComp(db, eid, 'web')?.frozen_at, change.comp!.frozen_at)
  let rows = journalSince(db, cursor)
  assertEquals(rows.length, 1)
  assertEquals(rows[0].batch, [change])
  assertEquals(rows[0].trace?.created, effects.created)
  assertEquals(db.inTransaction, false)
})

Deno.test('record refuses to journal outside the graph writer transaction', () => {
  let { db, change, cursor } = fixture()
  assertThrows(
    () => record(db, [change]),
    Error,
    'requires a write transaction',
  )
  assertEquals(cursorOf(db), cursor)
})

for (let nested of [false, true]) {
  Deno.test(`stamp journal failure rolls back SQL and journal (nested=${nested})`, () => {
    let { db, eid, write, cursor } = fixture()
    let before = readComp(db, eid, 'web')
    db.exec('create temp table outer_write (value text)')
    let restore = rejectJournal(db)
    try {
      let fail = () =>
        assertThrows(() => stamp(db, write), Error, 'journal unavailable')
      if (nested) {
        db.transaction(() => {
          db.exec("insert into outer_write values ('kept')")
          fail()
          assertEquals(readComp(db, eid, 'web')?.frozen_at, before?.frozen_at)
        }, true)
        assertEquals(db.prepare('select value from outer_write').get(), {
          value: 'kept',
        })
      } else fail()
      assertEquals(readComp(db, eid, 'web'), before)
      assertEquals(cursorOf(db), cursor)
      assertEquals(journalSince(db, cursor), [])
      assertEquals(db.inTransaction, false)
    } finally {
      restore()
    }
  })
}
