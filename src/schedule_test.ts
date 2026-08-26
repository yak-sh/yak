// The scheduler-as-data invariant (T-18725) and the full loop proof for a
// non-always role (T-18726): wake → knock → reconcile → spawn → settle →
// sleep, against an in-memory graph and a fake tmux — no provider launches.
import { assert, assertEquals, assertMatch } from '@std/assert'
import { slow, tick, until } from './testing.ts'
import { type Change } from './types.ts'

Deno.env.set('DB_PATH', ':memory:')
Deno.env.set('TERM', 'dumb')
Deno.env.set('HOLDCO_TMUX_SESSION', 'owner-test')
let home = Deno.makeTempDirSync({ prefix: 'tasks-schedule-home-' })
Deno.env.set('HOME', home)
Deno.mkdirSync(`${home}/.deno/bin`, { recursive: true })
Deno.writeTextFileSync(`${home}/.deno/bin/task`, '')
Deno.chmodSync(`${home}/.deno/bin/task`, 0o755)

let { apply, db } = await import('./db.ts')
let { scheduleArm, scheduleKnocked, scheduleSettled } = await import(
  './schedule.ts'
)
let { arm } = await import('./wake.ts')
let { knocked } = await import('./knock.ts')
let { on } = await import('./effects.ts')
let { roleAttention } = await import('./roles.ts')

let uid = () => crypto.randomUUID()
let heard: Change[] = []
let cast = (changes: Change[]) => heard.push(...changes)
let dir = Deno.makeTempDirSync({ prefix: 'tasks-schedule-repo-' })

let OWNED = `entity = (select id from entity where eid = ?)`
let idOf = `(select id from entity where eid = ?)`

// The fake tmux/provider deps roles.ts reconciliation takes (roles_test's
// shape, trimmed to what the wake-policy path touches).
let ok = () => ({
  success: true,
  stdout: new Uint8Array(),
  stderr: new Uint8Array(),
})
let deps = {
  now: () => new Date().toISOString(),
  remove: () => {},
  wait: () => Promise.resolve(),
  write: () => {},
  command: (args: string[]) => {
    if (args[0] == 'has-session') {
      return Promise.resolve({ ...ok(), success: false })
    }
    if (args[0] == 'list-panes') {
      return Promise.resolve({ ...ok(), stdout: new TextEncoder().encode('') })
    }
    return Promise.resolve(ok())
  },
}

let seed = (schedule: string, policy = 'scheduled') => {
  let project = uid()
  let role = uid()
  apply(db, [
    { eid: project, name: 'doc', comp: { title: 'Venture', body: '' } },
    { eid: project, name: 'project', comp: {} },
    { eid: project, name: 'repo', comp: { path: dir, base_branch: 'main' } },
    { eid: role, name: 'doc', comp: { title: 'Runner', body: 'Run.' } },
    {
      eid: role,
      name: 'role',
      comp: {
        state: 'running',
        surface: 'managed',
        scope: project,
        wake_policy: policy,
        schedule,
      },
    },
    {
      eid: role,
      name: 'spawn',
      comp: { provider: 'fake', model: 'fake-fast' },
    },
  ])
  return { project, role }
}

// The role's pending self-wakes: untargeted, addressed to it, unacted.
let clock = (role: string) =>
  db.prepare(
    `select o.eid as eid, w.at from wake w
     join entity o on o.id = w.entity
     join deliver dl on dl.entity = w.entity
     where dl."to" = ${idOf} and w.target is null
       and not exists (select 1 from delivered d where d.entity = w.entity)
       and not exists (select 1 from error x where x.entity = w.entity)`,
  ).all(role) as { eid: string; at: string }[]

let roleError = (role: string) =>
  (db.prepare(`select message from error where ${OWNED}`).get(role) as
    | { message: string }
    | undefined)?.message

let sessionsOf = (role: string) =>
  db.prepare(
    `select o.eid as eid, s.status from session s
     join entity o on o.id = s.entity where s.role = ${idOf}`,
  ).all(role) as { eid: string; status: string | null }[]

Deno.test('a scheduled role gets exactly one pending self-wake, idempotently', () => {
  let { role } = seed('every 1h')
  scheduleArm(role, cast)
  scheduleArm(role, cast)
  let rows = clock(role)
  assertEquals(rows.length, 1)
  // The epoch grid: the next whole hour at-or-after now.
  let step = 3_600_000
  assertEquals(
    rows[0].at,
    new Date(Math.ceil(Date.now() / step) * step).toISOString(),
  )
})

