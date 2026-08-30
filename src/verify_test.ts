// The verifier policy and role engine against a disposable graph. These tests
// exercise the derived review truth separately from spawning, then prove the
// role gates, retry/idempotency lease, bounded query plan, and composed persona
// identity without registering a session-launch effect or starting a process.
import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
  assertThrows,
} from '@std/assert'
import type { Change } from './types.ts'

Deno.env.set('DB_PATH', ':memory:')
Deno.env.set('TASKS_VERIFIER_PROVIDER', 'fake')
Deno.env.set('TASKS_VERIFIER_MODEL', 'fake-fast')

let { apply, human, readComp, snapshot } = await import('./db.ts')
let { db } = await import('./live_db.ts')
let { rows, spawnChanges } = await import('./client.ts')
let { rowsFor } = await import('./graph_query.ts')
let { materialize } = await import('./persona.ts')
let { textPresent } = await import('./sqlite.ts')
let {
  hasVerifier,
  verificationArgs,
  verificationPending,
  VERIFY_PENDING,
} = await import('./verification.ts')
let {
  ensureVerifier,
  requestVerifier,
  settleVerification,
  verifierBlocked,
  verifierIdentity,
  verifierRun,
  verifierTuning,
  VERIFIER_ROLE,
  VERIFIER_TUNING,
} = await import('./verify.ts')

let uid = () => crypto.randomUUID()
let iso = (minutes: number) =>
  new Date(Date.now() + minutes * 60_000).toISOString()
let OWNED = `entity = (select id from entity where eid = ?)`
let idOf = `(select id from entity where eid = ?)`
let casts: Change[][] = []
let cast = (changes: Change[]) => casts.push(changes)

let project = uid()
let persona = uid()
let memory = uid()
apply(db, [
  { eid: project, name: 'doc', comp: { title: 'Verifier tests' } },
  { eid: project, name: 'project', comp: {} },
  {
    eid: project,
    name: 'repo',
    comp: { path: '/tmp/verifier-tests', base_branch: 'main' },
  },
  { eid: persona, name: 'doc', comp: { title: 'verifier' } },
  { eid: persona, name: 'alias', comp: { slug: 'verifier' } },
  { eid: persona, name: 'persona', comp: { home: project } },
  {
    eid: persona,
    name: 'role',
    comp: {
      state: 'running',
      surface: 'managed',
      scope: project,
      quiet: 0,
      cooldown: VERIFIER_TUNING.cooldown,
      cap: VERIFIER_TUNING.cap,
    },
  },
  {
    eid: persona,
    name: 'spawn',
    comp: { provider: 'fake', model: 'fake-fast', effort: 'high' },
  },
  {
    eid: memory,
    name: 'doc',
    comp: {
      title: 'verify independently',
      body: 'DRIVE THE ACCEPTANCE SURFACES.',
    },
  },
  { eid: memory, name: 'memory', comp: { scope: project } },
  {
    eid: persona,
    name: 'dependency',
    comp: { type: 'contains', child: memory },
  },
])

let reset = () => {
  db.exec('delete from claim')
  db.exec('delete from verifier')
  db.exec('delete from noverify')
  db.exec('delete from review')
  db.exec('delete from accept')
  db.exec('delete from completed')
  db.exec('delete from cancelled')
  db.exec('delete from conflict')
  db.prepare(
    `update role set state = 'running', quiet = 0, cooldown = ?, cap = ?
      where ${OWNED}`,
  ).run(VERIFIER_TUNING.cooldown, VERIFIER_TUNING.cap, persona)
  casts = []
}

let session = (status = 'completed') => {
  let eid = uid()
  apply(db, [{ eid, name: 'session', comp: { id: uid() } }])
  db.prepare(`update session set status = ? where ${OWNED}`).run(status, eid)
  return eid
}

