// Dep-completion knock (D-21448 Piece 2): an ended task wakes the claimant of
// every task that requires it and is now fully unblocked. Against an in-memory
// db, no server — the effect is a pure function of the graph a completion left.
import { type Change } from './types.ts'
import { link } from './edge.ts'
Deno.env.set('DB_PATH', ':memory:')
let { apply } = await import('./db.ts')
let { open } = await import('./store/sqlite.ts')
let { db } = await import('./live_db.ts')
let { unblocking } = await import('./unblock.ts')
let { assertEquals } = await import('@std/assert')

open()
let uid = () => crypto.randomUUID()
let sent: Change[] = []
let cast = (cs: Change[]) => sent.push(...cs)
let unblock = unblocking(cast)

let task = () => {
  let eid = uid()
  apply(db, [
    { eid, name: 'doc', comp: { title: 'a task' } },
    { eid, name: 'task', comp: { priority: 0 } }, // born open (D-24102)
  ])
  return eid
}
let session = () => {
  let eid = uid()
  apply(db, [{ eid, name: 'session', comp: { id: uid() } }])
  return eid
}
let requires = (parent: string, child: string) =>
  apply(db, link(parent, 'requires', child))
let claim = (taskEid: string, session: string) =>
  apply(db, [{ eid: taskEid, name: 'claim', comp: { session } }])
// End a dep for real: land its terminal MARK (D-24102) — `completed` for done,
// `cancelled` for cancelled — THEN run the post-commit effect on it. The effect
// reads the dep's committed status through gatedTask; its comp is ignored (the
// mark's PRESENCE is the end), so pass {}.
let ended = (dep: string, word: string) => {
  let mark = word == 'cancelled' ? 'cancelled' : 'completed'
  apply(db, [{ eid: dep, name: mark, comp: {} }])
  unblock(dep, {})
}

// The knocks minted at a given session in the last cast — each is a knock+deliver
// pair sharing an eid, so read the target off knock and the recipient off deliver.
let knocksTo = (session: string) => {
  let delivers = sent.filter((c) =>
    c.name == 'deliver' && (c.comp as { to?: string })?.to == session
  )
  let ks = new Set(delivers.map((c) => c.eid))
  return sent
    .filter((c) => c.name == 'knock' && ks.has(c.eid))
    .map((c) => (c.comp as { target?: string }).target)
}

Deno.test('an ended dep knocks the claimant of a now-unblocked dependent', () => {
  let dep = task()
  let t = task(), s = session()
  requires(t, dep)
  claim(t, s)
  ended(dep, 'done')
  assertEquals(knocksTo(s), [t])
})

Deno.test('no knock while another blocker still holds the dependent', () => {
  let depA = task(), depB = task()
  let t = task(), s = session()
  requires(t, depA)
  requires(t, depB)
  claim(t, s)
  ended(depA, 'done') // depB still open → t stays gated
  assertEquals(knocksTo(s), [])
})

Deno.test('a dependent with no claimant is skipped', () => {
  let dep = task()
  let t = task() // unclaimed
  requires(t, dep)
  ended(dep, 'done')
  // nothing was cast about t at all
  assertEquals(
    sent.some((c) =>
      c.name == 'knock' && (c.comp as { target?: string }).target == t
    ),
    false,
  )
})

Deno.test('cancelled ends a dep the same as done', () => {
  let dep = task()
  let t = task(), s = session()
  requires(t, dep)
  claim(t, s)
  ended(dep, 'cancelled')
  assertEquals(knocksTo(s), [t])
})

Deno.test('a claim on a dep is not an ending — nobody is knocked', () => {
  let dep = task()
  let t = task(), s = session()
  requires(t, dep)
  claim(t, s)
  // The dep goes wip via a live claim (D-24102) — no terminal mark lands, so
  // the unblock effect (registered on completed/cancelled) never fires at all.
  claim(dep, session())
  assertEquals(knocksTo(s), [])
})

Deno.test('the resume knock settles the parked fallback wake delivered', () => {
  let dep = task()
  let t = task(), s = session()
  requires(t, dep)
  claim(t, s)
  // The park's safety fallback: a wake aimed at the session, unresolved.
  let w = uid()
  apply(db, [
    { eid: w, name: 'wake', comp: { at: '2099-01-01T00:00:00.000Z' } },
    { eid: w, name: 'deliver', comp: { to: s } },
  ])
  ended(dep, 'done')
  assertEquals(knocksTo(s).length, 1) // the resume happened
  let row = db.prepare(
    `select via from delivered
     where entity = (select id from entity where eid = ?)`,
  ).get(w) as { via: string } | undefined
  assertEquals(row != null, true) // the fallback is settled, not pending
  assertEquals(String(row?.via).startsWith('knock '), true)
})

Deno.test('no pending wake: the knock still lands, nothing settles', () => {
  let dep = task()
  let t = task(), s = session()
  requires(t, dep)
  claim(t, s)
  ended(dep, 'done') // no wake armed at all — must not throw
  assertEquals(knocksTo(s).length, 1)
})
