// The wake's timer, against an in-memory db: what is owed fires now and
// mints the knock, what isn't waits, a phrase written straight to the
// wire lands absolute, and nothing fires twice. The boot reconcile is
// the same call (arm) the effects sweep makes, which is the whole point
// — a wake owed while the process was gone is just an overdue row.
import { type Change } from './types.ts'
Deno.env.set('DB_PATH', ':memory:')
let { apply, db, open } = await import('./db.ts')
let { arm } = await import('./wake.ts')
let { assertEquals, assertMatch } = await import('@std/assert')

open()
let uid = () => crypto.randomUUID()
let sent: Change[] = []
let cast = (cs: Change[]) => sent.push(...cs)

let wrow = (eid: string) =>
  db.prepare('select * from wake where eid = ?').get(eid) as Record<
    string,
    string | null
  >
let knocks = () =>
  db.prepare('select * from knock').all() as Record<string, string>[]

let jeff = (() => {
  let eid = uid()
  apply(db, [{ eid, name: 'doc', comp: { title: 'Jeff' } }, {
    eid,
    name: 'person',
    comp: {},
  }])
  return eid
})()

let wake = (at: string, target?: string) => {
  let eid = uid()
  apply(db, [{
    eid,
    name: 'wake',
    comp: { at, to_eid: jeff, ...(target ? { target_eid: target } : {}) },
  }])
  return eid
}

Deno.test('an hour already past fires, and mints the knock', () => {
  let w = wake(new Date(Date.now() - 60_000).toISOString())
  arm(cast)
  let k = knocks().find((k) => k.target_eid == w)!
  assertEquals(k.to_eid, jeff)
  assertMatch(String(wrow(w).acted_at), /^\d{4}-/)
})

Deno.test('a wake still owed waits, and fires once when it comes', () => {
  let w = wake(new Date(Date.now() + 3_600_000).toISOString())
  arm(cast)
  assertEquals(wrow(w).acted_at, null)
  assertEquals(knocks().filter((k) => k.target_eid == w).length, 0)
  // the hour arrives (the row is the clock, so move the row)
  db.prepare('update wake set at = ? where eid = ?')
    .run(new Date(Date.now() - 1000).toISOString(), w)
  arm(cast)
  assertEquals(knocks().filter((k) => k.target_eid == w).length, 1)
  arm(cast) // a stamped wake is done — a second pass never re-knocks
  assertEquals(knocks().filter((k) => k.target_eid == w).length, 1)
})

Deno.test('no target: the wake is its own subject', () => {
  let w = wake(new Date(Date.now() - 1000).toISOString())
  arm(cast)
  assertEquals(knocks().find((k) => k.target_eid == w)?.to_eid, jeff)
})

Deno.test('a phrase off the raw wire lands absolute, at MINT', () => {
  let w = wake('in 2 hours')
  arm(cast)
  let mint = Date.parse(
    String(
      (db.prepare('select at from created where eid = ?').get(w) as {
        at: string
      }).at,
    ),
  )
  assertEquals(wrow(w).at, new Date(mint + 7_200_000).toISOString())
  assertEquals(wrow(w).acted_at, null) // two hours out, so it waits
  assertEquals(
    sent.some((c) => c.name == 'wake' && c.eid == w && c.comp?.at),
    true, // the resolution is broadcast, not just written
  )
})

Deno.test('an unreadable hour says so instead of waiting forever', () => {
  let w = wake('whenever')
  arm(cast)
  assertMatch(String(wrow(w).error), /unreadable at: whenever/)
  assertMatch(String(wrow(w).acted_at), /^\d{4}-/)
})
