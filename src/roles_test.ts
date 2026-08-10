// Persistent-role reconciliation against an in-memory graph and a fake tmux.
// Native tests exercise idempotence, drift, death, and stop without launching
// a provider; managed tests prove one role session and graph-native stopping.
import { assert, assertEquals, assertMatch } from '@std/assert'
import { type Change } from './types.ts'

Deno.env.set('DB_PATH', ':memory:')
// Pin TERM like DB_PATH and HOME: the launcher passes the ambient terminal
// through unless it is dumb, so an unpinned TERM makes these assertions depend
// on whose shell ran the suite. dumb exercises the documented fallback.
Deno.env.set('TERM', 'dumb')
let tasksHome = Deno.makeTempDirSync({ prefix: 'tasks-roles-home-' })
Deno.env.set('HOME', tasksHome)
Deno.mkdirSync(`${tasksHome}/.deno/bin`, { recursive: true })
Deno.writeTextFileSync(`${tasksHome}/.deno/bin/task`, '')
Deno.chmodSync(`${tasksHome}/.deno/bin/task`, 0o755)

let { apply, db, journalOf } = await import('./db.ts')
let {
  nativeProviderArgs,
  nativeTmuxArgs,
  colorOf,
  looping,
  roleColor,
  roleHash,
  roleRemoved,
  rolesSweep,
  roleTmux,
  starting,
  styleArgs,
  windowOf,
  ventureOf,
} = await import('./roles.ts')

let uid = () => crypto.randomUUID()
let heard: Change[] = []
let cast = (changes: Change[]) => heard.push(...changes)
let dir = Deno.makeTempDirSync({ prefix: 'tasks-role-repo-' })
let sessions = new Set<string>()
let commands: string[][] = []
let files = new Map<string, string>()
let removed = new Set<string>()
let clock = 0
let ok = () => ({
  success: true,
  stdout: new Uint8Array(),
  stderr: new Uint8Array(),
})
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
    if (args[0] == 'new-session') {
      sessions.add(args[args.indexOf('-s') + 1])
      return Promise.resolve({
        ...ok(),
        stdout: new TextEncoder().encode('%99\n'),
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
// other test's role, so a bare new-session count would mix them. The tmux
// session name (`-s`) carries the role eid, so filter on it.
let spawns = (role: string) =>
  commands.filter((a) =>
    a[0] == 'new-session' && a[a.indexOf('-s') + 1] == roleTmux(role)
  ).length

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
  files.clear()
  let { role } = seed('native')
  let name = roleTmux(role)

  await rolesSweep(cast, deps)
  assertEquals(count('new-session'), 1)
  assert(sessions.has(name))
  assertEquals(files.size, 1)
  assert(commands.some((args) => args[0] == 'set-option' && args[1] == '-w'))
  let respawn = commands.find((args) => args[0] == 'respawn-pane')!
  assertEquals(respawn[respawn.indexOf('-t') + 1], '%99')
  assert(respawn.includes(`TASKS_ROLE=${role}`))
  assert(respawn.includes('TERM=xterm-256color'))
  assert(respawn.includes(`${tasksHome}/.deno/bin/task`))
  let first = db.prepare(
    'select applied_hash from role where eid = ?',
  ).get(role) as { applied_hash: string }
  assertEquals(first.applied_hash.length, 64)

  await rolesSweep(cast, deps)
  assertEquals(count('new-session'), 1)
  assertEquals(count('kill-session'), 0)

  apply(db, [{
    eid: role,
    name: 'doc',
    comp: { body: 'A changed role contract.' },
  }])
  await rolesSweep(cast, deps)
  assertEquals(count('kill-session'), 1)
  assertEquals(count('new-session'), 2)

  sessions.delete(name)
  await rolesSweep(cast, deps)
  assertEquals(count('new-session'), 3)

  apply(db, [{
    eid: role,
    name: 'role',
    comp: { state: 'stopped' },
  }])
  await rolesSweep(cast, deps)
  assertEquals(count('kill-session'), 2)
  assert(!sessions.has(name))
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
  assert(!sessions.has(roleTmux(role)))
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
  assert(!sessions.has(roleTmux(role)))
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

Deno.test('managed attention resumes once with no graph content', async () => {
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
  for (let i = 0; i < 400; i++) {
    let status = db.prepare('select status from session where eid = ?').get(
      run.eid,
    ) as { status: string }
    if (status.status == 'completed') break
    await new Promise((go) => setTimeout(go, 5))
  }
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

  // The window carries the venture name, and automatic-rename is off — the
  // one guards the other, so assert them together. With no venture title the
  // tab reads as the id; with one it takes its first word, which is holdco's
  // rule (`title: Trading Desk` → window `Trading`).
  let argv = nativeTmuxArgs(base)
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
  let win = `=${roleTmux(base.eid)}:`
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
  assert(style.every((a) => a.includes(win) || a.includes('%7')))
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

Deno.test('role hash covers instructions and materialized persona text', () => {
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
  }
  assert(roleHash(base) != roleHash({ ...base, body: 'two' }))
  assert(
    roleHash({ ...base, personaText: 'one' }) !=
      roleHash({ ...base, personaText: 'two' }),
  )
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
  db.prepare('update session set finished_at = ? where eid = ?')
    .run(new Date().toISOString(), s) // it died
  await rolesSweep(cast, live)
  assertEquals(spawns(role), 1) // now a relaunch is due
})
