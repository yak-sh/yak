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
// The fixer spawns the in-repo `fake` provider, so no phase-2 test launches a
// real agent — and these unit tests never register created(session), so the
// mint stops at the graph (the session + fixer marker) without a subprocess.
Deno.env.set('TASKS_FIXER_PROVIDER', 'fake')
Deno.env.set('TASKS_FIXER_MODEL', 'fake-fast')
let { apply } = await import('./db.ts')
let { db } = await import('./live_db.ts')
let { exceptionChange, excepted, delivered } = await import('./deliver.ts')
let {
  actionable,
  ensureFixer,
  faultKey,
  fileBug,
  FIXER_CAP,
  FIXER_PENDING,
  fixerBlocked,
  fixerRun,
  fixerTuning,
  HEAL_PENDING,
} = await import('./heal.ts')

let uid = () => crypto.randomUUID()
let now = () => new Date().toISOString()

// Component/edge tables are id-keyed (entity int → entity(id)); the spine keeps
// text eid. OWNED locates a component row by its owner eid; idOf resolves an eid
// to the internal id a reference column now stores.
let OWNED = `entity = (select id from entity where eid = ?)`
let idOf = `(select id from entity where eid = ?)`

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
  db.prepare(
    `select o.eid as eid, b.hits as hits from bug b
     join entity o on o.id = b.entity where b.fault = ?`,
  ).all(key) as {
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

  let task = db.prepare(`select status, priority from task where ${OWNED}`)
    .get(mine[0].eid) as { status: string; priority: number }
  assertEquals(task.status, 'open')
  assertEquals(task.priority, 1) // "cannot" reads fatal → jumps the queue

  // the pointer: an about edge to the broken entity, and its id in the body
  let edge = db.prepare(
    `select 1 from dependency where parent = ${idOf} and type = 'about' and child = ${idOf}`,
  ).get(mine[0].eid, eid)
  assert(edge, 'bug points at the broken entity')
  let body = (db.prepare(`select body from doc_value where ${OWNED}`)
    .get(mine[0].eid) as { body: string }).body
  assert(body.includes(msg), 'body carries the message')
})

Deno.test('a redacted Responses network interruption does not file a bug', () => {
  let eid = session()
  let msg = 'responses: transport failed'
  exceptionChange(eid, msg)
  file(eid, {})

  assertEquals(actionable('session', msg), false)
  assertEquals(bugsFor(faultKey('session', msg, null)), [])
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
  let body = (db.prepare(`select body from doc_value where ${OWNED}`)
    .get(mine[0].eid) as { body: string }).body
  assertEquals(body.match(/recurred/g)?.length, 1)
  assert(body.includes(`recurred ${2 * N}×`))
})

