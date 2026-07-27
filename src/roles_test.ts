// Persistent-role reconciliation against an in-memory graph and a fake tmux.
// Native tests exercise idempotence, drift, death, and stop without launching
// a provider; managed tests prove one role session and graph-native stopping.
import { assert, assertEquals, assertMatch } from '@std/assert'
import { type Change } from './types.ts'

Deno.env.set('DB_PATH', ':memory:')
Deno.env.set('HOME', Deno.makeTempDirSync({ prefix: 'tasks-roles-home-' }))

let { apply, db } = await import('./db.ts')
let {
  nativeProviderArgs,
  roleHash,
  roleRemoved,
  rolesSweep,
  roleTmux,
} = await import('./roles.ts')

let uid = () => crypto.randomUUID()
let heard: Change[] = []
let cast = (changes: Change[]) => heard.push(...changes)
let dir = Deno.makeTempDirSync({ prefix: 'tasks-role-repo-' })
let sessions = new Set<string>()
let commands: string[][] = []
let files = new Map<string, string>()
let clock = 0
let ok = () => ({
  success: true,
  stdout: new Uint8Array(),
  stderr: new Uint8Array(),
})
let deps = {
  now: () => `2026-07-27T00:00:0${clock++}.000Z`,
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
      comp: { state: 'running', surface, scope_eid: project },
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

Deno.test('native role argv carries only fixed bootstrap content', () => {
  let args = nativeProviderArgs(
    { provider: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
    '/tmp/role.md',
  )
  assertEquals(args.slice(0, 5), [
    'task',
    'codex',
    '--operator',
    '--model',
    'gpt-5.6-sol',
  ])
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
  let row = db.prepare('select error from role where eid = ?').get(role) as {
    error: string
  }
  assertMatch(row.error, /native roles require claude or codex/)
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
          stdout: new TextEncoder().encode('codex: bad role config\n'),
        })
      }
      return deps.command(args)
    },
  }
  await rolesSweep(cast, dying)
  assert(!sessions.has(roleTmux(role)))
  assertEquals(
    db.prepare(
      'select applied_hash, error from role where eid = ?',
    ).get(role),
    { applied_hash: null, error: 'Error: codex: bad role config' },
  )
})

Deno.test('managed role mints one operator session and stops through the graph', async () => {
  commands = []
  sessions.clear()
  let { project, role } = seed('managed')
  await rolesSweep(cast, deps)
  await rolesSweep(cast, deps)
  let runs = db.prepare(
    'select * from session where role_eid = ?',
  ).all(role) as Record<string, unknown>[]
  assertEquals(runs.length, 1)
  assertEquals(runs[0].operator, 1)
  assertEquals(runs[0].actor_eid, project)
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
    'select target_eid from stop_request order by rowid desc limit 1',
  ).get()
  assertEquals(stop, { target_eid: runEid })
})

Deno.test('deleting a managed role keeps history and requests a stop', async () => {
  let { role } = seed('managed')
  await rolesSweep(cast, deps)
  let run = db.prepare(
    'select eid from session where role_eid = ? order by rowid desc limit 1',
  ).get(role) as { eid: string }
  db.prepare(
    `update session set origin = 'managed', status = 'running' where eid = ?`,
  ).run(run.eid)
  apply(db, [{ eid: role, name: 'entity', comp: null }])
  await roleRemoved(cast)(role)
  assertEquals(
    db.prepare('select role_eid from session where eid = ?').get(run.eid),
    { role_eid: role },
  )
  assertEquals(
    db.prepare(
      'select target_eid from stop_request order by rowid desc limit 1',
    ).get(),
    { target_eid: run.eid },
  )
})

Deno.test('managed attention resumes once with no graph content', async () => {
  let { role } = seed('managed')
  await rolesSweep(cast, deps)
  let run = db.prepare(
    'select eid, id from session where role_eid = ? order by rowid desc limit 1',
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
      comp: { target_eid: run.eid },
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
