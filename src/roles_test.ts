// Persistent-role reconciliation against an in-memory graph and a fake tmux.
// Native tests exercise idempotence, drift, death, and stop without launching
// a provider; managed tests prove one role session and graph-native stopping.
import { assert, assertEquals, assertMatch } from '@std/assert'
import { slow, until } from './testing.ts'
import { type Change } from './types.ts'

Deno.env.set('DB_PATH', ':memory:')
// Pin TERM like DB_PATH and HOME: the launcher passes the ambient terminal
// through unless it is dumb, so an unpinned TERM makes these assertions depend
// on whose shell ran the suite. dumb exercises the documented fallback.
Deno.env.set('TERM', 'dumb')
// Pin the owner session too — a native role opens its window here (T-14297), so
// leaving it to the ambient HOLDCO_TMUX_SESSION would make the target depend on
// whose shell ran the suite.
Deno.env.set('HOLDCO_TMUX_SESSION', 'owner-test')
let tasksHome = Deno.makeTempDirSync({ prefix: 'tasks-roles-home-' })
Deno.env.set('HOME', tasksHome)
Deno.mkdirSync(`${tasksHome}/.deno/bin`, { recursive: true })
Deno.writeTextFileSync(`${tasksHome}/.deno/bin/task`, '')
Deno.chmodSync(`${tasksHome}/.deno/bin/task`, 0o755)

let { apply, db, journalOf } = await import('./db.ts')
let { append, readEntries } = await import('./entries.ts')
let {
  nativeProviderArgs,
  nativeWindowArgs,
  colorOf,
  looping,
  roleColor,
  roleAttention,
  roleConfig,
  roleSession,
  roleHash,
  roleRemoved,
  rolesSweep,
  ownerSession,
  starting,
  styleArgs,
  windowOf,
  ventureOf,
} = await import('./roles.ts')

let uid = () => crypto.randomUUID()
let heard: Change[] = []
let cast = (changes: Change[]) => heard.push(...changes)
let dir = Deno.makeTempDirSync({ prefix: 'tasks-role-repo-' })
// A fake tmux server: named sessions, and panes keyed by id carrying the @role
// marker the reconciler reads (T-14297). A role's window IS its pane here — one
// pane per role window — so list-panes/kill-pane over the owner session is all
// the reconciler's guard needs to model.
let sessions = new Set<string>()
let panes = new Map<string, { role: string | null; dead: boolean }>()
let nextPane = 99
let commands: string[][] = []
let files = new Map<string, string>()
let removed = new Set<string>()
let clock = 0
let ok = () => ({
  success: true,
  stdout: new Uint8Array(),
  stderr: new Uint8Array(),
})
// The panes a role owns in the owner session — the test's view of the marker.
let panesOf = (role: string) =>
  [...panes].filter(([, p]) => p.role == role).map(([id]) => id)
let killPanesOf = (role: string) => {
  for (let id of panesOf(role)) panes.delete(id)
}
let deps = {
  now: () => `2026-07-27T00:00:0${clock++}.000Z`,
  remove: (path: string) => removed.add(path),
  wait: () => Promise.resolve(),
  write: (path: string, body: string) => files.set(path, body),
  command: (args: string[]) => {
    commands.push(args)
    let target = args[args.indexOf('-t') + 1]?.replace(/^=/, '')
    if (args[0] == 'has-session') {
      return Promise.resolve(
        sessions.has(target) ? ok() : { ...ok(), success: false },
      )
    }
    if (args[0] == 'kill-session') sessions.delete(target)
    if (args[0] == 'new-session') sessions.add(args[args.indexOf('-s') + 1])
    if (args[0] == 'new-window') {
      let id = `%${nextPane++}`
      panes.set(id, { role: null, dead: false })
      return Promise.resolve({
        ...ok(),
        stdout: new TextEncoder().encode(`${id}\n`),
      })
    }
    if (args[0] == 'kill-pane') panes.delete(target)
    if (args[0] == 'set-option' && args.at(-2) == '@role') {
      let p = panes.get(target)
      if (p) p.role = args.at(-1)!
    }
    if (args[0] == 'list-panes') {
      let rows = [...panes].map(([id, p]) =>
        `${p.role ?? ''}\t${id}\t${p.dead ? 1 : 0}`
      ).join('\n')
      return Promise.resolve({
        ...ok(),
        stdout: new TextEncoder().encode(rows),
      })
    }
    if (args[0] == 'display-message') {
      return Promise.resolve({
        ...ok(),
        stdout: new TextEncoder().encode('0\n'),
      })
    }
    return Promise.resolve(ok())
  },
}

let seed = (
  surface: 'native' | 'managed',
  provider = surface == 'native' ? 'codex' : 'fake',
) => {
  let project = uid()
  let role = uid()
  apply(db, [
    { eid: project, name: 'doc', comp: { title: 'Project', body: '' } },
    { eid: project, name: 'project', comp: {} },
    {
      eid: project,
      name: 'repo',
      comp: { path: dir, base_branch: 'main' },
    },
    {
      eid: role,
      name: 'doc',
      comp: { title: 'Coordinator', body: 'Keep the fleet moving.' },
    },
    {
      eid: role,
      name: 'role',
      comp: { state: 'running', surface, scope: project },
    },
    {
      eid: role,
      name: 'spawn',
      comp: {
        provider,
        model: provider == 'codex' ? 'gpt-5.6-sol' : 'fake-fast',
        ...(provider == 'codex' ? { effort: 'high' } : {}),
      },
    },
  ])
  return { project, role }
}

