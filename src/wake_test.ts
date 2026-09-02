// The wake's timer, against an in-memory db: what is owed fires now and
// mints the knock, what isn't waits, a phrase written straight to the
// wire lands absolute at apply, and nothing fires twice. The boot reconcile is
// the same call (arm) the effects sweep makes, which is the whole point
// — a wake owed while the process was gone is just an overdue row.
import { type Change } from './types.ts'
Deno.env.set('DB_PATH', ':memory:')
let { apply } = await import('./db.ts')
let { open } = await import('./store/sqlite.ts')
let { db } = await import('./live_db.ts')
let { arm } = await import('./wake.ts')
let { assertEquals, assertMatch, assertThrows } = await import('@std/assert')

open()
let uid = () => crypto.randomUUID()
let sent: Change[] = []
let landed: Change[] = []
let cast = (cs: Change[]) => sent.push(...cs)

// Component/edge tables are keyed by the integer `entity` spine id now, so
// a raw statement translates at the eid boundary: OWNED matches a component
// row by its owner eid, idOf resolves an eid VALUE to the id a ref column
// stores, and refEid projects a ref column back to its eid for a JS
// assertion. The `entity` spine keeps text `eid` and is never rewritten.
let OWNED = `entity = (select id from entity where eid = ?)`
let idOf = `(select id from entity where eid = ?)`
let refEid = (col: string) => `(select eid from entity where id = ${col})`

let wrow = (eid: string) =>
  db.prepare(
    `select at, ${refEid('target')} as target from wake where ${OWNED}`,
  ).get(eid) as Record<
    string,
    string | null
  >
// The wake's outcome is the shared delivered facet now (D-14945): a fired
// wake wears `delivered`, a pending one wears neither.
let drow = (eid: string) =>
  db.prepare(`select * from delivered where ${OWNED}`).get(eid) as
    | Record<string, string | null>
    | undefined
let knocks = () =>
  db.prepare(
    `select o.eid as eid, ${
      refEid('c.target')
    } as target from knock c join entity o on o.id = c.entity`,
  ).all() as Record<string, string>[]
// WHO a knock is for rides the shared deliver.to now (D-14945).
let toOf = (eid: string) =>
  (db.prepare(
    `select ${refEid('"to"')} as "to" from deliver where ${OWNED}`,
  ).get(eid) as
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

let wake = (
  at: string,
  target?: string,
  to = jeff,
  note?: string,
  by?: string,
) => {
  let eid = uid()
  landed = apply(
    db,
    [
      {
        eid,
        name: 'wake',
        comp: {
          at,
          ...(target ? { target: target } : {}),
          ...(note ? { note } : {}),
        },
      },
      { eid, name: 'deliver', comp: { to } },
    ],
    undefined,
    by,
  )
  return eid
}

// The archived facet on a knock — the mark that keeps a self-cadence alarm
// out of the inbox (T-12480).
let knockArchived = (eid: string) =>
  !!db.prepare(`select 1 from archived where ${OWNED}`).get(eid)

// The words on the target — the comment a note relays into, the same seam a
// :knock's words use (knock.ts wordsFor, channel.ts commentOn).
let saidOn = (target: string) =>
  db.prepare(
    `select d.body from comment c join doc_value d on d.entity = c.entity
     where c.target = ${idOf} order by d.body`,
  ).all(target) as { body: string }[]

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
  db.prepare(`update wake set at = ? where ${OWNED}`)
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

Deno.test('a note rides through to a comment on the woken subject', () => {
  let erin = person('erin')
  let w = wake(
    new Date(Date.now() - 1000).toISOString(),
    undefined,
    erin,
    'mid mail-loop port, T-7018 next',
  )
  arm(cast)
  // The cadence knock points at the woken actor, and the note lands as a
  // comment on that same target — where channel.ts commentOn picks it up.
  let k = knocks().find((k) => k.target == erin)!
  assertEquals(k.target, erin)
  assertMatch(String(drow(w)?.at), /^\d{4}-/)
  assertEquals(
    saidOn(erin).some((r) => r.body == 'mid mail-loop port, T-7018 next'),
    true,
  )
})

Deno.test('no note means no comment rides the knock', () => {
  let finn = person('finn')
  wake(new Date(Date.now() - 1000).toISOString(), undefined, finn)
  arm(cast)
  assertEquals(saidOn(finn).length, 0)
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

Deno.test('a self-cadence wake is born archived; every other wake is kept', () => {
  let past = () => new Date(Date.now() - 1000).toISOString()
  // A unique recipient per wake, so each knock is found by whom it woke.
  let hank = person('hank') // set it for yourself, no target: your alarm clock
  let iris = person('iris') // someone ELSE woke you (by != to): a nudge
  let jane = person('jane') // a reminder ABOUT jeff: correspondence
  let mine = wake(past(), undefined, hank, undefined, hank)
  let nudge = wake(past(), undefined, iris, undefined, jeff)
  let reminder = wake(past(), jeff, jane, undefined, jane)
  arm(cast)
  let kOf = (to: string) => knocks().find((k) => toOf(k.eid) == to)!
  assertMatch(String(drow(mine)?.at), /^\d{4}-/)
  assertMatch(String(drow(nudge)?.at), /^\d{4}-/)
  assertMatch(String(drow(reminder)?.at), /^\d{4}-/)
  // Only the alarm you set for yourself is archived out of the inbox.
  assertEquals(knockArchived(kOf(hank).eid), true)
  assertEquals(knockArchived(kOf(iris).eid), false)
  assertEquals(knockArchived(kOf(jane).eid), false)
})

Deno.test('a phrase off the raw wire lands absolute, at MINT', () => {
  let w = wake('in 2 hours')
  arm(cast)
  let mint = Date.parse(
    String(
      (db.prepare(`select at from created where ${OWNED}`).get(w) as {
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
