// Self-healing phase 1 (D-17077, heal.ts) against a :memory: graph. The four
// proofs: a single break files one keyed, pointed ticket; a storm (identical
// AND volatile-only-differing) files ONE ticket with a recurrence tally, not
// N; a break the entity recovered from files nothing; and a throwing effect
// never rolls back the batch that carried the break. db.ts and its server-only
// siblings come in dynamically, AFTER the env points DB_PATH at :memory:, so
// nothing touches the owner's live graph.
import { assert, assertEquals } from '@std/assert'
import { type Change } from './types.ts'
import { on } from './effects.ts'

Deno.env.set('DB_PATH', ':memory:')
let { apply, db } = await import('./db.ts')
let { exceptionChange, excepted, delivered } = await import('./deliver.ts')
let { fileBug, faultKey, HEAL_PENDING } = await import('./heal.ts')

let uid = () => crypto.randomUUID()

// A no-op collector: fileBug's apply() has already persisted before cast, so a
// test only needs to swallow the broadcast.
let casts: Change[][] = []
let cast = (c: Change[]) => casts.push(c)
let file = fileBug(cast)

// A minimal session entity — the common break-bearer, so kindOf reads
// 'session' and the ticket keys under it.
let session = () => {
  let eid = uid()
  apply(db, [{ eid, name: 'session', comp: { id: uid() } }])
  return eid
}
let bugsFor = (key: string) =>
  db.prepare('select * from bug where fault = ?').all(key) as {
    eid: string
    hits: number
  }[]

Deno.test('a single break files one keyed, pointed, open ticket', () => {
  let eid = session()
  let msg = 'cannot read config for widget one'
  exceptionChange(eid, msg)
  file(eid, {})

  let key = faultKey('session', msg, null)
  let mine = bugsFor(key)
  assertEquals(mine.length, 1)
  assertEquals(mine[0].hits, 1)

  let task = db.prepare('select status, priority from task where eid = ?')
    .get(mine[0].eid) as { status: string; priority: number }
  assertEquals(task.status, 'open')
  assertEquals(task.priority, 1) // "cannot" reads fatal → jumps the queue

  // the pointer: an about edge to the broken entity, and its id in the body
  let edge = db.prepare(
    `select 1 from dependency where parent = ? and type = 'about' and child = ?`,
  ).get(mine[0].eid, eid)
  assert(edge, 'bug points at the broken entity')
  let body = (db.prepare('select body from doc where eid = ?')
    .get(mine[0].eid) as { body: string }).body
  assert(body.includes(msg), 'body carries the message')
})

Deno.test('a storm — identical and volatile-differing — files ONE ticket', () => {
  let N = 5
  let line = (r: number) => `db connection lost after ${r} retries`
  // N identical breaks, each on its own entity
  for (let i = 0; i < N; i++) {
    let e = session()
    exceptionChange(e, line(5))
    file(e, {})
  }
  // N more differing ONLY in the volatile retry count
  for (let i = 0; i < N; i++) {
    let e = session()
    exceptionChange(e, line(100 + i))
    file(e, {})
  }

  // every one of the 2N normalizes to the same key
  let key = faultKey('session', line(5), null)
  assertEquals(faultKey('session', line(999), null), key)
  let mine = bugsFor(key)
  assertEquals(mine.length, 1) // ONE ticket, not 2N
  assertEquals(mine[0].hits, 2 * N) // the recurrence tally

  // the footer records the recurrence, refreshed in place (one line, not 2N)
  let body = (db.prepare('select body from doc where eid = ?')
    .get(mine[0].eid) as { body: string }).body
  assertEquals(body.match(/recurred/g)?.length, 1)
  assert(body.includes(`recurred ${2 * N}×`))
})

Deno.test('a recovered break files nothing (the tri-state guard)', () => {
  // (a) the exception was cleared before the effect ran (healed)
  let e1 = session()
  let m1 = 'transient-looking but cleared before heal'
  exceptionChange(e1, m1)
  db.prepare('delete from exception where eid = ?').run(e1) // recovery clears it
  file(e1, {})
  assertEquals(bugsFor(faultKey('session', m1, null)).length, 0)

  // (b) the deliverable also succeeded (delivered stamped alongside)
  let e2 = session()
  let m2 = 'broke then delivered on retry'
  exceptionChange(e2, m2)
  delivered(e2, 'local', cast) // recovery: a success outcome
  file(e2, {})
  assertEquals(bugsFor(faultKey('session', m2, null)).length, 0)
})

Deno.test('the boot sweep re-drives only unfiled breaks', () => {
  let filed = session()
  exceptionChange(filed, 'swept and already filed')
  file(filed, {})
  let raw = session()
  exceptionChange(raw, 'swept but never filed') // no file()

  let pending = (db.prepare(`select eid from exception where ${HEAL_PENDING}`)
    .all() as { eid: string }[]).map((r) => r.eid)
  assert(!pending.includes(filed), 'a filed break drops out of the sweep')
  assert(pending.includes(raw), 'an unfiled break stays pending')
})

Deno.test('excepted() fires the effect live — stamp to ticket in one call', () => {
  on('exception', { created: fileBug(cast) })
  let eid = session()
  let msg = 'live wiring files a ticket through excepted'
  excepted(eid, msg, null, cast)
  assertEquals(bugsFor(faultKey('session', msg, null)).length, 1)
})

Deno.test('a throwing effect never rolls back the break that carried it', () => {
  on('exception', {
    created: () => {
      throw new Error('kaboom')
    },
  })
  let eid = session()
  let msg = 'the stamp must survive a throwing effect'
  // excepted() commits the exception row, THEN dispatches — a handler that
  // throws is isolated into telemetry, so it returns normally either way.
  excepted(eid, msg, null, cast)
  let row = db.prepare('select message from exception where eid = ?')
    .get(eid) as { message: string } | undefined
  assert(row?.message === msg, 'the break persisted despite the throw')
})

// The key folds in the stack head with its volatile line/col stripped, so the
// same fault at the same site keys together even as the code shifts under it.
Deno.test('faultKey folds the stack head and strips volatile bits', () => {
  let s1 =
    'Error: boom\n    at run (/src/heal.ts:42:7)\n    at boot (/src/x.ts:9:1)'
  let s2 =
    'Error: boom\n    at run (/src/heal.ts:88:3)\n    at boot (/src/x.ts:2:5)'
  // same message, same site, only the line/col moved → same key
  assertEquals(faultKey('session', 'boom', s1), faultKey('session', 'boom', s2))
  // a stack refines the key — it is not the same as no stack at all
  assert(faultKey('session', 'boom', s1) !== faultKey('session', 'boom', null))
  // no stack → the key rests on kind + message alone, no trailing @
  assert(!faultKey('session', 'plain', null).includes('@'))
})