let task = (options: { accept?: boolean; cancelled?: boolean } = {}) => {
  let builder = session()
  let eid = uid()
  let completed = iso(-60)
  apply(db, [
    { eid, name: 'doc', comp: { title: 'completed work', body: 'build it' } },
    { eid, name: 'task', comp: { priority: 2, project } },
    ...(options.accept === false
      ? []
      : [{ eid, name: 'accept', comp: { body: 'exercise the shipped door' } }]),
  ])
  apply(
    db,
    [{ eid, name: 'completed', comp: { at: completed } }],
    undefined,
    builder,
  )
  if (options.cancelled) {
    apply(db, [{ eid, name: 'cancelled', comp: { at: iso(-1) } }])
  }
  return { eid, builder, completed }
}

let review = (
  task: string,
  reviewer: string,
  verdict: string,
  body = 'Ran the acceptance recipe.',
  at = iso(-30),
) => {
  let eid = uid()
  apply(
    db,
    [
      { eid, name: 'doc', comp: { title: '', body } },
      { eid, name: 'comment', comp: { target: task } },
      { eid, name: 'review', comp: { verdict } },
    ],
    undefined,
    reviewer,
  )
  db.prepare(`update created set at = ? where ${OWNED}`).run(at, eid)
  return eid
}

let verifier = (
  task: string,
  at: string,
  status: string | null = 'running',
) => {
  let eid = uid()
  apply(db, [
    {
      eid,
      name: 'session',
      comp: { id: uid(), requested_task: task, persona },
    },
    { eid, name: 'verifier', comp: {} },
  ])
  db.prepare(`update created set at = ? where ${OWNED}`).run(at, eid)
  db.prepare(`update session set status = ? where ${OWNED}`).run(status, eid)
  if (status == null || ['starting', 'running', 'stopping'].includes(status)) {
    apply(db, [{ eid: task, name: 'claim', comp: { session: eid } }])
  }
  return eid
}

let verifiersFor = (task: string) =>
  db.prepare(
    `select owner.eid as eid from session
     join verifier on verifier.entity = session.entity
     join entity owner on owner.id = session.entity
     where session.requested_task = ${idOf}`,
  ).all(task) as { eid: string }[]

Deno.test('VERIFY_PENDING requires accept + completed, excludes cancelled and unattributed completion', () => {
  reset()
  let plain = task({ accept: false })
  assertEquals(verificationPending(db, plain.eid), false)
  apply(db, [{ eid: plain.eid, name: 'accept', comp: { body: 'check it' } }])
  assertEquals(verificationPending(db, plain.eid), true)
  apply(db, [{ eid: plain.eid, name: 'completed', comp: null }])
  assertEquals(verificationPending(db, plain.eid), false)

  let calledOff = task({ cancelled: true })
  assertEquals(verificationPending(db, calledOff.eid), false)

  let unstamped = task()
  db.prepare(`update completed set via = null where ${OWNED}`).run(
    unstamped.eid,
  )
  assertEquals(verificationPending(db, unstamped.eid), false)
  db.prepare(`update completed set via = ${idOf} where ${OWNED}`).run(
    project,
    unstamped.eid,
  )
  assertEquals(verificationPending(db, unstamped.eid), false)
})

Deno.test('latest qualifying independent verdict wins', () => {
  reset()
  let approved = task(), reviewer = session()
  review(approved.eid, reviewer, 'approved')
  assertEquals(verificationPending(db, approved.eid), false)

  let rejected = task()
  review(rejected.eid, reviewer, 'rejected')
  assertEquals(verificationPending(db, rejected.eid), true)

  let changes = task()
  review(changes.eid, reviewer, 'changes_requested')
  assertEquals(verificationPending(db, changes.eid), true)

  let reversed = task()
  review(reversed.eid, reviewer, 'approved', 'first pass', iso(-40))
  review(reversed.eid, reviewer, 'rejected', 'later failure', iso(-20))
  assertEquals(verificationPending(db, reversed.eid), true)

  let fixed = task()
  review(fixed.eid, reviewer, 'rejected', 'first failure', iso(-40))
  review(fixed.eid, reviewer, 'approved', 'later pass', iso(-20))
  assertEquals(verificationPending(db, fixed.eid), false)

  let tied = task(), tie = iso(-20)
  let a = review(tied.eid, reviewer, 'approved', 'one', tie)
  let b = review(tied.eid, reviewer, 'rejected', 'two', tie)
  assertEquals(
    verificationPending(db, tied.eid),
    (a > b ? 'approved' : 'rejected') != 'approved',
  )
})

