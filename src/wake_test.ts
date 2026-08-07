// The wake's timer, against an in-memory db: what is owed delivers now, what
// isn't waits, a phrase written straight to the wire lands absolute at apply,
// and nothing fires twice. The boot reconcile is
// the same call (arm) the effects sweep makes, which is the whole point
// — a wake owed while the process was gone is just an overdue row.
import { type Change } from './types.ts'
Deno.env.set('DB_PATH', ':memory:')
let { apply, db, journalOf, open } = await import('./db.ts')
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
let project = (() => {
  let eid = uid()
  apply(db, [
    { eid, name: 'doc', comp: { title: 'Homelab' } },
    { eid, name: 'project', comp: {} },
    { eid, name: 'repo', comp: { path: '/repo', base_branch: 'main' } },
  ])
  return eid
})()

let task = (() => {
  let eid = uid()
  apply(db, [
    { eid, name: 'doc', comp: { title: 'Rotate the key' } },
    { eid, name: 'task', comp: { status: 'open', project_eid: project } },
  ])
  return eid
})()

let operator = (() => {
  let role = uid(), eid = uid()
  apply(db, [
    { eid: role, name: 'role', comp: { scope_eid: project } },
    {
      eid,
      name: 'session',
      comp: {
        id: uid(),
        actor_eid: project,
        operator: true,
        role_eid: role,
      },
    },
  ])
  db.prepare(
    "update session set origin = 'managed', status = 'running' where eid = ?",
  ).run(eid)
  return eid
})()

let wake = (at: string, target?: string, body = '') => {
  let eid = uid()
  landed = apply(db, [
    { eid, name: 'doc', comp: { title: 'wake homelab', body } },
    {
      eid,
      name: 'wake',
      comp: { at, ...(target ? { target_eid: target } : {}) },
    },
    { eid, name: 'deliver', comp: { to: project } },
  ])
  return eid
}

Deno.test('an hour already past delivers the wake itself and journals it', () => {
  let w = wake(new Date(Date.now() - 60_000).toISOString())
  arm(cast)
  assertMatch(String(drow(w)?.via), /^cast S-\d+$/)
  assertEquals(db.prepare('select count(*) as n from knock').get(), { n: 0 })
  assertEquals(
    journalOf(db, w).some((e) =>
      e.changes.some((c) => c.name == 'delivered' && c.eid == w)
    ),
    true,
  )
})

Deno.test('a wake still owed waits, and fires once when it comes', () => {
  let w = wake(new Date(Date.now() + 3_600_000).toISOString())
  arm(cast)
  assertEquals(drow(w), undefined)
  assertEquals(db.prepare('select count(*) as n from knock').get(), { n: 0 })
  // the hour arrives (the row is the clock, so move the row)
  db.prepare('update wake set at = ? where eid = ?')
    .run(new Date(Date.now() - 1000).toISOString(), w)
  arm(cast)
  assertMatch(String(drow(w)?.via), /^cast S-\d+$/)
  let at = drow(w)?.at
  arm(cast) // a stamped wake is done — a second pass never redelivers
  assertEquals(drow(w)?.at, at)
})

Deno.test('no target: the wake is its own subject', () => {
  let w = wake(new Date(Date.now() - 1000).toISOString())
  arm(cast)
  assertMatch(String(drow(w)?.via), /^cast S-\d+$/)
  assertEquals(db.prepare('select count(*) as n from knock').get(), { n: 0 })
})

Deno.test('nobody awake: the wake spawns on its target without a knock', () => {
  db.prepare("update session set status = 'completed' where eid = ?")
    .run(operator)
  let w = wake(
    new Date(Date.now() - 1000).toISOString(),
    task,
    'the credential expires today',
  )
  arm(cast)
  assertMatch(String(drow(w)?.via), /^spawned S-\d+$/)
  assertEquals(db.prepare('select count(*) as n from knock').get(), { n: 0 })
  let made = db.prepare(
    'select requested_task_eid from session where requested_task_eid = ?',
  ).get(task)
  assertEquals(made, { requested_task_eid: task })
  let reason = db.prepare(
    `select d.body from comment c join doc d on d.eid = c.eid
     where c.target_eid = ? order by c.rowid desc limit 1`,
  ).get(task)
  assertEquals(reason, { body: 'the credential expires today' })
  db.prepare("update session set status = 'running' where eid = ?")
    .run(operator)
})

Deno.test('a new untargeted wake replaces only the pending untargeted one', () => {
  let at = new Date(Date.now() + 3_600_000).toISOString()
  let targeted = wake(at, task)
  let acted = wake(new Date(Date.now() - 1000).toISOString())
  arm(cast)
  let first = wake(at)
  let reminder = wake(at, task)
  let second = wake(at)
  assertEquals(wrow(targeted).target_eid, task)
  assertEquals(wrow(reminder).target_eid, task)
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