// A UNIFIED operator (D-19459): one project entity IS its own role — role +
// spawn + repo comps sit ON the project, with NO scope column. config() must
// default scope to the entity itself, so actor = role = project = one eid.
let seedUnified = (provider = 'fake') => {
  let project = uid()
  apply(db, [
    { eid: project, name: 'doc', comp: { title: 'Task Graph', body: '' } },
    { eid: project, name: 'project', comp: {} },
    { eid: project, name: 'repo', comp: { path: dir, base_branch: 'main' } },
    // no scope: the role attaches to its own eid
    {
      eid: project,
      name: 'role',
      comp: { state: 'running', surface: 'managed' },
    },
    {
      eid: project,
      name: 'spawn',
      comp: { provider, model: 'fake-fast' },
    },
  ])
  return { project }
}

// Managed launches FOR one role: startManaged mints a session carrying role,
// so counting those rows isolates one role's spawns from the shared db.
let mspawns = (role: string) =>
  (db.prepare('select count(*) as n from session where role = ?').get(role) as {
    n: number
  }).n

let count = (name: string) => commands.filter((args) => args[0] == name).length
let failure = (eid: string) =>
  (db.prepare('select message from error where eid = ?').get(eid) as
    | { message: string }
    | undefined)?.message

// A role run as the graph keeps it, minted straight into the db (no effects,
// so nothing spawns): started `life` ms before it ended, `endAgo` ms before
// now. endAgo null leaves it still booting (no finished_at). Real wall-clock,
// to match the reconciler's real now() in these tests.
let live = { ...deps, now: () => new Date().toISOString() }
let launch = (role: string, endAgo: number | null, life = 1_300) => {
  let e = uid()
  apply(db, [{ eid: e, name: 'session', comp: { id: uid(), role: role } }])
  let t = Date.now()
  db.prepare('update session set started_at = ?, finished_at = ? where eid = ?')
    .run(
      new Date(t - (endAgo ?? 0) - life).toISOString(),
      endAgo == null ? null : new Date(t - endAgo).toISOString(),
      e,
    )
  return e
}

// Spawns FOR one role — the shared db means rolesSweep also reconciles every
// other test's role, so a bare new-window count would mix them. Each launch
// stamps its pane with the role eid (@role), so counting that marker command
// isolates one role's launches from the rest.
let spawns = (role: string) =>
  commands.filter((a) =>
    a[0] == 'set-option' && a.at(-2) == '@role' && a.at(-1) == role
  ).length

slow(
  'role effects leave unrelated entries alone and reconcile their own facts',
  async () => {
    commands = []
    sessions.clear()
    let { project, role } = seed('native')
    let other = seed('native').role
    let task = uid()
    apply(db, [{ eid: task, name: 'task', comp: { project } }])
    let session = uid()
    apply(db, [{ eid: session, name: 'session', comp: { id: uid() } }])
    let entry = append(db, session, [{ message: { role: 'user' } }]).eids[0]
    roleSession(cast, deps)(entry)
    assertEquals(spawns(role), 0)
    assertEquals(spawns(other), 0)

    roleConfig(cast, deps)(role)
    await until(() => spawns(role) == 1, { label: 'the role config effect' })
    assertEquals(spawns(other), 0)

    apply(db, [{ eid: role, name: 'role', comp: { state: 'stopped' } }])
    roleConfig(cast, deps)(role)
    await until(
      () => panesOf(role).length == 0,
      { label: 'the role state effect' },
    )

    apply(db, [{ eid: role, name: 'role', comp: { state: 'running' } }])
    roleAttention(cast, deps)(task)
    await until(() => spawns(role) == 2, { label: 'the role attention effect' })
    apply(db, [
      { eid: role, name: 'entity', comp: null },
      { eid: other, name: 'entity', comp: null },
    ])
    await roleRemoved(cast, deps)(role)
    await roleRemoved(cast, deps)(other)
  },
)

Deno.test('the breaker trips on a burst of stillborn launches, never on a healthy cadence', () => {
  let now = Date.now()
  let dead = (endAgo: number, life = 1_300) => ({
    started_at: new Date(now - endAgo - life).toISOString(),
    finished_at: new Date(now - endAgo).toISOString(),
  })
  // Five launches that each lived ~1.3s, all inside the last minute: a burn.
  let burst = [10, 20, 30, 40, 50].map((s) => dead(s * 1_000))
  assert(looping(burst, now, 0))
  // Four is below the threshold.
  assert(!looping(burst.slice(1), now, 0))
  // A healthy cadence — each lived nine minutes, ten minutes apart — never.
  let healthy = [0, 1, 2, 3, 4].map((i) => dead(i * 600_000, 540_000))
  assert(!looping(healthy, now, 0))
  // The retry fence excludes deaths before it, so a fixed role won't re-trip.
  assert(!looping(burst, now, now - 5_000))
  // Deaths older than the window don't count.
  assert(
    !looping(
      [10, 20, 30, 40, 50].map((s) => dead(s * 1_000 + 400_000)),
      now,
      0,
    ),
  )
})