Deno.test('empty, self-authored, unstamped, and stale reviews do not qualify', () => {
  reset()
  let empty = task(), reviewer = session()
  review(empty.eid, reviewer, 'approved', ' \t\r\n')
  assertEquals(verificationPending(db, empty.eid), true)

  let self = task()
  review(self.eid, self.builder, 'approved')
  assertEquals(verificationPending(db, self.eid), true)

  let unstamped = task()
  let missing = review(unstamped.eid, reviewer, 'approved')
  db.prepare(`update created set via = null where ${OWNED}`).run(missing)
  assertEquals(verificationPending(db, unstamped.eid), true)

  let stale = task()
  review(stale.eid, reviewer, 'approved', 'old evidence', iso(-90))
  assertEquals(verificationPending(db, stale.eid), true)
})

Deno.test('review evidence shares Unicode-aware JavaScript whitespace semantics', () => {
  let whitespace = ['\u00a0', '\u2003', '\u3000', '\ufeff']
  for (let body of whitespace) {
    reset()
    let work = task(), reviewer = session()
    assertEquals(textPresent(body), false)
    review(work.eid, reviewer, 'approved', body)
    assertEquals(verificationPending(db, work.eid), true, JSON.stringify(body))
  }

  reset()
  let work = task(), reviewer = session()
  let body = '\u00a0\u2003Ran the check.\u3000\ufeff'
  assertEquals(textPresent(body), true)
  review(work.eid, reviewer, 'approved', body)
  assertEquals(verificationPending(db, work.eid), false)
})

Deno.test('null and active current-cycle verifiers suppress; terminal and stale-cycle verifiers permit retry', () => {
  for (let status of [null, 'starting', 'running', 'stopping']) {
    reset()
    let work = task()
    verifier(work.eid, iso(-30), status)
    assertEquals(hasVerifier(db, work.eid), true, String(status))
    assertEquals(verificationPending(db, work.eid), false, String(status))
  }
  for (let status of ['completed', 'failed', 'interrupted', 'lost']) {
    reset()
    let work = task()
    verifier(work.eid, iso(-30), status)
    assertEquals(hasVerifier(db, work.eid), false, status)
    assertEquals(verificationPending(db, work.eid), true, status)
  }
  reset()
  let work = task()
  verifier(work.eid, iso(-90), 'running')
  assertEquals(hasVerifier(db, work.eid), false)
  assertEquals(verificationPending(db, work.eid), true)
})

Deno.test('recompletion starts a fresh review and verifier cycle', () => {
  reset()
  let work = task(), reviewer = session()
  review(work.eid, reviewer, 'approved', 'old cycle passed', iso(-30))
  verifier(work.eid, iso(-20), 'running')
  assertEquals(verificationPending(db, work.eid), false)
  let nextBuilder = session()
  let next = iso(-10)
  apply(db, [
    { eid: work.eid, name: 'claim', comp: null },
    { eid: work.eid, name: 'completed', comp: null },
  ])
  apply(
    db,
    [{ eid: work.eid, name: 'completed', comp: { at: next } }],
    undefined,
    nextBuilder,
  )
  assertEquals(hasVerifier(db, work.eid), false)
  assertEquals(verificationPending(db, work.eid), true)
  review(work.eid, nextBuilder, 'approved', 'builder says it passes', iso(-5))
  assertEquals(verificationPending(db, work.eid), true)
  review(work.eid, reviewer, 'approved', 'independent pass', iso(-4))
  assertEquals(verificationPending(db, work.eid), false)
})

Deno.test('review settlement preserves approval and reopens rejection or requested changes', () => {
  for (let verdict of ['approved', 'rejected', 'changes_requested']) {
    reset()
    let work = task(), reviewer = session()
    let judgment = review(work.eid, reviewer, verdict)
    settleVerification(cast)(judgment)
    assertEquals(
      !!readComp(db, work.eid, 'completed'),
      verdict == 'approved',
      verdict,
    )
    assertEquals(readComp(db, work.eid, 'task')?.status, undefined)

    let writes = casts.length
    settleVerification(cast)(judgment)
    assertEquals(casts.length, writes, `${verdict} replay is idempotent`)
  }
})

