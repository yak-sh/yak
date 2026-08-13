// The wake's timer, against an in-memory db: what is owed fires now and
// mints the knock, what isn't waits, a phrase written straight to the
// wire lands absolute at apply, and nothing fires twice. The boot reconcile is
// the same call (arm) the effects sweep makes, which is the whole point
// — a wake owed while the process was gone is just an overdue row.
import { type Change } from './types.ts'
Deno.env.set('DB_PATH', ':memory:')
let { apply, db, open } = await import('./db.ts')
let { arm } = await import('./wake.ts')
let { assertEquals, assertMatch, assertThrows } = await import('@std/assert')

open()
let uid = () => crypto.randomUUID()
let sent: Change[] = []
let landed: Change[] = []
let cast = (cs: Change[]) => sent.push(...cs)

let wrow = (eid: string) =>
  db.prepare('select * from wake where eid = ?').get(eid) as Record<
    string,
    string | null
  >
// The wake's outcome is the shared delivered facet now (D-14945): a fired
// wake wears `delivered`, a pending one wears neither.
let drow = (eid: string) =>
  db.prepare('select * from delivered where eid = ?').get(eid) as
    | Record<string, string | null>
    | undefined
let knocks = () =>
  db.prepare('select * from knock').all() as Record<string, string>[]
// WHO a knock is for rides the shared deliver.to now (D-14945).
let toOf = (eid: string) =>
  (db.prepare('select "to" from deliver where eid = ?').get(eid) as
    | { to: string }
    | undefined)?.to

let jeff = (() => {
  let eid = uid()
  apply(db, [{ eid, name: 'doc', comp: { title: 'Jeff' } }, {
    eid,
    name: 'person',
    comp: {},
  }])
  return eid
})()

// A fresh person to be woken. A targetless wake's knock points at whoever it
// wakes, so a unique recipient per test uniquely identifies that knock in the
// shared db.
let person = (name: string) => {
  let eid = uid()
  apply(db, [{ eid, name: 'doc', comp: { title: name } }, {
    eid,
    name: 'person',
    comp: {},
  }])
  return eid
}

let wake = (at: string, target?: string, to = jeff) => {
  let eid = uid()
  landed = apply(db, [
    {
      eid,
      name: 'wake',
      comp: { at, ...(target ? { target: target } : {}) },
    },
    { eid, name: 'deliver', comp: { to } },
  ])
  return eid
}

Deno.test('an hour already past fires, and mints the knock', () => {
  let bob = person('bob')
  let w = wake(new Date(Date.now() - 60_000).toISOString(), undefined, bob)
  arm(cast)
  let k = knocks().find((k) => k.target == bob)!
  assertEquals(toOf(k.eid), bob)
  assertMatch(String(drow(w)?.at), /^\d{4}-/)
})

Deno.test('a wake still owed waits, and fires once when it comes', () => {
  let carol = person('carol')
  let w = wake(new Date(Date.now() + 3_600_000).toISOString(), undefined, carol)
  arm(cast)
  assertEquals(drow(w), undefined)
  assertEquals(knocks().filter((k) => k.target == carol).length, 0)
  // the hour arrives (the row is the clock, so move the row)
  db.prepare('update wake set at = ? where eid = ?')
    .run(new Date(Date.now() - 1000).toISOString(), w)
  arm(cast)
  assertEquals(knocks().filter((k) => k.target == carol).length, 1)
  arm(cast) // a stamped wake is done — a second pass never re-knocks
  assertEquals(knocks().filter((k) => k.target == carol).length, 1)
})

Deno.test('no target: the woken actor is the subject', () => {
  let dave = person('dave')
  let w = wake(new Date(Date.now() - 1000).toISOString(), undefined, dave)
  arm(cast)
  // The cadence knock points at the actor ("look at your own board"), never
  // the wake row itself (unnumbered, and it says nothing).
  let k = knocks().find((k) => k.target == dave)!
  assertEquals(k.target, dave)
  assertEquals(k.target == w, false)
  assertEquals(toOf(k.eid), dave)
})

Deno.test('a new untargeted wake replaces only the pending untargeted one', () => {
  let at = new Date(Date.now() + 3_600_000).toISOString()
  let targeted = wake(at, jeff)
  let acted = wake(new Date(Date.now() - 1000).toISOString())
  arm(cast)
  let first = wake(at)
  let reminder = wake(at, jeff)
  let second = wake(at)
  assertEquals(wrow(targeted).target, jeff)
  assertEquals(wrow(reminder).target, jeff)
  assertMatch(String(drow(acted)?.at), /^\d{4}-/)
  assertEquals(wrow(first), undefined)
  assertEquals(drow(second), undefined)
  assertEquals(
    landed.some((c) => c.eid == first && c.name == 'entity' && !c.comp),
    true,
  )
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
  let at = String(wrow(w).at)
  assertEquals(Math.abs(Date.parse(at) - mint - 7_200_000) < 1000, true)
  assertEquals(drow(w), undefined) // two hours out, so it waits
  assertEquals(
    landed.some((c) => c.name == 'wake' && c.eid == w && c.comp?.at == at),
    true, // apply returns the canonical patch for the sender and peers
  )
})

Deno.test('an unreadable hour is refused before it can wait forever', () => {
  let before = db.prepare('select count(*) as n from wake').get() as {
    n: number
  }
  assertThrows(() => wake('whenever'), Error, 'wake.at is a time')
  let after = db.prepare('select count(*) as n from wake').get() as {
    n: number
  }
  assertEquals(after.n, before.n)
})