Deno.test('starting holds a still-booting run and frees a finished or wedged one', () => {
  let now = Date.now()
  let booting = {
    started_at: new Date(now - 30_000).toISOString(),
    finished_at: null,
  }
  assert(starting(booting, now)) // no racer for a run still coming up
  assert(
    !starting({ ...booting, finished_at: new Date(now).toISOString() }, now),
  ) // dead
  // Past the grace cap a run with no finished_at is treated as wedged, freed.
  assert(
    !starting({
      started_at: new Date(now - 700_000).toISOString(),
      finished_at: null,
    }, now),
  )
  assert(!starting(undefined, now)) // no run at all is not starting
})

Deno.test('native role argv carries only fixed bootstrap content', () => {
  let args = nativeProviderArgs(
    { provider: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
    '/tmp/role.md',
  )
  assertEquals(args.slice(0, 4), [
    'task',
    'codex',
    '--model',
    'gpt-5.6-sol',
  ])
  assert(!args.includes('--operator'))
  assert(args.includes('model_reasoning_effort="high"'))
  assert(args.includes('model_instructions_file="/tmp/role.md"'))
  assert(!args.join(' ').includes('Keep the fleet moving'))
  assertMatch(args.at(-1)!, /Call task_context now/)
})

Deno.test('native role dedupes, rolls drift, heals death, and stops exactly', async () => {
  commands = []
  sessions.clear()
  panes.clear()
  files.clear()
  let { role } = seed('native')

  // First launch: the owner session is created once, the role opens ONE window
  // in it, and its pane is marked with the role eid.
  await rolesSweep(cast, deps)
  assertEquals(count('new-window'), 1)
  assert(sessions.has(ownerSession()))
  assertEquals(panesOf(role).length, 1)
  let pane = panesOf(role)[0]
  assertEquals(files.size, 1)
  assert(commands.some((args) => args[0] == 'set-option' && args[1] == '-w'))
  let respawn = commands.find((args) =>
    args[0] == 'respawn-pane' && args[args.indexOf('-t') + 1] == pane
  )!
  assert(respawn)
  assert(respawn.includes(`TASKS_ROLE=${role}`))
  assert(respawn.includes('TERM=xterm-256color'))
  assert(respawn.includes(`${tasksHome}/.deno/bin/task`))
  let first = db.prepare(
    'select applied_hash from role where eid = ?',
  ).get(role) as { applied_hash: string }
  assertEquals(first.applied_hash.length, 64)

  // Idempotent: a matching pane is adopted, no second window, no kill.
  await rolesSweep(cast, deps)
  assertEquals(count('new-window'), 1)
  assertEquals(count('kill-pane'), 0)

  // Drift rolls the pane: kill the old, open a new window.
  apply(db, [{
    eid: role,
    name: 'doc',
    comp: { body: 'A changed role contract.' },
  }])
  await rolesSweep(cast, deps)
  assertEquals(count('kill-pane'), 1)
  assertEquals(count('new-window'), 2)

  // Death heals: the pane vanished, so the next sweep relaunches.
  killPanesOf(role)
  await rolesSweep(cast, deps)
  assertEquals(count('new-window'), 3)

  apply(db, [{
    eid: role,
    name: 'role',
    comp: { state: 'stopped' },
  }])
  await rolesSweep(cast, deps)
  assertEquals(count('kill-pane'), 2)
  assertEquals(panesOf(role).length, 0)
  let stopped = db.prepare(
    'select applied_hash, stopped_at from role where eid = ?',
  ).get(role) as { applied_hash: string | null; stopped_at: string | null }
  assertEquals(stopped.applied_hash, null)
  assert(stopped.stopped_at)
  let at = stopped.stopped_at
  await rolesSweep(cast, deps)
  assertEquals(
    db.prepare('select stopped_at from role where eid = ?').get(role),
    { stopped_at: at },
  )
})

Deno.test('paused disabled and retired roles stay down with a receipt', async () => {
  for (let state of ['paused', 'disabled', 'retired']) {
    commands = []
    sessions.clear()
    let { role } = seed('native')
    apply(db, [{ eid: role, name: 'role', comp: { state } }])
    await rolesSweep(cast, deps)
    assertEquals(spawns(role), 0)
    assertEquals(
      db.prepare(
        'select decision, reason from role where eid = ?',
      ).get(role),
      { decision: 'stop', reason: 'desired state is not running' },
    )
  }
})

Deno.test('invalid native drift closes the stale door and stamps the cause', async () => {
  commands = []
  sessions.clear()
  let { role } = seed('native')
  await rolesSweep(cast, deps)
  apply(db, [{
    eid: role,
    name: 'spawn',
    comp: { provider: 'fake', model: 'fake-fast', effort: null },
  }])
  await rolesSweep(cast, deps)
  assertEquals(panesOf(role).length, 0)
  assertMatch(failure(role) ?? '', /native roles require claude or codex/)
})

Deno.test('an early-dead native provider is captured, not marked applied', async () => {
  commands = []
  sessions.clear()
  let { role } = seed('native')
  let dying = {
    ...deps,
    command: (args: string[]) => {
      if (args[0] == 'display-message') {
        return Promise.resolve({
          ...ok(),
          stdout: new TextEncoder().encode('1\n'),
        })
      }
      if (args[0] == 'capture-pane') {
        return Promise.resolve({
          ...ok(),
          stdout: new TextEncoder().encode(
            args.includes('-a')
              ? 'codex: bad role config\n'
              : 'Pane is dead (status 1)\n',
          ),
        })
      }
      return deps.command(args)
    },
  }
  await rolesSweep(cast, dying)
  assertEquals(panesOf(role).length, 0)
  assertEquals(
    db.prepare('select applied_hash from role where eid = ?').get(role),
    { applied_hash: null },
  )
  assertEquals(
    failure(role),
    'Error: Pane is dead (status 1)\ncodex: bad role config',
  )
})

Deno.test('managed role mints one operator session and stops through the graph', async () => {
  commands = []
  sessions.clear()
  let { project, role } = seed('managed')
  await rolesSweep(cast, deps)
  await rolesSweep(cast, deps)
  let runs = db.prepare(
    'select * from session where role = ?',
  ).all(role) as Record<string, unknown>[]
  assertEquals(runs.length, 1)
  assertEquals(runs[0].operator, 1)
  assertEquals(runs[0].actor, project)
  let runEid = String(runs[0].eid)
  assertEquals(
    db.prepare('select provider from spawn where eid = ?').get(runEid),
    { provider: 'fake' },
  )

  db.prepare(
    `update session set origin = 'managed', status = 'running' where eid = ?`,
  ).run(runEid)
  apply(db, [{
    eid: role,
    name: 'role',
    comp: { state: 'stopped' },
  }])
  await rolesSweep(cast, deps)
  let stop = db.prepare(
    'select target from stop_request order by rowid desc limit 1',
  ).get()
  assertEquals(stop, { target: runEid })
})

Deno.test('a role comp on a project is its own operator: scope defaults to self, actor = the project', async () => {
  commands = []
  sessions.clear()
  let { project } = seedUnified()
  // The reconciler enumerates by the role COMPONENT (select eid from role), so
  // a role comp on a project eid is picked up with no enumeration change.
  await rolesSweep(cast, deps)
  await rolesSweep(cast, deps)
  let runs = db.prepare(
    'select * from session where role = ?',
  ).all(project) as Record<string, unknown>[]
  // config() succeeded (no "role has no scope" throw) and startManaged minted
  // exactly one operator whose actor is the project itself — one entity.
  assertEquals(runs.length, 1)
  assertEquals(runs[0].operator, 1)
  assertEquals(runs[0].role, project)
  assertEquals(runs[0].actor, project)
})

// Explicit scope on a standalone role entity is still honored unchanged: the
// managed test above (actor == the separate project) is that escape hatch.

// The migration path for unifying a live operator (P-19 + standalone R-14210 →
// P-19 alone), proven REVERSIBLE here so the operator can run it deliberately.
//
// Two invariants shape it:
//   - Retire = strip the standalone role's `role`+`spawn` comps, NEVER tombstone
//     the entity: a tombstoned eid can't be resurrected, and the standalone
//     doc/comments/history must survive so the flip can be reversed.
//   - `session.role → role` is a referential guard (db.ts): a role's comps
//     cannot be stripped while a live session still points at it. So each
//     direction STOPS the operator session first (the D-19459 `task role cycle`
//     gesture), then moves the comps. The operator runs these as graph_apply
//     batches; this task does not touch the live db.
let enumerated = () =>
  (db.prepare('select eid from role order by eid').all() as { eid: string }[])
    .map((r) => r.eid)
let stop = (role: string) => {
  for (
    let s of db.prepare('select eid from session where role = ?').all(role) as {
      eid: string
    }[]
  ) apply(db, [{ eid: s.eid, name: 'entity', comp: null }])
}

Deno.test('unify migration is reversible: comps move onto the project and back, entity never tombstoned', async () => {
  commands = []
  sessions.clear()
  let { project, role } = seed('managed')
  await rolesSweep(cast, deps) // the standalone role is the live operator
  assert(enumerated().includes(role))
  assert(!enumerated().includes(project))
  assertEquals(
    (db.prepare('select count(*) as n from session where role = ?').get(
      role,
    ) as { n: number }).n,
    1,
  )

  // FORWARD: stop the operator session, then move role+spawn onto the project
  // (scope OMITTED → defaults to self) and strip the standalone. Its entity and
  // doc stay put — nothing is tombstoned.
  stop(role)
  apply(db, [
    {
      eid: project,
      name: 'role',
      comp: { state: 'running', surface: 'managed', wake_policy: 'always' },
    },
    {
      eid: project,
      name: 'spawn',
      comp: { provider: 'fake', model: 'fake-fast' },
    },
    { eid: role, name: 'role', comp: null },
    { eid: role, name: 'spawn', comp: null },
  ])
  assert(enumerated().includes(project))
  assert(!enumerated().includes(role)) // no longer a role, but NOT tombstoned
  assert(db.prepare('select eid from doc where eid = ?').get(role)) // doc lives
  await rolesSweep(cast, deps)
  await rolesSweep(cast, deps)
  let unified = db.prepare('select actor from session where role = ?')
    .all(project) as { actor: string }[]
  assertEquals(unified.length, 1)
  assertEquals(unified[0].actor, project) // actor = role = project, one entity

  // REVERSE: stop the unified operator, restore the standalone (scope back to
  // the project), strip the project. The reversal is exact.
  stop(project)
  apply(db, [
    {
      eid: role,
      name: 'role',
      comp: {
        state: 'running',
        surface: 'managed',
        scope: project,
        wake_policy: 'always',
      },
    },
    {
      eid: role,
      name: 'spawn',
      comp: { provider: 'fake', model: 'fake-fast' },
    },
    { eid: project, name: 'role', comp: null },
    { eid: project, name: 'spawn', comp: null },
  ])
  assert(enumerated().includes(role))
  assert(!enumerated().includes(project))
  await rolesSweep(cast, deps)
  assertEquals(
    (db.prepare('select actor from session where role = ?').get(role) as {
      actor: string
    }).actor,
    project, // standalone operator restored, actor = its explicit scope again
  )
})

Deno.test('deleting a managed role keeps history and requests a stop', async () => {
  let { role } = seed('managed')
  await rolesSweep(cast, deps)
  let run = db.prepare(
    'select eid from session where role = ? order by rowid desc limit 1',
  ).get(role) as { eid: string }
  db.prepare(
    `update session set origin = 'managed', status = 'running' where eid = ?`,
  ).run(run.eid)
  apply(db, [{ eid: role, name: 'entity', comp: null }])
  await roleRemoved(cast, deps)(role)
  assertEquals(
    db.prepare('select role from session where eid = ?').get(run.eid),
    { role: role },
  )
  assertEquals(
    db.prepare(
      'select target from stop_request order by rowid desc limit 1',
    ).get(),
    { target: run.eid },
  )
  assert(removed.has(`${tasksHome}/.tasks/roles/${role}`))
})

slow('managed attention resumes once with no graph content', async () => {
  let { role } = seed('managed')
  await rolesSweep(cast, deps)
  let run = db.prepare(
    'select eid, id from session where role = ? order by rowid desc limit 1',
  ).get(role) as { eid: string; id: string }
  db.prepare(`
    update session set origin = 'managed', status = 'completed',
      provider_session_id = 'fake-thread', cwd = ?, finished_at = ?
    where eid = ?
  `).run(dir, new Date().toISOString(), run.eid)
  let message = uid()
  apply(db, [
    {
      eid: message,
      name: 'doc',
      comp: { title: '', body: 'SECRET GRAPH WORDS' },
    },
    {
      eid: message,
      name: 'comment',
      comp: { target: run.eid },
    },
  ])
  let wakeDeps = { ...deps, now: () => new Date().toISOString() }
  await rolesSweep(cast, wakeDeps)
  await until(
    () =>
      (db.prepare('select status from session where eid = ?').get(
        run.eid,
      ) as { status: string }).status == 'completed',
    { label: 'the native role session to complete' },
  )
  assertEquals(
    db.prepare('select status from session where eid = ?').get(run.eid),
    { status: 'completed' },
  )
  let path = `${Deno.env.get('HOME')}/.tasks/logs/${run.eid}.jsonl`
  let text = Deno.readTextFileSync(path)
  assertMatch(text, /You have pending Tasks messages\. Call task_context now\./)
  assert(!text.includes('SECRET GRAPH WORDS'))
  assertEquals(
    db.prepare('select 1 from notified where eid = ?').get(message),
    undefined,
  )
  let inputs = text.match(/"type":"session.input"/g)?.length
  await rolesSweep(cast, wakeDeps)
  assertEquals(
    Deno.readTextFileSync(path).match(/"type":"session.input"/g)?.length,
    inputs,
  )
})

// ---- wake_policy actuation (D-18722 part A) ----

// A settled, resumable managed session for `role` — the durable idle door a
// previous turn left behind, so the non-pinning policies have something to
// advance (or deliberately leave alone) without a live spawn.
let settled = (role: string, project: string) => {
  let run = uid()
  apply(db, [{
    eid: run,
    name: 'session',
    comp: { id: uid(), role, actor: project, operator: 1 },
  }])
  db.prepare(`
    update session set origin = 'managed', status = 'completed',
      provider_session_id = 'fake-thread', cwd = ?, finished_at = ?
    where eid = ?
  `).run(dir, new Date().toISOString(), run)
  return run
}

// Attention aimed at `target`: a comment on the scope reaches its operator
// loop, a comment on a session reaches that session directly.
let ping = (target: string, body = 'ping') => {
  let msg = uid()
  apply(db, [
    { eid: msg, name: 'doc', comp: { title: '', body } },
    { eid: msg, name: 'comment', comp: { target } },
  ])
  return msg
}

Deno.test('wake_policy always pins proactively, and unset defaults to always (inert migration)', async () => {
  let { role: pinned } = seed('managed')
  apply(db, [{ eid: pinned, name: 'role', comp: { wake_policy: 'always' } }])
  let { role: dflt } = seed('managed') // no wake_policy → defaults to always
  await rolesSweep(cast, deps)
  // Both PIN: a managed session is spawned with NO pending attention — the
  // keep-alive door. Explicit `always` and unset behave identically, so every
  // migrated role is inert.
  assertEquals(mspawns(pinned), 1)
  assertEquals(mspawns(dflt), 1)
})

Deno.test('wake_policy attention does not pin: no session while the scope is idle', async () => {
  let { role } = seed('managed')
  apply(db, [{ eid: role, name: 'role', comp: { wake_policy: 'attention' } }])
  await rolesSweep(cast, deps)
  assertEquals(mspawns(role), 0) // no keep-alive door burns while idle
})

Deno.test('wake_policy attention cold-spawns on pending scope attention, then sleeps', async () => {
  let { project, role } = seed('managed')
  apply(db, [{ eid: role, name: 'role', comp: { wake_policy: 'attention' } }])
  let msg = ping(project)
  await rolesSweep(cast, deps)
  assertEquals(mspawns(role), 1) // spawned on the trigger, not before

  // The fresh session consumes the attention (what task_context's serve does),
  // so the trigger clears and the role sleeps: no second spawn.
  let run = db.prepare(
    'select eid from session where role = ? order by rowid desc limit 1',
  ).get(role) as { eid: string }
  db.prepare(`
    update session set origin = 'managed', status = 'completed',
      provider_session_id = 't', cwd = ?, finished_at = ? where eid = ?
  `).run(dir, new Date().toISOString(), run.eid)
  apply(db, [{ eid: msg, name: 'notified', comp: {} }])
  await rolesSweep(cast, { ...deps, now: () => new Date().toISOString() })
  assertEquals(mspawns(role), 1) // asleep — nothing pending
})

Deno.test('wake_policy attention advances an existing settled session when attention lands', async () => {
  let { project, role } = seed('managed')
  apply(db, [{ eid: role, name: 'role', comp: { wake_policy: 'attention' } }])
  await rolesSweep(cast, deps)
  assertEquals(mspawns(role), 0) // idle: no pin

  let run = settled(role, project)
  ping(run) // a notice straight at the session
  await rolesSweep(cast, { ...deps, now: () => new Date().toISOString() })
  // Advanced in place, not re-spawned: the same door got the wake stamp.
  assertEquals(mspawns(role), 1)
  let woken = db.prepare('select notice_at from session where eid = ?').get(
    run,
  ) as { notice_at: string | null }
  assert(woken.notice_at)
})

Deno.test('wake_policy scheduled does not pin and cold-spawns on pending attention', async () => {
  let { project, role } = seed('managed')
  apply(db, [{ eid: role, name: 'role', comp: { wake_policy: 'scheduled' } }])
  await rolesSweep(cast, deps)
  assertEquals(mspawns(role), 0) // no pin while idle (cadence is T-18725)
  ping(project)
  await rolesSweep(cast, deps)
  assertEquals(mspawns(role), 1) // attention-while-awake still wakes it
})

Deno.test('wake_policy manual never auto-wakes: no cold spawn, no advance, no teardown', async () => {
  let { project, role } = seed('managed')
  apply(db, [{ eid: role, name: 'role', comp: { wake_policy: 'manual' } }])
  ping(project) // attention that WOULD wake an `attention` role
  await rolesSweep(cast, deps)
  assertEquals(mspawns(role), 0) // no automatic trigger

  // Even with a settled door and a direct notice, manual advances nothing —
  // but it does not tear the session down the way `stopped` would.
  let run = settled(role, project)
  ping(run)
  await rolesSweep(cast, { ...deps, now: () => new Date().toISOString() })
  let s = db.prepare(
    'select status, notice_at from session where eid = ?',
  ).get(run) as { status: string; notice_at: string | null }
  assertEquals(s.notice_at, null) // not advanced
  assertEquals(s.status, 'completed') // not stopped
})

Deno.test('a native role refuses a non-always wake_policy with a durable error', async () => {
  commands = []
  sessions.clear()
  let { role } = seed('native')
  apply(db, [{ eid: role, name: 'role', comp: { wake_policy: 'attention' } }])
  await rolesSweep(cast, deps)
  assertEquals(panesOf(role).length, 0)
  assertMatch(failure(role) ?? '', /native roles are pinned/)
})

Deno.test('graph-native role attention is content-free and coalesced', async () => {
  let { role } = seed('managed', 'codex')
  let runner = uid()
  apply(db, [{ eid: runner, name: 'runner', comp: { name: 'tasksd' } }])
  await rolesSweep(cast, deps)
  let run = db.prepare(
    'select eid from session where role = ? order by rowid desc limit 1',
  ).get(role) as { eid: string }
  db.prepare("update session set origin = 'managed' where eid = ?")
    .run(run.eid)
  let input = append(db, run.eid, [{ message: { role: 'user' } }]).eids[0]
  let generation = append(db, run.eid, [{
    generation: {
      through: input,
      provider: 'codex',
      model: 'gpt-5.6-sol',
    },
  }]).eids[0]
  db.prepare(
    "insert into delivered (eid, at, via) values (?, datetime('now'), 'test')",
  ).run(generation)
  let message = uid()
  apply(db, [
    {
      eid: message,
      name: 'doc',
      comp: { title: '', body: 'SECRET ROLE WORDS' },
    },
    { eid: message, name: 'comment', comp: { target: run.eid } },
  ])

  await rolesSweep(cast, { ...deps, now: () => new Date().toISOString() })
  await rolesSweep(cast, { ...deps, now: () => new Date().toISOString() })
  let entries = readEntries(db, run.eid)
  assertEquals(entries.filter((row) => row.comps.attention).length, 1)
  assertEquals(
    entries.some((row) => row.comps.content?.body == 'SECRET ROLE WORDS'),
    false,
  )
  assertEquals(
    db.prepare('select 1 from notified where eid = ?').get(message),
    undefined,
  )
  let wake = entries.find((row) => row.comps.attention)!
  assertEquals(journalOf(db, wake.eid)[0].via, runner)
})

// The colour must be a pure function of the VENTURE, matching holdco's own
// palette and hash (lib/fleet/operators.js). holdco is adopting roles, and a
// venture whose window changes colour depending on which orchestrator started
// it is exactly the seam an owner notices.
Deno.test('role window styling matches holdco, keyed on the venture', () => {
  let base = {
    eid: uid(),
    state: 'running',
    surface: 'native',
    scope: uid(),
    title: 'Trading Role',
    body: '',
    repo: { path: '/home/yaks/code/trading', base_branch: 'main' },
    provider: 'codex',
    model: 'gpt-5.6-sol',
  }
  // The venture id is the repo's directory name, not the role's title or eid.
  assertEquals(ventureOf(base), 'trading')
  assertEquals(ventureOf({ ...base, title: 'Something Else' }), 'trading')

  // holdco's exact hash: sum of char codes, modulo a 20-colour palette.
  let holdco = (name: string) =>
    [
      'red',
      'green',
      'yellow',
      'blue',
      'magenta',
      'cyan',
      'brightred',
      'brightgreen',
      'brightyellow',
      'brightblue',
      'brightmagenta',
      'brightcyan',
      'colour203',
      'colour214',
      'colour220',
      'colour135',
      'colour45',
      'colour171',
      'colour111',
      'colour208',
    ][[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % 20]
  for (let v of ['trading', 'tasks', 'ufos', 'crayonbloom', 'bindery']) {
    assertEquals(roleColor(v), holdco(v), `${v} must match holdco`)
  }

  // A native role opens a WINDOW in the owner session (T-14297): new-window
  // targeting that session, carrying the venture name, and automatic-rename is
  // off — the name guards the tab, so assert them together. With no venture
  // title the tab reads as the id; with one it takes its first word, which is
  // holdco's rule (`title: Trading Desk` → window `Trading`).
  let argv = nativeWindowArgs(base)
  assertEquals(argv[0], 'new-window')
  assertEquals(argv[argv.indexOf('-t') + 1], `=${ownerSession()}`)
  assertEquals(argv[argv.indexOf('-n') + 1], 'trading')
  assertEquals(windowOf(base), 'trading')
  assertEquals(windowOf({ ...base, venture: 'Trading Desk' }), 'Trading')
  assertEquals(windowOf({ ...base, venture: '  ' }), 'trading')
  // Retitling a venture must NOT move its colour — the hash stays on the id.
  assertEquals(
    roleColor(ventureOf({ ...base, venture: 'Trading Desk' })),
    roleColor('trading'),
  )

  // The hash is a DEFAULT, not a policy: an owner-set project.color wins.
  // It has to — twenty ventures over twenty colours collide, and trading and
  // ufos already hash to the same cyan with no other way to break the tie.
  assertEquals(roleColor('trading'), roleColor('ufos'))
  assertEquals(colorOf(base), roleColor('trading'))
  assertEquals(colorOf({ ...base, color: 'colour208' }), 'colour208')
  assertEquals(colorOf({ ...base, color: '#5fafd7' }), '#5fafd7')
  // Blank or whitespace is "unset", not a colour named ''.
  assertEquals(colorOf({ ...base, color: '   ' }), roleColor('trading'))
  assertEquals(colorOf({ ...base, color: '' }), roleColor('trading'))
  // And the configured value is what actually reaches tmux.
  let set = styleArgs({ ...base, color: 'colour208' }, '%7')
    .find((a) => a[3] == 'window-status-style')!
  assertEquals(set.at(-1), 'fg=colour208')

  let style = styleArgs(base, '%7')
  let colour = roleColor('trading')
  assertEquals(
    style.filter((a) => a[0] == 'set-window-option').map((a) => a.slice(3)),
    [
      ['automatic-rename', 'off'],
      ['window-status-format', ' #W#{?window_bell_flag, !,} '],
      ['window-status-current-format', ' #W#{?window_bell_flag, !,} '],
      ['window-status-style', `fg=${colour}`],
      ['window-status-current-style', `fg=${colour},reverse`],
    ],
  )
  // Every command targets the PANE — a pane id resolves to its window for the
  // window-scoped options, so nothing needs a window name to target (T-14297).
  assert(style.every((a) => a.includes('%7')))
  // `@operator` is what holdco's tooling reads to find a live operator pane.
  assertEquals(style.at(-2), [
    'set-option',
    '-p',
    '-t',
    '%7',
    '@operator',
    'trading',
  ])
  assertEquals(style.at(-1), [
    'select-pane',
    '-t',
    '%7',
    '-T',
    'trading operator',
  ])
})

Deno.test('role hash covers stable config, not warmth-ranked persona text', () => {
  let base = {
    eid: uid(),
    state: 'running',
    surface: 'native',
    scope: uid(),
    title: 'Role',
    body: 'one',
    repo: { path: '/tmp/repo', base_branch: 'main' },
    provider: 'codex',
    model: 'gpt-5.6-sol',
    persona: uid(),
  }
  // Genuine, restart-worthy config still moves the hash.
  assert(roleHash(base) != roleHash({ ...base, body: 'two' }))
  assert(roleHash(base) != roleHash({ ...base, model: 'gpt-5.6-pro' }))
  assert(roleHash(base) != roleHash({ ...base, persona: uid() }))
  // personaText is materialized with recall-warmth ranking that DECAYS with the
  // clock; if it fed the hash an unchanged graph would flap it and churn the
  // operator (T-19381). It must NOT change the hash — present, absent, or
  // reordered all hash identically.
  assertEquals(
    roleHash({ ...base, personaText: 'one' }),
    roleHash({ ...base, personaText: 'two' }),
  )
  assertEquals(roleHash(base), roleHash({ ...base, personaText: 'anything' }))
})

// Integration tests LAST: rolesSweep reconciles every role in the shared db,
// so these leave running roles behind — running them after the count-based
// 'dedupes' test keeps that test's sweep to its own role. `spawns(role)`
// isolates each assertion to its own tmux session.
Deno.test('a crash-looping native role is held after N deaths, stops spawning, and a start revives it', async () => {
  commands = []
  sessions.clear()
  let { role } = seed('native')
  for (let i = 0; i < 5; i++) launch(role, (i + 1) * 5_000)
  await rolesSweep(cast, live)
  let held = db.prepare('select state from role where eid = ?').get(role) as {
    state: string
  }
  assertEquals(held.state, 'held')
  assertMatch(failure(role) ?? '', /crash-loop/)
  let trip = journalOf(db, role).find((entry) =>
    entry.changes.some((c) => c.name == 'role' && c.comp?.state == 'held')
  )
  assert(trip?.changes.some((c) => c.name == 'error'))
  assertEquals(spawns(role), 0) // never spawned into the burn
  // Bounded: a held role never comes back on its own.
  await rolesSweep(cast, live)
  assertEquals(spawns(role), 0)
  // An owner start fences the breaker; the stale burst no longer counts.
  apply(db, [{
    eid: role,
    name: 'role',
    comp: { state: 'running', retry_at: new Date().toISOString() },
  }])
  await rolesSweep(cast, live)
  assertEquals(db.prepare('select state from role where eid = ?').get(role), {
    state: 'running',
  })
  assertEquals(failure(role), undefined)
  assertEquals(spawns(role), 1) // the fenced retry launches once
})

Deno.test('a still-starting native run gets no second spawn; a dead one is relaunched', async () => {
  commands = []
  sessions.clear()
  let { role } = seed('native')
  let s = launch(role, null, 30_000) // started 30s ago, no finished_at
  await rolesSweep(cast, live)
  assertEquals(spawns(role), 0) // idempotent: no racer for a booting run
  assertEquals(
    db.prepare('select decision, observed from role where eid = ?').get(role),
    { decision: 'refuse duplicate', observed: s },
  )
  db.prepare('update session set finished_at = ? where eid = ?')
    .run(new Date().toISOString(), s) // it died
  await rolesSweep(cast, live)
  assertEquals(spawns(role), 1) // now a relaunch is due
})

// The T-19381 churn: config drift under a LIVE operator must never tear the
// pane down. A live native operator self-reifies its own session (role set, a
// pid, no finished_at) — so active() is true — and once it is past the boot
// grace it reaches reconcileNative, where a mere hash mismatch used to kill and
// cold-restart it. It must defer, and the deferred config must land on the
// operator's NEXT natural restart, not before.
Deno.test('config drift defers under a live native operator, lands on restart', async () => {
  commands = []
  sessions.clear()
  panes.clear()
  let { role } = seed('native')
  await rolesSweep(cast, live)
  let pane0 = panesOf(role)[0]
  assert(pane0) // launched once

  // The live operator's own session: role-linked, a pid, no finished_at, and
  // booted well past the idempotency grace so the reconciler treats it as live
  // rather than still-starting.
  let s = uid()
  apply(db, [{ eid: s, name: 'session', comp: { id: uid(), role } }])
  db.prepare(
    'update session set pid = 4242, started_at = ?, finished_at = null where eid = ?',
  ).run(new Date(Date.now() - 900_000).toISOString(), s)

  // A genuine, hash-affecting config change (the role's contract body).
  apply(db, [{ eid: role, name: 'doc', comp: { body: 'A changed contract.' } }])
  await rolesSweep(cast, live)
  assertEquals(panesOf(role), [pane0]) // the healthy pane SURVIVES — no kill
  let after = db.prepare(
    'select decision, reason from role where eid = ?',
  ).get(role) as { decision: string; reason: string }
  assertEquals(after.decision, 'defer')
  assertMatch(after.reason, /config changed \(body\)/) // names the diffed field

  // The operator's process exits; the deferred config lands on the relaunch.
  db.prepare('update session set finished_at = ? where eid = ?')
    .run(new Date().toISOString(), s)
  await rolesSweep(cast, live)
  let now = panesOf(role)
  assertEquals(now.length, 1)
  assert(now[0] != pane0) // rolled to a fresh pane carrying the new config
})