Deno.test('review settlement ignores stale-cycle, empty, self-authored, unstamped, and nonlatest reviews', () => {
  let ignored = (
    make: (work: ReturnType<typeof task>, reviewer: string) => string,
  ) => {
    reset()
    let work = task(), reviewer = session()
    let judgment = make(work, reviewer)
    settleVerification(cast)(judgment)
    assert(readComp(db, work.eid, 'completed'))
    assertEquals(casts.length, 0)
  }

  ignored((work, reviewer) =>
    review(work.eid, reviewer, 'rejected', 'old cycle', iso(-90))
  )
  ignored((work, reviewer) =>
    review(work.eid, reviewer, 'rejected', '\u00a0\u2003')
  )
  ignored((work) => review(work.eid, work.builder, 'rejected'))
  ignored((work, reviewer) => {
    let judgment = review(work.eid, reviewer, 'rejected')
    db.prepare(`update created set via = null where ${OWNED}`).run(judgment)
    return judgment
  })
  ignored((work, reviewer) => {
    let old = review(
      work.eid,
      reviewer,
      'rejected',
      'superseded failure',
      iso(-30),
    )
    review(work.eid, reviewer, 'approved', 'latest pass', iso(-20))
    return old
  })
})

Deno.test('review settlement applies only the latest qualifying verdict', () => {
  reset()
  let work = task(), reviewer = session()
  review(work.eid, reviewer, 'approved', 'first pass', iso(-30))
  let latest = review(
    work.eid,
    reviewer,
    'changes_requested',
    'new regression',
    iso(-20),
  )
  settleVerification(cast)(latest)
  assertEquals(readComp(db, work.eid, 'completed'), undefined)
})

Deno.test('completion cancelled before its handler cannot spawn a verifier', () => {
  reset()
  let work = task()
  apply(db, [{ eid: work.eid, name: 'cancelled', comp: {} }])
  assertEquals(ensureVerifier(cast)(work.eid), undefined)
  assertEquals(verifiersFor(work.eid), [])
})

Deno.test('ensureVerifier composes the verifier identity and target project into one spawn', () => {
  reset()
  let work = task()
  let made = ensureVerifier(cast)(work.eid)
  assert(made)
  assertEquals(verifiersFor(work.eid), [{ eid: made }])
  let spawned = readComp(db, made, 'spawn')!
  assertEquals(spawned.provider, 'fake')
  assertEquals(spawned.model, 'fake-fast')
  assertEquals(spawned.effort, 'high')
  assertEquals(spawned.persona, persona)
  assertEquals(readComp(db, made, 'session')?.actor, project)
  assertEquals(readComp(db, made, 'session')?.role, null)
  assertEquals(readComp(db, work.eid, 'claim')?.session, made)

  let snap = snapshot(db)
  let all = rows(snap)
  let p = all.find((row) => row.eid == persona)!
  assert(p.comps.persona && p.comps.role, 'one entity composes persona + role')
  assertStringIncludes(
    materialize(all, snap.deps, p, Date.now()),
    'DRIVE THE ACCEPTANCE SURFACES.',
  )
})

Deno.test('ensureVerifier is idempotent and the claim makes a prechecked racer lose atomically', () => {
  reset()
  let work = task()
  let corpus = rowsFor(db, [work.eid, persona])
  let first = spawnChanges(corpus, {
    task: work.eid,
    provider: 'fake',
    model: 'fake-fast',
    persona,
  })
  let second = spawnChanges(corpus, {
    task: work.eid,
    provider: 'fake',
    model: 'fake-fast',
    persona,
  })
  let batch = (made: typeof first): Change[] => [
    ...made.changes,
    { eid: made.eid, name: 'verifier', comp: {} },
    { eid: work.eid, name: 'claim', comp: { session: made.eid } },
  ]
  apply(db, batch(first))
  assertThrows(() => apply(db, batch(second)), Error, 'already claimed')
  assertEquals(verifiersFor(work.eid), [{ eid: first.eid }])
  assertEquals(readComp(db, second.eid, 'session'), undefined)

  // The ordinary imperative door observes the committed null-status verifier
  // and remains a no-op across an immediate re-drive/restart sweep.
  assertEquals(ensureVerifier(cast)(work.eid), undefined)
  assertEquals(verifiersFor(work.eid).length, 1)
})