Deno.test('a schedule change re-points the one clock', () => {
  let { role } = seed('every 1h')
  scheduleArm(role, cast)
  let before = clock(role)[0]
  db.prepare(`update role set schedule = 'every 2h' where ${OWNED}`).run(role)
  scheduleArm(role, cast)
  let after = clock(role)
  assertEquals(after.length, 1)
  assert(after[0].eid != before.eid || after[0].at == before.at)
})

Deno.test('a role that stops being scheduled sheds its clock', () => {
  let { role } = seed('every 1h')
  scheduleArm(role, cast)
  assertEquals(clock(role).length, 1)
  db.prepare(`update role set wake_policy = 'always' where ${OWNED}`).run(role)
  scheduleArm(role, cast)
  assertEquals(clock(role).length, 0)
})

Deno.test('an unreadable schedule stamps the role and arms nothing', () => {
  let { role } = seed('whenever vibes allow')
  scheduleArm(role, cast)
  assertEquals(clock(role).length, 0)
  assertMatch(String(roleError(role)), /unreadable schedule/)
})

Deno.test('a due row is left for the timer, never swapped mid-fire', () => {
  let { role } = seed('every 1h')
  scheduleArm(role, cast)
  let w = clock(role)[0]
  db.prepare(`update wake set at = ? where ${OWNED}`)
    .run(new Date(Date.now() - 1000).toISOString(), w.eid)
  scheduleArm(role, cast)
  assertEquals(clock(role).map((r) => r.eid), [w.eid])
})

// T-18726 — the acceptance: a due wake on an idle scheduled role STARTS A
// TURN (spawns its managed run), the knock settles without a 'no door'
// error, the cadence re-arms without waiting for settle, and settle
// converges to the same one pending row. The loop runs itself through the
// production wiring: the registrations below mirror server.ts, and arm()
// fires the wake exactly as the one server timer does.
on('knock', {
  created: (_eid, comp) => roleAttention(cast, deps)(String(comp.target)),
})
on('knock', { created: knocked(cast) })
on('knock', { created: (eid) => scheduleKnocked(cast)(eid) })

slow(
  'wake → knock → reconcile → spawn → settle → sleep, for a scheduled role',
  async () => {
    let { role } = seed('every 1h')
    scheduleArm(role, cast)
    let w = clock(role)[0]
    assert(w, 'the clock is armed')
    assertEquals(sessionsOf(role).length, 0)

    // The hour arrives — the row is the clock, so move the row — and the
    // one timer fires it.
    db.prepare(`update wake set at = ? where ${OWNED}`)
      .run(new Date(Date.now() - 1000).toISOString(), w.eid)
    arm(cast)

    // The wake settled delivered, naming its knock.
    let fired = db.prepare(
      `select via from delivered where ${OWNED}`,
    ).get(w.eid) as { via: string } | undefined
    assertMatch(String(fired?.via), /^knock /)

    // The knock aimed at the role settled 'role reconcile' — no rung-4
    // 'no door' error every cadence.
    let k = db.prepare(
      `select o.eid as eid,
         (select via from delivered d where d.entity = k.entity) as via,
         (select message from error x where x.entity = k.entity) as fail
       from knock k join entity o on o.id = k.entity
       where k.target = ${idOf}`,
    ).get(role) as { eid: string; via: string | null; fail: string | null }
    assertEquals(k.fail, null)
    assertEquals(k.via, 'role reconcile')

    // The reconciler served the due cadence: a managed run STARTED for the
    // idle role (the fake provider's session row is the turn).
    await until(() => sessionsOf(role).length == 1)

    // The cadence re-armed off the fired knock — before any settle stamp
    // (T-20075: a run that never settles cannot stall the clock).
    await tick()
    await until(() => clock(role).length == 1)
    let rearmed = clock(role)[0]
    assert(rearmed.eid != w.eid)
    assert(rearmed.at > new Date().toISOString())

    // Settle the run; the settle trigger converges on the same one row.
    let s = sessionsOf(role)[0]
    db.prepare(`update session set status = 'completed' where ${OWNED}`)
      .run(s.eid)
    scheduleSettled(cast)(s.eid, { status: 'completed' })
    assertEquals(clock(role).map((r) => r.eid), [rearmed.eid])

    // Sleep: nothing else spawned, one pending clock, no role error.
    assertEquals(sessionsOf(role).length, 1)
    assertEquals(roleError(role), undefined)
  },
)
