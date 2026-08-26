// The scheduler-as-data invariant (T-18725): one pending self-wake per
// scheduled role, against an in-memory graph.
import { assert, assertEquals, assertMatch } from '@std/assert'
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
let { scheduleArm } = await import('./schedule.ts')

let uid = () => crypto.randomUUID()
let heard: Change[] = []
let cast = (changes: Change[]) => heard.push(...changes)
let dir = Deno.makeTempDirSync({ prefix: 'tasks-schedule-repo-' })

let OWNED = `entity = (select id from entity where eid = ?)`
let idOf = `(select id from entity where eid = ?)`

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