Deno.test('role state, cap, quiet, cooldown, and terminal retry govern every spawn', () => {
  reset()
  let work = task()
  let base = { quiet: 0, cooldown: 300, cap: 2 }
  assertEquals(
    verifierBlocked(work.eid, { project, at: work.completed }, {
      ...base,
      off: true,
    }),
    'stopped',
  )
  assertEquals(
    verifierBlocked(work.eid, { project, at: iso(1) }, base),
    'quiet',
  )

  let filler = task()
  verifier(filler.eid, iso(-30), 'running')
  assertEquals(
    verifierBlocked(work.eid, { project, at: work.completed }, {
      ...base,
      cap: 1,
    }),
    'at cap (1)',
  )

  reset()
  work = task()
  let failed = ensureVerifier(cast)(work.eid)!
  db.prepare(`update session set status = 'failed' where ${OWNED}`).run(failed)
  apply(db, [{ eid: work.eid, name: 'claim', comp: null }])
  assertEquals(
    verifierBlocked(work.eid, { project, at: work.completed }, base),
    'cooling down',
  )
  assertEquals(ensureVerifier(cast)(work.eid, undefined, base), undefined)
  db.prepare(`update created set at = ? where ${OWNED}`).run(iso(-10), failed)
  assert(
    ensureVerifier(cast)(work.eid, undefined, base),
    'terminal verifier retries after cooldown',
  )
})

Deno.test('project noverify mutes automatic spawn only and remains pending for manual work', () => {
  reset()
  let work = task()
  db.prepare(`insert into noverify (entity) values (${idOf})`).run(project)
  assertEquals(verificationPending(db, work.eid), true)
  assertEquals(ensureVerifier(cast)(work.eid), undefined)
  assertEquals(verifiersFor(work.eid), [])
  assert(
    ensureVerifier(cast, false)(work.eid),
    'manual summon bypasses noverify',
  )
})

Deno.test('explicit verification resolves aliases, bypasses noverify, and returns one human verifier', () => {
  reset()
  let work = task()
  apply(db, [
    { eid: work.eid, name: 'alias', comp: { slug: 'verify-me' } },
    { eid: project, name: 'noverify', comp: {} },
  ])

  let made = requestVerifier(cast, 'verify-me', 'desktop')
  assertEquals(made, {
    state: 'spawned',
    target: human(db, work.eid),
    verifier: human(db, verifiersFor(work.eid)[0].eid),
    reason: 'independent verification started',
  })
  assertEquals(
    db.prepare('select count(*) as n from review').get(),
    { n: 0 },
  )

  let again = requestVerifier(cast, human(db, work.eid), 'desktop')
  assertEquals(again, {
    ...made,
    state: 'existing',
    reason: 'independent verification is already in progress',
  })
  assertEquals(verifiersFor(work.eid).length, 1)
})

Deno.test('explicit verification gives specific state and verdict refusals', () => {
  reset()
  let open = task()
  apply(db, [{ eid: open.eid, name: 'completed', comp: null }])
  assertThrows(
    () => requestVerifier(cast, human(db, open.eid)),
    Error,
    'is not completed',
  )

  let criteria = task({ accept: false })
  assertThrows(
    () => requestVerifier(cast, human(db, criteria.eid)),
    Error,
    'has no acceptance criteria',
  )

  let cancelled = task({ cancelled: true })
  assertThrows(
    () => requestVerifier(cast, human(db, cancelled.eid)),
    Error,
    'is cancelled',
  )

  let approved = task(), reviewer = session()
  review(approved.eid, reviewer, 'approved')
  assertThrows(
    () => requestVerifier(cast, human(db, approved.eid)),
    Error,
    'already has an approving independent review',
  )

  for (let verdict of ['rejected', 'changes_requested']) {
    let pending = task(), independent = session()
    review(pending.eid, independent, verdict)
    assertEquals(requestVerifier(cast, human(db, pending.eid)).state, 'spawned')
    let made = verifiersFor(pending.eid)[0].eid
    apply(db, [{ eid: pending.eid, name: 'claim', comp: null }])
    db.prepare(`update session set status = 'completed' where ${OWNED}`).run(
      made,
    )
  }
})