Deno.test('a recovered break files nothing (the tri-state guard)', () => {
  // (a) the exception was cleared before the effect ran (healed)
  let e1 = session()
  let m1 = 'transient-looking but cleared before heal'
  exceptionChange(e1, m1)
  db.prepare(`delete from exception where ${OWNED}`).run(e1) // recovery clears it
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

  let pending = (db.prepare(
    `select o.eid as eid from exception join entity o on o.id = exception.entity
     where ${HEAL_PENDING}`,
  ).all() as { eid: string }[]).map((r) => r.eid)
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
  let row = db.prepare(`select message from exception where ${OWNED}`)
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

// ---- Phase 2: the fixer spawn and its guardrails (D-17077) ----------------

// The fixers a bug summoned — a session marked `fixer` aimed at it. Empty when
// a guardrail suppressed the spawn.
let fixersFor = (bug: string) =>
  db.prepare(
    `select o.eid as eid from session s join fixer f on f.entity = s.entity
     join entity o on o.id = s.entity
     where s.requested_task = ${idOf}`,
  ).all(bug) as { eid: string }[]

// A minimal OPEN bug ticket carrying a fault key — the spawn's subject.
let makeBug = (key: string, project?: string) => {
  let eid = uid()
  apply(db, [
    { eid, name: 'doc', comp: { title: 'a bug', body: 'broke' } },
    {
      eid,
      name: 'task',
      comp: { status: 'open', priority: 2, project: project ?? null },
    },
    { eid, name: 'bug', comp: { fault: key, hits: 1, last: now() } },
  ])
  return eid
}

// A fixer session already aimed at a bug, at a given lifecycle status — what
// the cap counts (running) and the cooldown reaches (its bug's fault).
let makeFixer = (bug: string, status = 'running') => {
  let eid = uid()
  apply(db, [
    { eid, name: 'session', comp: { id: uid(), requested_task: bug } },
    { eid, name: 'fixer', comp: {} },
  ])
  db.prepare(`update session set status = ? where ${OWNED}`).run(status, eid)
  return eid
}

// A project entity; num forces it into the P-19 home slot for the global mute
// (parking whoever already holds that num at a free one — the shared :memory:
// db has minted plenty by now).
let makeProject = (num?: number) => {
  let eid = uid()
  apply(db, [
    { eid, name: 'doc', comp: { title: 'a project', body: '' } },
    { eid, name: 'project', comp: {} },
  ])
  if (num) {
    let free = (db.prepare('select coalesce(max(num), 0) + 1 as n from entity')
      .get() as { n: number }).n
    db.prepare('update entity set num = ? where num = ?').run(free, num)
    db.prepare('update entity set num = ? where eid = ?').run(num, eid)
  }
  return eid
}

// Clear the levers between guardrail tests: the shared :memory: db persists, so
// leftover fixers would keep the cap full and a leftover nofix would mute.
let reset = () => {
  db.exec('delete from fixer')
  db.exec('delete from nofix')
}

Deno.test('a new break files a ticket AND mints exactly one fixer', () => {
  reset()
  let eid = session()
  let msg = 'widget pipeline exploded mid-run'
  exceptionChange(eid, msg)
  file(eid, {})

  let key = faultKey('session', msg, null)
  let bug = (db.prepare(
    `select o.eid as eid from bug b join entity o on o.id = b.entity
     where b.fault = ?`,
  ).get(key) as {
    eid: string
  }).eid
  let fixers = fixersFor(bug)
  assertEquals(fixers.length, 1) // exactly one, not zero and not many

  // it is a managed fixer running the configured provider (fake here)
  let sp = db.prepare(`select provider, model from spawn where ${OWNED}`)
    .get(fixers[0].eid) as { provider: string; model: string }
  assertEquals(sp.provider, 'fake')
  assertEquals(sp.model, 'fake-fast')
})

Deno.test('a storm files ONE ticket and mints ONE fixer', () => {
  reset()
  let line = (r: number) => `cache miss storm after ${r} tries`
  for (let i = 0; i < 6; i++) {
    let e = session()
    exceptionChange(e, line(i))
    file(e, {})
  }
  let key = faultKey('session', line(0), null)
  let bugs = db.prepare(
    `select o.eid as eid from bug b join entity o on o.id = b.entity
     where b.fault = ?`,
  ).all(key) as {
    eid: string
  }[]
  assertEquals(bugs.length, 1) // dedup: one ticket
  assertEquals(fixersFor(bugs[0].eid).length, 1) // and one fixer, not six
})

Deno.test('at the concurrency cap the ticket files but no fixer spawns', () => {
  reset()
  // Fill the cap with running fixers on throwaway bugs.
  for (let i = 0; i < FIXER_CAP; i++) makeFixer(makeBug(`filler-${i}`))
  assertEquals(fixerBlocked(undefined, 'anything'), `at cap (${FIXER_CAP})`)

  let eid = session()
  let msg = 'a distinct break that arrives while the cap is full'
  exceptionChange(eid, msg)
  file(eid, {})

  let key = faultKey('session', msg, null)
  let bug = (db.prepare(
    `select o.eid as eid from bug b join entity o on o.id = b.entity
     where b.fault = ?`,
  ).get(key) as {
    eid: string
  }).eid
  assert(bug, 'the ticket still files at the cap')
  assertEquals(fixersFor(bug).length, 0) // but no fixer spawned
})

Deno.test('a per-venture mute suppresses the spawn, ticket still files', () => {
  reset()
  let project = makeProject()
  db.prepare(`insert into nofix (entity) values (${idOf})`).run(project)
  assertEquals(fixerBlocked(project, 'k'), 'muted')

  let bug = makeBug('venture-muted-key', project)
  ensureFixer(cast)(bug)
  assertEquals(fixersFor(bug).length, 0)
})

Deno.test('a global mute (nofix on P-19) suppresses every venture', () => {
  reset()
  let hp = makeProject(19) // the self-healing home
  db.prepare(`insert into nofix (entity) values (${idOf})`).run(hp)
  let other = makeProject()
  assertEquals(fixerBlocked(other, 'k'), 'muted') // a different venture too

  let bug = makeBug('global-muted-key', other)
  ensureFixer(cast)(bug)
  assertEquals(fixersFor(bug).length, 0)
  reset() // drop the global mute so later tests are not silenced
})

Deno.test('a per-fault cooldown suppresses a re-spawn for the same key', () => {
  reset()
  let key = 'flaky-fault-that-reopens'
  let bug1 = makeBug(key)
  makeFixer(bug1) // a fixer just spawned for this fault (created now)
  assertEquals(fixerBlocked(undefined, key), 'cooling down')
  // a different fault is not cooling
  assertEquals(fixerBlocked(undefined, 'a-cold-key'), null)

  // the fault recurs after its ticket closed: a new ticket, but no new fixer
  db.prepare(`update task set status = 'done' where ${OWNED}`).run(bug1)
  let bug2 = makeBug(key)
  ensureFixer(cast)(bug2)
  assertEquals(fixersFor(bug2).length, 0)
})

Deno.test('ensureFixer is idempotent — never a second fixer for one bug', () => {
  reset()
  let bug = makeBug('idempotent-key')
  ensureFixer(cast)(bug)
  ensureFixer(cast)(bug) // a re-drive (boot sweep, or a duplicate created)
  assertEquals(fixersFor(bug).length, 1)
})

// ——— T-18729: cap/cooldown/mute as role data on the `fixer` alias ———

Deno.test('fixer gates read the tuning handed in — cap and off', () => {
  reset()
  makeFixer(makeBug('one-runner')) // one running fixer
  let base = { quiet: 0, cooldown: 1800 }
  assertEquals(fixerBlocked(undefined, 'k', { ...base, cap: 1 }), 'at cap (1)')
  assertEquals(fixerBlocked(undefined, 'k', { ...base, cap: 5 }), null)
  // state != running on the role row is the mute made role data
  assertEquals(
    fixerBlocked(undefined, 'k', { ...base, cap: 5, off: true }),
    'stopped',
  )
})

Deno.test('fixerTuning reads the role row on the fixer alias', () => {
  reset()
  assertEquals(fixerTuning().off, false) // absent row: code defaults, live
  assertEquals(fixerTuning().cap, FIXER_CAP)
  let role = uid()
  apply(db, [
    { eid: role, name: 'doc', comp: { title: 'fixer', body: '' } },
    { eid: role, name: 'alias', comp: { slug: 'fixer' } },
    {
      eid: role,
      name: 'role',
      comp: { state: 'stopped', surface: 'native', cooldown: 60, cap: 7 },
    },
  ])
  let t = fixerTuning()
  assertEquals(t.cap, 7)
  assertEquals(t.cooldown, 60)
  assertEquals(t.off, true)
  // the live door respects the role mute: the ticket stands, no fixer
  let bug = makeBug('role-muted-key')
  ensureFixer(cast)(bug)
  assertEquals(fixersFor(bug).length, 0)
  apply(db, [{ eid: role, name: 'entity', comp: null }])
  assertEquals(fixerTuning().off, false)
})

Deno.test('fixerRun re-drives pending bugs and reports the tally', () => {
  reset()
  // Close every earlier test's bug: reset() dropped their fixer marks, which
  // would put them all back in the pending predicate.
  db.exec(
    `update task set status = 'done' where entity in (select entity from bug)`,
  )
  let bug = makeBug('sweep-me')
  let out = fixerRun({ quiet: 0, cooldown: 1800, cap: 2 }, cast)
  assertEquals(out.reason, 'spawned 1 of 1 pending bugs')
  assertEquals(fixersFor(bug).length, 1)
  assertEquals(out.observed, fixersFor(bug)[0].eid)
  // nothing pending on the next pass — the spawned bug left the predicate
  assertEquals(fixerRun({ quiet: 0, cooldown: 1800, cap: 2 }, cast), {
    reason: 'no pending bugs',
  })
})

Deno.test('the boot sweep re-drives only open, un-spawned tickets', () => {
  reset()
  let unspawned = makeBug('sweep-unspawned')
  let spawned = makeBug('sweep-spawned')
  makeFixer(spawned) // already has a fixer
  let closed = makeBug('sweep-closed')
  db.prepare(`update task set status = 'cancelled' where ${OWNED}`).run(closed)

  let pending = (db.prepare(
    `select o.eid as eid from bug join entity o on o.id = bug.entity
     where ${FIXER_PENDING}`,
  ).all() as { eid: string }[]).map((r) => r.eid)
  assert(pending.includes(unspawned), 'an un-spawned open bug is pending')
  assert(!pending.includes(spawned), 'a bug with a fixer drops out')
  assert(!pending.includes(closed), 'a closed bug drops out')
})