Deno.test('explicit verification keeps live role gates and automatic/manual idempotency', () => {
  reset()
  let stopped = task()
  db.prepare(`update role set state = 'stopped' where ${OWNED}`).run(persona)
  assertThrows(
    () => requestVerifier(cast, human(db, stopped.eid)),
    Error,
    'cannot start verification: stopped',
  )

  reset()
  let capped = task(), filler = task()
  verifier(filler.eid, iso(-30), 'running')
  db.prepare(`update role set cap = 1 where ${OWNED}`).run(persona)
  assertThrows(
    () => requestVerifier(cast, human(db, capped.eid)),
    Error,
    'cannot start verification: at cap (1)',
  )

  reset()
  let cooling = task()
  let failed = ensureVerifier(cast)(cooling.eid)!
  db.prepare(`update session set status = 'failed' where ${OWNED}`).run(failed)
  apply(db, [{ eid: cooling.eid, name: 'claim', comp: null }])
  assertThrows(
    () => requestVerifier(cast, human(db, cooling.eid)),
    Error,
    'cannot start verification: cooling down',
  )

  reset()
  let automatic = task()
  let auto = ensureVerifier(cast)(automatic.eid)!
  assertEquals(
    requestVerifier(cast, human(db, automatic.eid)).verifier,
    human(db, auto),
  )
  assertEquals(verifiersFor(automatic.eid).length, 1)

  reset()
  let manual = task()
  requestVerifier(cast, human(db, manual.eid))
  assertEquals(ensureVerifier(cast)(manual.eid), undefined)
  assertEquals(verifiersFor(manual.eid).length, 1)
})

Deno.test('explicit verification rolls a conflicting spawn back and keeps the conflict audit', () => {
  reset()
  let work = task(), holder = session('running')
  apply(db, [{ eid: work.eid, name: 'claim', comp: { session: holder } }])

  assertThrows(
    () => requestVerifier(cast, human(db, work.eid), 'desktop'),
    Error,
    'already claimed',
  )
  assertEquals(verifiersFor(work.eid), [])
  assertEquals(
    db.prepare('select count(*) as n from conflict').get(),
    { n: 1 },
  )
})

Deno.test('explicit verification hides quarantined targets without spawning', () => {
  reset()
  let work = task(), id = human(db, work.eid)
  apply(db, [{ eid: work.eid, name: 'quarantined', comp: {} }])
  assertThrows(
    () => requestVerifier(cast, id),
    Error,
    `no visible task: ${id}`,
  )
  assertEquals(verifiersFor(work.eid), [])
})

Deno.test('verifier identity fails closed when alias, persona, or role configuration is missing', () => {
  reset()
  assertEquals(verifierIdentity(), persona)
  apply(db, [{ eid: persona, name: 'persona', comp: null }])
  assertThrows(() => verifierIdentity(), Error, 'does not wear persona')
  apply(db, [{ eid: persona, name: 'persona', comp: { home: project } }])
  apply(db, [{ eid: persona, name: 'role', comp: null }])
  assertThrows(() => verifierIdentity(), Error, 'does not wear role')
  apply(db, [{
    eid: persona,
    name: 'role',
    comp: {
      state: 'running',
      surface: 'managed',
      scope: project,
      quiet: 0,
      cooldown: 300,
      cap: 2,
    },
  }])
  apply(db, [{ eid: persona, name: 'alias', comp: null }])
  assertThrows(() => verifierIdentity(), Error, 'alias is missing')
  apply(db, [{ eid: persona, name: 'alias', comp: { slug: 'verifier' } }])
})

Deno.test('verifierTuning and VERIFIER_ROLE use the composed graph role', () => {
  reset()
  apply(db, [{
    eid: persona,
    name: 'role',
    comp: { state: 'stopped', quiet: 7, cooldown: 11, cap: 3 },
  }])
  assertEquals(verifierTuning(), { quiet: 7, cooldown: 11, cap: 3, off: true })
  assertEquals(VERIFIER_ROLE.alias, 'verifier')
  assertEquals(VERIFIER_ROLE.defaults, VERIFIER_TUNING)
})

Deno.test('verifierRun is bounded, newest-first, idempotent, and excludes automatic mutes', () => {
  reset()
  let old = task(), newest = task(), muted = task()
  apply(
    db,
    [{ eid: old.eid, name: 'completed', comp: { at: iso(-50) } }],
    undefined,
    old.builder,
  )
  apply(
    db,
    [{ eid: newest.eid, name: 'completed', comp: { at: iso(-10) } }],
    undefined,
    newest.builder,
  )
  // Give the muted task its own muted project so it does not mute the other two.
  let p2 = uid()
  apply(db, [
    { eid: p2, name: 'project', comp: {} },
    { eid: muted.eid, name: 'task', comp: { project: p2 } },
  ])
  db.prepare(`insert into noverify (entity) values (${idOf})`).run(p2)

  let out = verifierRun({ quiet: 0, cooldown: 0, cap: 1 }, cast)
  assertMatch(out.reason, /spawned 1 of 1/)
  assertEquals(verifiersFor(newest.eid).length, 1)
  assertEquals(verifiersFor(old.eid).length, 0)
  assertEquals(verifiersFor(muted.eid).length, 0)
  assertEquals(verificationPending(db, muted.eid), true)
  assertEquals(verifierRun({ quiet: 0, cooldown: 0, cap: 1 }, cast), {
    reason: 'at cap (1)',
  })
})

Deno.test('VERIFY_PENDING plans from authored indexes with bounded target subqueries', () => {
  reset()
  let plan = db.prepare(
    `explain query plan
     select owner.eid
       from completed indexed by completed_at
       join task on task.entity = completed.entity
       join entity owner on owner.id = task.entity
      where ${VERIFY_PENDING}
      order by completed.at desc
      limit 20`,
  ).all(...verificationArgs()) as { detail: string }[]
  let details = plan.map((row) => row.detail).join('\n')
  assertMatch(details, /completed_at/)
  assertMatch(details, /comment_target/)
  assertMatch(details, /session_requested_task/)
  assert(!/SCAN (?:_vm|_vr|_ve|_vd|_va|_vs|s)\b/.test(details), details)

  let cap = db.prepare(
    `explain query plan
     select count(distinct claim.session)
       from claim indexed by claim_session
       join verifier on verifier.entity = claim.session`,
  ).all() as { detail: string }[]
  let capDetails = cap.map((row) => row.detail).join('\n')
  assertMatch(capDetails, /claim_session/)
  assert(!/SCAN session\b/.test(capDetails), capDetails)
})

Deno.test('boot registers system roles before replay, so verifier runs on its first sweep', async () => {
  reset()
  let work = task()
  apply(db, [{
    eid: persona,
    name: 'spawn',
    comp: { provider: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
  }])

  let { bootDoing, wireDoing } = await import('./doing.ts')
  let { configureEffects } = await import('./effects.ts')
  let { tick: nextTick } = await import('./testing.ts')
  let { stop } = await import('./timers.ts')
  let restore = configureEffects({
    split: true,
    want: (where) => where == 'do',
    settle: () => {},
  })
  try {
    let doing = {
      cast,
      codexReady: () => Promise.resolve(true),
      readyProviders: () => Promise.resolve([]),
    }
    let { syncSoon } = wireDoing(doing)
    bootDoing(doing, syncSoon)
    await nextTick()

    assertEquals(verifiersFor(work.eid).length, 1)
    assertEquals(
      db.prepare(
        `select count(*) as n from session where role = ${idOf}`,
      ).get(persona),
      { n: 0 },
      'the verifier role never entered the operator reconciler',
    )
  } finally {
    stop()
    restore()
  }
})
