// The managed-session lifecycle against a :memory: db, a temp log dir, and
// a scratch git repo — driven the way production drives it: graph writes
// dispatched through the effect registry. A session created with a
// provider spawns, a stop_request stops, a comment resumes, a delete
// kills; the fake provider does the running. Real children only where
// only a real child will do — everything else is written to the log file
// the tailer reads, because that file IS the log.
// Static imports for the two that hold no db handle (assert must be static:
// an assertion function only narrows when it's declared, not destructured);
// db.ts and sessions.ts come in dynamically, AFTER the env below points them
// at :memory: and the temp dirs.
import { assert, assertEquals, assertMatch, assertThrows } from '@std/assert'
import { existsSync } from 'node:fs'
import { type Change } from './types.ts'
import { dispatch, on, relay, trace } from './effects.ts'
import { PENDING } from './deliver.ts'
import { fakeClaude, fakeCodex } from './door_fake.ts'

Deno.env.set('DB_PATH', ':memory:')
let tmp = Deno.makeTempDirSync({ prefix: 'tasks-sessions-' })
Deno.env.set('LOGS_DIR', `${tmp}/logs`)
Deno.env.set('WORKTREES_DIR', `${tmp}/worktrees`)
Deno.env.set('POLL_MS', '10') // tests wait on facts, never on the clock
Deno.env.set('STOP_GRACE_MS', '1000')

let { apply, db, delta, snapshot } = await import('./db.ts')
let { noticesFor } = await import('./client.ts')
let {
  childPath,
  commented,
  continueSession,
  deleted,
  logs,
  logsDir,
  recover,
  running,
  spawned,
  stopped,
  tidy,
  watched,
} = await import('./sessions.ts')

let uid = () => crypto.randomUUID()
let heard: Change[] = []
let cast = (c: Change[]) => heard.push(...c)
let row = (eid: string) =>
  db.prepare('select * from session where eid = ?').get(eid) as
    | Record<string, string | number | null>
    | undefined
let spawnRow = (eid: string) =>
  db.prepare('select * from spawn where eid = ?').get(eid) as
    | Record<string, string | number | null>
    | undefined

// The same curated list server.ts registers — the tests drive the wire.
on('session', { created: spawned(cast), removed: deleted })
on('stop_request', {
  created: stopped(cast),
  sweep: { pending: PENDING('stop_request') },
})
on('comment', { created: commented(cast) })

// The relay's row fetch, as server.ts performs it at boot.
let pending = (comp: string, cond: string) =>
  db.prepare(`select * from ${comp} where ${cond}`).all() as Record<
    string,
    unknown
  >[]
// A stop_request settles into the shared delivered facet now (D-14945).
let acted = (sr: string) =>
  (db.prepare('select at from delivered where eid = ?').get(sr) as
    | { at: string | null }
    | undefined)?.at ?? null

// A graph write as the server performs it: apply, cast, dispatch. The
// returned promise is every effect the batch set off — a whole run, when
// the batch was a spawn.
let write = (changes: Change[], via?: string) => {
  let t = trace()
  let out = apply(db, changes, t, via)
  cast(out)
  return dispatch(out, t)
}

// A scratch checkout — the only place a session is ever allowed to run.
let scratch = (() => {
  let dir = Deno.makeTempDirSync({ prefix: 'tasks-repo-' })
  let git = (...args: string[]) =>
    new Deno.Command('git', { args, cwd: dir, stdout: 'null', stderr: 'null' })
      .outputSync()
  git('init', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  Deno.writeTextFileSync(`${dir}/README.md`, 'scratch')
  git('add', '-A')
  git('commit', '-m', 'init')
  return dir
})()

// project(+repo) → task: the graph a spawn reads its workspace from.
let seed = (body = '', repo: string | null = scratch) => {
  let p = uid(), t = uid()
  apply(db, [
    { eid: p, name: 'doc', comp: { title: 'Scratch project' } },
    { eid: p, name: 'project', comp: {} },
    ...(repo ? [{ eid: p, name: 'repo', comp: { path: repo } }] : []),
    { eid: t, name: 'doc', comp: { title: 'Do the thing', body } },
    { eid: t, name: 'task', comp: { status: 'open', project_eid: p } },
  ])
  return { p, t }
}

// The spawn request, as any client writes it: one session change carrying
// the request columns. `extra` overrides for the refusal cases.
let begin = (
  task: string,
  extra: Record<string, unknown> = {},
  via?: string,
) => {
  let eid = uid()
  let done = write([{
    eid,
    name: 'session',
    comp: {
      id: uid(),
      provider: 'fake',
      model: 'fake-fast',
      requested_task_eid: task,
      ...extra,
    },
  }], via)
  return { eid, done }
}

let beginCanonical = (
  task: string,
  extra: Record<string, unknown> = {},
) => {
  let eid = uid()
  let done = write([
    {
      eid,
      name: 'session',
      comp: { id: uid(), requested_task_eid: task },
    },
    {
      eid,
      name: 'spawn',
      comp: {
        provider: 'fake',
        model: 'fake-fast',
        ...extra,
      },
    },
  ])
  return { eid, done }
}

// A comment aimed at a session — the input path.
let say = (target: string, body: string) => {
  let c = uid()
  return [
    { eid: c, name: 'doc', comp: { title: '', body } },
    { eid: c, name: 'comment', comp: { target_eid: target } },
  ]
}

// What the server said back on a session. refuse() writes AS the session,
// so its own `via` is what marks the reply — the same stamp that keeps it
// from re-entering commented() and refusing forever.
let refusals = (target: string) =>
  (db.prepare(
    `select d.body from comment c join doc d on d.eid = c.eid
     join created cr on cr.eid = c.eid
     where c.target_eid = ? and cr.via = ?`,
  ).all(target, target) as { body: string }[]).map((c) => c.body)

// The delivery ledger: a comment wears `notified` once some ear took it.
let told = (eid: string) =>
  !!db.prepare('select 1 from notified where eid = ?').get(eid)

// A session row + log file exactly as a dead child would have left them.
let plant = (lines: string[], provider = 'fake') => {
  let eid = uid()
  apply(db, [{ eid, name: 'session', comp: { id: uid() } }])
  db.prepare(
    `update session set origin = 'managed', status = 'running', provider = ?
     where eid = ?`,
  ).run(provider, eid)
  Deno.mkdirSync(logsDir(), { recursive: true })
  Deno.writeTextFileSync(log(eid), lines.map((l) => `${l}\n`).join(''))
  return eid
}
let log = (eid: string) => `${logsDir()}/${eid}.jsonl`

// Wait for something the machine does off-thread: a tail catching up, a
// child settling. The budget is deliberately generous because its only job
// is to fail instead of hanging — it is NOT an assertion about speed. These
// waits ride real subprocesses, and a loaded box stretches a 130ms settle
// past a second; a budget tight enough to catch that turns a green suite red
// at random, which trains people to re-run instead of read.
// Wait for something the machine does off-thread: a tail catching up, a
// child settling. The budget is deliberately generous because its only job
// is to fail instead of hanging — it is NOT an assertion about speed. These
// waits ride real subprocesses, and a loaded box stretches a 130ms settle
// past a second; a budget tight enough to catch that turns a green suite red
// at random, which trains people to re-run instead of read. `what` may be a
// thunk, so a wait that does time out can say which half of it stalled.
let until = async (
  fact: () => boolean,
  what: string | (() => string) = 'it',
) => {
  let deadline = Date.now() + 20_000
  do {
    if (fact()) return
    await new Promise((go) => setTimeout(go, 5))
  } while (Date.now() < deadline)
  throw new Error(
    `timed out waiting for ${typeof what == 'function' ? what() : what}`,
  )
}

let INIT = '{"type":"init","session_id":"sid-1","model":"fake-fast"}'
let RESULT =
  '{"type":"result","final_text":"first","usage":{"output_tokens":7}}'

Deno.test('child PATH leads with the task CLI and preserves the service', () => {
  let bin = '/home/agent/.deno/bin'
  assertEquals(
    childPath('/home/agent', '/usr/bin:/opt/bin'),
    `${bin}:/usr/bin:/opt/bin`,
  )
  assertEquals(childPath('/home/agent', `${bin}:/usr/bin`), `${bin}:/usr/bin`)
  assertEquals(
    childPath('/home/agent', `/usr/bin:${bin}:${bin}`),
    `${bin}:/usr/bin`,
  )
  assertEquals(childPath('/home/agent', ''), bin)
  assertEquals(childPath('', '/usr/bin'), '/usr/bin')
})

Deno.test('a spawn the graph cannot honor is a failed session, not a 400', async () => {
  let { t } = seed()
  let no = seed('', null) // a project with no repo comp
  let cases: [Record<string, unknown>, RegExp][] = [
    [{ provider: 'oracle' }, /unknown provider/],
    [{ model: 'gpt-9' }, /unknown model/],
    [{ effort: 'heroic' }, /unknown effort/],
    [{ requested_task_eid: uid() }, /no such task/],
    [{ requested_task_eid: no.t }, /no repo/],
  ]
  for (let [extra, says] of cases) {
    let { eid, done } = begin(t, extra)
    await done
    let s = row(eid)!
    assertEquals(s.status, 'failed', JSON.stringify(extra))
    assertEquals(s.origin, 'managed')
    assertMatch(String(s.error), says)
  }
})

Deno.test('a fake session runs end to end', async () => {
  let { t } = seed('noise') // tell the fake to write to stderr too
  let canvas = uid(), card = uid()
  apply(db, [{ eid: canvas, name: 'canvas', comp: {} }])
  heard = []
  let eid = uid(), id = uid()
  let done = write([
    {
      eid,
      name: 'session',
      comp: {
        id,
        provider: 'fake',
        model: 'fake-fast',
        effort: 'low',
        requested_task_eid: t,
      },
    },
    // The card and pin ride the SAME batch — the client mints them, the
    // server never learns how to place a card.
    { eid: card, name: 'card', comp: { target_eid: eid, view: 'Session' } },
    {
      eid: card,
      name: 'pin',
      comp: { canvas_eid: canvas, x: 10, y: 20, w: 420, h: 0, z: 1 },
    },
  ])
  // Visible from its first moment: the batch itself carried the session,
  // card and pin; the effect's sync half has already stamped 'starting'.
  assert(heard.some((c) => c.eid == eid && c.name == 'session'))
  assertEquals(heard.find((c) => c.name == 'pin')?.comp?.canvas_eid, canvas)
  assertEquals(heard.find((c) => c.name == 'card')?.comp?.view, 'Session')
  assertEquals(row(eid)?.status, 'starting')

  await done
  let s = row(eid)!
  assertEquals(s.status, 'completed')
  assertEquals(s.exit_code, 0)
  assertEquals(s.origin, 'managed')
  assertEquals(s.provider_session_id, s.id) // the child was told who it is
  assertEquals(s.serving_model, 'fake-fast')
  assertEquals(s.latest_seq, 5) // the prompt line, then the child's four
  assertEquals(s.requested_task_eid, t)
  assertEquals(spawnRow(eid)?.provider, 'fake')
  assertEquals(spawnRow(eid)?.model, 'fake-fast')
  assertEquals(s.provider, 'fake') // dormant old-reader alias
  assertEquals(s.model, 'fake-fast')
  assertMatch(String(s.final_text), /^done: /)
  assertEquals(
    (db.prepare('select body from doc where eid = ?').get(eid) as {
      body: string
    }).body,
    s.final_text,
  )
  assertEquals(JSON.parse(String(s.usage_json)).output_tokens, 34)
  assertEquals(s.error, null)
  assertMatch(String(s.branch), /^session\/S-\d+$/)
  assertMatch(String(s.base_revision), /^[0-9a-f]{40}$/)
  assert(Deno.statSync(String(s.cwd)).isDirectory) // it ran in its worktree
  // The summary rode the wire as whole session comps, never as raw log.
  assert(heard.some((c) => c.name == 'session' && c.comp?.status == 'running'))

  // Line 1 is what we SENT — the instruction, readable back as a user say.
  let first = logs(eid, new URLSearchParams('after=0&limit=1')).entries[0]
  assertEquals(first.seq, 1)
  assertEquals(JSON.parse(first.line).type, 'session.prompt')
  assertMatch(JSON.parse(first.line).text, /T-\d+/)
  assertEquals(first.row?.kind, 'say')

  // The log reads back from the file, bounded, line number = seq.
  let page = logs(eid, new URLSearchParams('after=2&limit=2'))
  assertEquals(page.entries.map((e) => e.seq), [3, 4])
  assertEquals(JSON.parse(page.entries[0].line).type, 'message')
  assertEquals(logs(eid, new URLSearchParams('tail=1')).entries[0].seq, 5)
  assertEquals(logs(eid, new URLSearchParams('after=99')).entries, [])
  // No bounds asked for, none applied: the whole log, which is what a
  // reader opening a session gets.
  assertEquals(
    logs(eid, new URLSearchParams()).entries.map((e) => e.seq),
    [1, 2, 3, 4, 5],
  )
  assertMatch(String(page.stderr), /stderr noise/) // diagnostics, unordered
})

Deno.test('a managed role runs in its project and resumes content-free', async () => {
  let project = uid(), role = uid(), eid = uid(), id = uid()
  let done = write([
    { eid: project, name: 'doc', comp: { title: 'Project', body: '' } },
    { eid: project, name: 'project', comp: {} },
    {
      eid: project,
      name: 'repo',
      comp: { path: scratch, base_branch: 'main' },
    },
    {
      eid: role,
      name: 'doc',
      comp: { title: 'Coordinator', body: 'report-role-env' },
    },
    {
      eid: role,
      name: 'role',
      comp: { state: 'running', surface: 'managed', scope_eid: project },
    },
    {
      eid,
      name: 'session',
      comp: {
        id,
        provider: 'fake',
        model: 'fake-fast',
        role_eid: role,
        operator: 1,
      },
    },
  ])
  await done
  assertEquals(row(eid)?.status, 'completed', JSON.stringify(row(eid)))
  assertEquals(row(eid)?.actor_eid, project)
  assertEquals(row(eid)?.requested_task_eid, null)
  let events = Deno.readTextFileSync(log(eid)).split('\n').filter(Boolean)
  assert(
    events.some((line) => line.includes(`"text":"role:${role}"`)),
  )

  await continueSession(
    eid,
    'You have pending Tasks messages. Call task_context now.',
    cast,
  )
  assertEquals(row(eid)?.status, 'completed')
  let inputs = Deno.readTextFileSync(log(eid)).split('\n').filter(Boolean)
    .map((line) => JSON.parse(line) as { type?: string; text?: string })
    .filter((event) => event.type == 'session.input')
  assertEquals(
    inputs.at(-1)?.text,
    'You have pending Tasks messages. Call task_context now.',
  )
})

Deno.test('a canonical fake session dual-materializes and runs', async () => {
  let { t } = seed()
  let { eid, done } = beginCanonical(t, { effort: 'high' })
  await done
  assertEquals(row(eid)?.status, 'completed')
  assertEquals(row(eid)?.provider, 'fake')
  assertEquals(row(eid)?.model, 'fake-fast')
  assertEquals(row(eid)?.effort, 'high')
  assertEquals(spawnRow(eid)?.provider, 'fake')
  assertEquals(spawnRow(eid)?.model, 'fake-fast')
  assertEquals(spawnRow(eid)?.effort, 'high')
  assertEquals(logs(eid, new URLSearchParams()).entries.length, 5)
})

Deno.test('an external provider patch is not a launch request', async () => {
  let eid = uid()
  await write([{
    eid,
    name: 'session',
    comp: { id: uid(), cwd: scratch },
  }])
  assertEquals(spawnRow(eid)?.provider, null)
  await write([{
    eid,
    name: 'session',
    comp: { provider: 'fake', model: 'fake-fast' },
  }])
  assertEquals(spawnRow(eid)?.provider, 'fake')
  assertEquals(row(eid)?.origin, 'external')
  assertEquals(row(eid)?.status, null)
  assertEquals(logs(eid, new URLSearchParams()).entries, [])
})

Deno.test('a worn persona rides the prompt whole — tiers and all', async () => {
  let { t } = seed()
  let per = uid(), mem = uid()
  apply(db, [
    { eid: per, name: 'doc', comp: { title: 'probe', body: 'Be terse.' } },
    { eid: per, name: 'persona', comp: {} },
    { eid: mem, name: 'doc', comp: { title: 'lesson', body: 'Front door.' } },
    {
      eid: per,
      name: 'dependency',
      comp: { type: 'contains', child_eid: mem },
    },
  ])
  let { eid, done } = begin(t, { persona_eid: per })
  await done
  let first = logs(eid, new URLSearchParams('after=0&limit=1')).entries[0]
  let text = JSON.parse(first.line).text
  assertMatch(text, /Be terse\./)
  assertMatch(text, /---\n\n# D-\d+ lesson/)
  assertMatch(text, /Front door\./)
  assertMatch(text, /House rules/)
  assertMatch(text, /task land/)
})

Deno.test('a child that exits nonzero failed, whatever it said', async () => {
  let { t } = seed('fail:3')
  let { eid, done } = begin(t)
  await done
  assertEquals(row(eid)?.status, 'failed') // it printed a result anyway
  assertEquals(row(eid)?.exit_code, 3)
})

// The launcher's refusals are all SILENT — it backgrounds systemd-run and
// exits 0 — so the only witness is the stderr file and the pidfile that
// never appeared. Shadowing systemd-run with a refusal replays the whole
// class (a scope name still held, an unreachable user bus) exactly.
Deno.test('a launch that never starts is stillborn, and says what refused', async () => {
  let { t } = seed()
  let path = Deno.env.get('PATH')!
  Deno.mkdirSync(`${tmp}/bin`, { recursive: true })
  Deno.writeTextFileSync(
    `${tmp}/bin/systemd-run`,
    '#!/bin/sh\necho "Failed to start transient scope unit: ' +
      'Unit already exists." >&2\nexit 1\n',
  )
  Deno.chmodSync(`${tmp}/bin/systemd-run`, 0o755)
  Deno.env.set('PATH', `${tmp}/bin:${path}`)
  Deno.env.set('BIRTH_GRACE_MS', '400')
  let eid: string
  try {
    let run = begin(t)
    eid = run.eid
    await run.done
  } finally {
    Deno.env.set('PATH', path)
    Deno.env.delete('BIRTH_GRACE_MS')
  }
  let s = row(eid)!
  assertEquals(s.status, 'failed')
  assertEquals(s.exit_code, null)
  // Not 'the wrapper died before reporting': no wrapper ever ran to die.
  assertMatch(String(s.stop_reason), /^stillborn/)
  assertMatch(String(s.error), /transient scope unit/)
})

// The settle broadcast: whoever holds the task hears the ending on the
// bus, because the ending IS a comment on the task, via the
// session — cast like any wire write, exactly once per settle.
let settleComments = (task: string, via: string) =>
  (db.prepare(
    `select d.body from comment c join doc d on d.eid = c.eid
     join created b on b.eid = c.eid
     where c.target_eid = ? and b.via = ?`,
  ).all(task, via) as { body: string }[]).map((c) => c.body)

Deno.test('a settled session says so on its task', async () => {
  let { t } = seed()
  heard = []
  let { eid, done } = begin(t)
  await done
  assertEquals(row(eid)?.status, 'completed')
  let said = settleComments(t, eid)
  assertEquals(said.length, 1)
  assertMatch(said[0], /^S-\d+ completed · exit 0\n/)
  assertMatch(said[0], /done: /) // the final text's gist rides along
  // The comment rode the CAST — clients heard graph data, not a stamp.
  assert(
    heard.some((c) => c.name == 'comment' && c.comp?.target_eid == t),
  )
})

Deno.test('a failed spawn tells its task and its spawner — and only once', async () => {
  let { t } = seed()
  let spawner = uid(), sid = uid()
  apply(db, [{ eid: spawner, name: 'session', comp: { id: sid } }])
  heard = []
  let { eid, done } = begin(t, { model: 'no-such-model' }, sid)
  await done
  assertEquals(row(eid)?.status, 'failed')
  let said = settleComments(t, eid)
  assertEquals(said.length, 1)
  assertMatch(said[0], /^S-\d+ failed\n/)
  assertMatch(said[0], /unknown model/)
  assertEquals(settleComments(spawner, eid), said)
  assertEquals(
    (db.prepare('select via from created where eid = ?').get(eid) as {
      via: string
    }).via,
    spawner,
  )
  assert(
    heard.some((c) => c.name == 'comment' && c.comp?.target_eid == spawner),
  )
  let bus = noticesFor(snapshot(db), sid)
  assertEquals(bus.lines.length, 1)
  assertMatch(bus.lines[0], /S-\d+ failed/)
  spawned(cast)(eid, { provider: 'fake' })
  assertEquals(settleComments(t, eid).length, 1)
  assertEquals(settleComments(spawner, eid).length, 1)
})

Deno.test('a client-launched session reports only on its task', async () => {
  let { t } = seed()
  let client = uid()
  apply(db, [{
    eid: client,
    name: 'client',
    comp: { user_agent: 'test' },
  }])
  let { eid, done } = begin(t, { model: 'no-such-model' }, client)
  await done
  assertEquals(
    (db.prepare('select via from created where eid = ?').get(eid) as {
      via: string
    }).via,
    client,
  )
  assertEquals(settleComments(t, eid).length, 1)
  assertEquals(settleComments(client, eid), [])
})

Deno.test('a settling session releases its leases — a live one keeps its own', async () => {
  let { t } = seed()
  let { t: kept } = seed()
  let eid = plant([INIT]) // died before its terminal event → failed
  let live = uid()
  apply(db, [
    { eid: live, name: 'session', comp: { id: uid() } },
    { eid: t, name: 'claim', comp: { session_eid: eid } },
    { eid: kept, name: 'claim', comp: { session_eid: live } },
  ])
  heard = []
  recover(cast)
  await running.get(eid)!.done
  assertEquals(row(eid)?.status, 'failed')
  // The dead session's lease is gone and the lapse is on the task's
  // trail — the same words task wrap leaves for an interactive end.
  assertEquals(
    db.prepare('select 1 from claim where eid = ?').get(t),
    undefined,
  )
  let said = settleComments(t, eid)
  assertEquals(said.length, 1)
  assertMatch(said[0], /lease lapsed/)
  // The release rode the CAST — no client cache keeps the ghost claim.
  assert(heard.some((c) => c.eid == t && c.name == 'claim' && c.comp == null))
  // The bystander's lease is not ours to lapse.
  assert(db.prepare('select 1 from claim where eid = ?').get(kept))
})

Deno.test('stop: a stop_request signals the group, the ending is OBSERVED', async () => {
  let { t } = seed('delay:9000')
  let { eid, done } = begin(t)
  await until(() => row(eid)?.status == 'running', 'the init event')
  let c0 = snapshot(db).cursor ?? 0
  heard = []
  let sr = uid()
  await write([{ eid: sr, name: 'stop_request', comp: { target_eid: eid } }])
  let s = row(eid)!
  assertEquals(s.status, 'interrupted') // never stamped before the exit
  assert(s.stop_requested_at)
  assertEquals(s.exit_code, 143) // SIGTERM, from a child that was ours
  let stopping: Change = {
    eid,
    name: 'session',
    comp: {
      status: 'stopping',
      stop_requested_at: s.stop_requested_at,
    },
  }
  let isStopping = (c: Change) =>
    c.eid == eid && c.name == 'session' && c.comp?.status == 'stopping'
  assertEquals(heard.filter(isStopping), [stopping])
  assertEquals(delta(db, c0).changes.filter(isStopping), [stopping])
  // The request stays as audit, settled delivered when the signals were sent.
  assert(acted(sr))
  await done
  // A second pull on a settled session bounces off the RULE.
  assertThrows(
    () =>
      apply(db, [
        { eid: uid(), name: 'stop_request', comp: { target_eid: eid } },
      ]),
    Error,
    'stop_request refused',
  )
})

Deno.test('sweep: an unacted stop_request re-fires at boot and kills', async () => {
  let { t } = seed('delay:9000')
  let { eid, done } = begin(t)
  await until(() => row(eid)?.status == 'running', 'the init event')
  // The crash window, reproduced: the request COMMITS (the rule passes —
  // the target is running) but its effect never fires.
  let sr = uid()
  cast(apply(db, [
    { eid: sr, name: 'stop_request', comp: { target_eid: eid } },
  ]))
  assertEquals(acted(sr), null)
  // Boot: the relay finds it and drives the stop to an observed ending.
  assertEquals((await relay(pending)).length, 1)
  let s = row(eid)!
  assertEquals(s.status, 'interrupted')
  assertEquals(s.exit_code, 143)
  assert(acted(sr))
  await done
  // A second pass finds nothing pending — acted requests never re-fire.
  assertEquals((await relay(pending)).length, 0)
})

Deno.test('sweep: a target that settled on its own is acted, not errored', async () => {
  let { t } = seed('delay:500')
  let { eid, done } = begin(t)
  await until(() => row(eid)?.status == 'running', 'the init event')
  let sr = uid()
  cast(apply(db, [
    { eid: sr, name: 'stop_request', comp: { target_eid: eid } },
  ]))
  await done // the child finishes on its own; the request outlives the run
  assertEquals(row(eid)!.status, 'completed')
  heard = []
  let c0 = snapshot(db).cursor ?? 0
  await relay(pending)
  assert(acted(sr)) // nothing to stop IS acted
  let s = row(eid)!
  assertEquals(s.status, 'completed') // never re-stamped, never 'lost'
  assertEquals(s.exit_code, 0)
  let session = (c: Change) => c.eid == eid && c.name == 'session'
  assertEquals(heard.filter(session), [])
  assertEquals(delta(db, c0).changes.filter(session), [])
})

Deno.test('the rule refuses sessions that are not ours to end', () => {
  let ext = uid()
  apply(db, [{ eid: ext, name: 'session', comp: { id: 'announced' } }])
  assertThrows(
    () =>
      apply(db, [
        { eid: uid(), name: 'stop_request', comp: { target_eid: ext } },
      ]),
    Error,
    'external',
  )
  assertThrows(
    () =>
      apply(db, [
        { eid: uid(), name: 'stop_request', comp: { target_eid: uid() } },
      ]),
    Error,
    'gone',
  )
})

Deno.test('deleting a running session takes its process with it', async () => {
  let { t } = seed('delay:9000')
  let { eid, done } = begin(t)
  await until(() => row(eid)?.status == 'running', 'the init event')
  let pid = Number(
    Deno.readTextFileSync(`${logsDir()}/${eid}.pid`).trim().split(/\s+/).pop(),
  )
  let alive = () =>
    new Deno.Command('kill', {
      args: ['-0', String(pid)],
      stdout: 'null',
      stderr: 'null',
    }).outputSync().success
  await write([{ eid, name: 'entity', comp: null }])
  await until(() => !alive(), 'the child to die')
  assert(!running.has(eid)) // nothing left to follow
  assertThrows(() => Deno.statSync(`${logsDir()}/${eid}.pid`)) // or adopt
  await done // the orphaned tailer settles without a row to stamp
})

Deno.test('boot: a child that died while we were away is read from its file', async () => {
  let eid = plant([INIT, '{"type":"message","text":"hi"}', RESULT])
  recover(cast)
  await running.get(eid)!.done
  let s = row(eid)!
  assertEquals(s.status, 'completed')
  assertEquals(s.latest_seq, 3)
  assertEquals(s.final_text, 'first')
  assertEquals(JSON.parse(String(s.usage_json)).output_tokens, 7)
  assertEquals(s.exit_code, null) // we didn't spawn it: nobody's to read
  assertMatch(String(s.stop_reason), /unobserved/)
})

Deno.test('boot: external transcripts restore model facts missed at startup', () => {
  let eid = uid()
  let path = `${stores.claude}/${uid()}.jsonl`
  Deno.mkdirSync(stores.claude, { recursive: true })
  Deno.writeTextFileSync(
    path,
    JSON.stringify({
      type: 'assistant',
      effort: 'high',
      message: { model: 'claude-sonnet-5' },
    }) + '\n',
  )
  apply(db, [{
    eid,
    name: 'session',
    comp: { id: uid(), cwd: scratch, transcript: path },
  }])
  db.prepare('update session set finished_at = ? where eid = ?')
    .run('2026-07-27T16:07:22.782Z', eid)

  heard = []
  recover(cast)

  assertEquals(row(eid)?.provider, 'claude')
  assertEquals(row(eid)?.serving_model, 'claude-sonnet-5')
  assertEquals(row(eid)?.effort, 'high')
  assert(heard.some((c) =>
    c.eid == eid && c.name == 'session' &&
    c.comp?.serving_model == 'claude-sonnet-5'
  ))
})

Deno.test('a settled lifecycle stamp is one replayable moved patch', async () => {
  let eid = plant([])
  let c0 = snapshot(db).cursor ?? 0
  heard = []
  recover(cast)
  await running.get(eid)!.done

  let rows = db.prepare(
    'select batch from journal where rowid > ? order by rowid',
  ).all(c0) as { batch: string }[]
  assertEquals(rows.length, 1)
  let changes = JSON.parse(rows[0].batch) as Change[]
  assertEquals(changes, [{
    eid,
    name: 'session',
    comp: {
      status: 'failed',
      stop_reason: 'exit unobserved: the child outlived the server',
      finished_at: row(eid)?.finished_at,
    },
  }])
  assertEquals(
    heard.filter((c) => c.eid == eid && c.name == 'session'),
    changes,
  )
  assertEquals(
    delta(db, c0).changes.filter((c) => c.name == 'session'),
    changes,
  )
})

Deno.test('tail diagnoses never override a successful ending', async () => {
  let eid = plant([
    INIT,
    '{"type":"message", this is not json',
    RESULT,
    JSON.stringify({ type: 'message', text: 'x'.repeat(1_100_000) }),
    '{"type":"result","final_text":"second"}',
  ])
  recover(cast)
  await running.get(eid)!.done
  let s = row(eid)!
  assertEquals(s.status, 'completed')
  assertEquals(s.final_text, 'first') // the late result never lands
  assertEquals(s.latest_seq, 5) // every line counted, none skipped
  assertMatch(String(s.error), /line 2: malformed/)
  assertMatch(String(s.error), /line 4: truncated \(1100028 bytes/)
  assertMatch(String(s.error), /line 5: output after the terminal event/)
})

Deno.test('an oversized line is truncated and the tail reaches exit 0', async () => {
  let huge = JSON.stringify({ type: 'message', text: 'x'.repeat(1_100_000) })
  let eid = plant([
    INIT,
    huge,
    '{"type":"message","text":"after"}',
    '{"type":"result","final_text":"done after truncation"}',
  ])
  Deno.writeTextFileSync(`${logsDir()}/${eid}.code`, '0')
  recover(cast)
  await running.get(eid)!.done

  let s = row(eid)!
  assertEquals(s.status, 'completed')
  assertEquals(s.exit_code, 0)
  assertEquals(s.final_text, 'done after truncation')
  assertEquals(s.latest_seq, 4)
  assertMatch(String(s.error), /line 2: truncated \(1100028 bytes/)

  let entries = logs(eid, new URLSearchParams()).entries
  assertEquals(entries.map((e) => e.seq), [1, 2, 3, 4])
  assert(entries[1].line.startsWith('{"type":"message","text":"xxx'))
  assert(entries[1].line.endsWith('… [truncated]'))
  assertEquals(entries[1].row, undefined)
  assertEquals(JSON.parse(entries[2].line).text, 'after')
  assertEquals(JSON.parse(entries[3].line).final_text, 'done after truncation')
})

Deno.test('boot: a resumed log re-opens at its input marker', async () => {
  let eid = plant([
    INIT,
    RESULT,
    '{"type":"session.input","text":"more"}',
    '{"type":"result","final_text":"second","usage":{"output_tokens":9}}',
  ])
  recover(cast)
  await running.get(eid)!.done
  let s = row(eid)!
  assertEquals(s.status, 'completed')
  assertEquals(s.final_text, 'second') // the SECOND run's ending lands
  assertEquals(s.latest_seq, 4)
  assertEquals(s.error, null) // resume's shape is not a violation
})

Deno.test('boot: a live child is adopted, its file followed from where it is', async () => {
  let eid = plant([INIT])
  // A stand-in for the agent: detached, in its own group, with a pidfile —
  // all boot recovery has to go on.
  let child = new Deno.Command('setsid', {
    args: ['sleep', '9'],
    stdout: 'null',
    stderr: 'null',
  }).spawn()
  Deno.writeTextFileSync(`${logsDir()}/${eid}.pid`, String(child.pid))
  recover(cast)
  let done = running.get(eid)!.done
  // The adopted tailer re-reads the file from byte 0: the row is planted
  // 'running', so what proves adoption is the summary it re-derives.
  await until(
    () => row(eid)?.provider_session_id == 'sid-1',
    'the adopted init',
  )
  assertEquals(row(eid)?.latest_seq, 1)

  // A half-written line is not a line yet — it waits for its newline.
  let f = Deno.openSync(log(eid), { append: true, write: true })
  f.writeSync(new TextEncoder().encode('{"type":"tool"'))
  await new Promise((go) => setTimeout(go, 30))
  assertEquals(row(eid)?.latest_seq, 1)
  f.writeSync(new TextEncoder().encode(`,"name":"read"}\n${RESULT}\n`))
  f.close()
  await until(() => row(eid)?.final_text == 'first', 'the terminal event')
  assertEquals(row(eid)?.latest_seq, 3)

  child.kill('SIGKILL')
  await child.status
  await done
  assertEquals(row(eid)?.status, 'completed')
})

Deno.test('boot: a pending live comment completes its interrupted handoff', async () => {
  let eid = plant([INIT])
  db.prepare(`
    update session set provider_session_id = 'sid-1', model = 'fake-fast',
      cwd = ?, input_at = '2026-07-27T12:00:00Z'
    where eid = ?
  `).run(scratch, eid)
  let pending = say(eid, 'heard after restart')
  apply(db, pending)
  let child = new Deno.Command('setsid', {
    args: ['sleep', '9'],
    stdout: 'null',
    stderr: 'null',
  }).spawn()
  Deno.writeTextFileSync(`${logsDir()}/${eid}.pid`, String(child.pid))

  recover(cast)
  await until(
    () => told(pending[1].eid) && row(eid)?.status == 'completed',
    'the recovered input handoff',
  )
  await child.status
  let events = Deno.readTextFileSync(log(eid)).split('\n').filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; text?: string })
  assertEquals(
    events.some((e) =>
      e.type == 'session.input' && e.text == 'heard after restart'
    ),
    true,
  )
})

Deno.test('a tail tick that only moves the counter stays off the wire', async () => {
  let eid = plant([INIT])
  let child = new Deno.Command('setsid', {
    args: ['sleep', '9'],
    stdout: 'null',
    stderr: 'null',
  }).spawn()
  Deno.writeTextFileSync(`${logsDir()}/${eid}.pid`, String(child.pid))
  recover(cast)
  let done = running.get(eid)!.done
  await until(
    () => row(eid)?.provider_session_id == 'sid-1',
    'the adopted init',
  )

  // Chatter that changes no summary column: the row counts it, the wire
  // stays silent — a run's whole transcript must not re-render every
  // client per poll tick (T-7063).
  heard = []
  let c0 = snapshot(db).cursor ?? 0
  let f = Deno.openSync(log(eid), { append: true, write: true })
  f.writeSync(new TextEncoder().encode(
    '{"type":"message","text":"a"}\n{"type":"message","text":"b"}\n',
  ))
  await until(() => row(eid)?.latest_seq == 3, 'the counted lines')
  assertEquals(heard.filter((c) => c.name == 'session'), [])
  assertEquals(delta(db, c0), { changes: [], cursor: c0 })

  // The terminal event is news — its summary rides the wire.
  f.writeSync(new TextEncoder().encode(`${RESULT}\n`))
  f.close()
  await until(() => row(eid)?.final_text == 'first', 'the terminal event')
  assert(
    heard.some((c) => c.name == 'session' && c.comp?.final_text == 'first'),
  )

  child.kill('SIGKILL')
  await child.status
  await done
})

Deno.test('boot: a session whose provider is gone fails loudly', () => {
  let eid = plant([INIT], 'oracle')
  recover(cast)
  assertEquals(row(eid)?.status, 'failed')
  assertMatch(String(row(eid)?.error), /no adapter/)
})

Deno.test('a comment resumes nothing it should not', async () => {
  // active: the bus delivers, the effect stays out of it
  let active = plant([INIT]) // status 'running'
  db.prepare('update session set provider_session_id = ? where eid = ?')
    .run('sid-1', active)
  await write(say(active, 'hi'))
  assertEquals(row(active)?.status, 'running') // untouched
  assertEquals(refusals(active), []) // delivery, not a failure to say
  // settled but never announced a provider thread: refused OUT LOUD
  let bare = plant([INIT])
  db.prepare("update session set status = 'completed' where eid = ?")
    .run(bare)
  await write(say(bare, 'hi'))
  assertEquals(row(bare)?.status, 'completed')
  assertMatch(refusals(bare)[0], /never announced a provider thread/)
  // THE FLOOR: refuse() writes its reply AS the session, so commented()
  // reads it as the session talking about itself and lets it lie. Without
  // it the reply re-enters the gate, fails to resume again, and refuses
  // forever — removing the writer arg HANGS this file rather than failing
  // it, so the stamp is asserted directly too and breaks fast.
  assertEquals(refusals(bare).length, 1) // the line above is the control
  assertEquals(
    (db.prepare(
      `select cr.via from comment c join created cr on cr.eid = c.eid
       where c.target_eid = ? order by c.rowid desc limit 1`,
    ).get(bare) as { via: string | null }).via,
    bare,
  )
  // a persistent role never receives graph words through provider argv;
  // roles.ts sends a fixed task_context wake after the turn settles.
  let role = uid(), roleRun = plant([INIT])
  apply(db, [
    {
      eid: role,
      name: 'role',
      comp: { state: 'running', surface: 'managed' },
    },
    { eid: roleRun, name: 'session', comp: { role_eid: role } },
  ])
  db.prepare("update session set status = 'completed' where eid = ?")
    .run(roleRun)
  let pending = say(roleRun, 'graph words stay in the graph')
  await write(pending)
  assertEquals(row(roleRun)?.status, 'completed')
  assertEquals(told(pending[1].eid), false)
})

Deno.test('a comment at a settled session joins the log and resumes it', async () => {
  // A real end-to-end run leaves a settled session with a worktree + thread.
  let { t } = seed()
  let { eid, done } = begin(t)
  await done
  assertEquals(row(eid)?.status, 'completed')
  let before = row(eid)!.latest_seq as number

  heard = []
  let resumed = write(say(eid, 'and one more thing'))
  // Flipped running straight away — the effect's synchronous half.
  assertEquals(row(eid)?.status, 'running')
  assertEquals(row(eid)?.finished_at, null)
  assert(heard.some((c) => c.name == 'session' && c.comp?.status == 'running'))
  // The synthetic line is now in the file, as the next seq, a user say.
  let page = logs(eid, new URLSearchParams(`after=${before}&limit=1`))
  assertEquals(page.entries[0].seq, before + 1)
  assertEquals(JSON.parse(page.entries[0].line).type, 'session.input')
  // the writer stamps its clock; the transcript shows when it landed
  let { at, ...said } = page.entries[0].row as { at?: string }
  assert(at && !Number.isNaN(Date.parse(at)))
  assertEquals(said, {
    kind: 'say',
    role: 'user',
    text: 'and one more thing',
  })

  // The continuation appends and the tailer settles it again — seq only grew.
  await resumed
  assertEquals(row(eid)?.status, 'completed')
  assert((row(eid)!.latest_seq as number) > before + 1)
})

Deno.test('a session commenting on itself never resumes it', async () => {
  let { t } = seed()
  let { eid, done } = begin(t)
  await done
  let before = row(eid)!.latest_seq as number
  await write(say(eid, 'note to self'), eid) // the instrument IS the session
  assertEquals(row(eid)?.status, 'completed')
  assertEquals(row(eid)?.latest_seq, before) // the log never heard it
})

Deno.test('a comment steers a live managed session without settling it', async () => {
  let { t } = seed()
  let { eid, done } = begin(t)
  await done
  let reports = settleComments(t, eid).length
  // The resumed turn dawdles long enough for a comment to steer it.
  let resumed = write(say(eid, 'delay:1000 keep going'))
  assertEquals(row(eid)?.status, 'running')
  let steer = say(eid, 'also: rename it')
  await write(steer)
  await resumed
  await until(
    () => told(steer[1].eid) && row(eid)?.status == 'completed',
    // Both halves named: if this ever times out again, the message says
    // whether the steer went undelivered or the run never settled — a
    // stalled fact and a slow one want opposite fixes.
    () =>
      `the steered continuation to settle (steer delivered=${
        told(steer[1].eid)
      }, status=${row(eid)?.status}, exit=${row(eid)?.exit_code}, error=${
        row(eid)?.error
      }, stop=${row(eid)?.stop_reason}, seq=${row(eid)?.latest_seq})`,
  )
  let events = Deno.readTextFileSync(log(eid)).split('\n').filter(Boolean)
    .map((l) =>
      JSON.parse(l) as { type: string; text?: string; final_text?: string }
    )
  assertEquals(
    events.filter((e) => e.type == 'session.input').map((e) => e.text),
    ['delay:1000 keep going', 'also: rename it'],
  )
  assertEquals(
    events.some((e) => e.text == 'working: also: rename it'),
    true,
  )
  assertEquals(
    events.some((e) =>
      e.type == 'result' && e.final_text?.includes('delay:1000 keep going')
    ),
    false,
  )
  // Steering is one continuous session, not an interrupted settlement.
  assertEquals(settleComments(t, eid).length, reports + 1)
})

Deno.test('a failed run stays down until the next word resumes it', async () => {
  let { t } = seed()
  let { eid, done } = begin(t)
  await done
  await write(say(eid, 'fail:3 then crash'))
  assertEquals(row(eid)?.status, 'failed') // no flush — a broken run stays down
  let wake = say(eid, 'wake up')
  await write(wake)
  await until(() => row(eid)?.status == 'completed', 'the woken run to settle')
  assertEquals(told(wake[1].eid), true)
})

Deno.test('refused words stay owed, never marked told', async () => {
  let bare = plant([INIT])
  db.prepare("update session set status = 'completed' where eid = ?").run(bare)
  let s = say(bare, 'hello?')
  await write(s)
  assertMatch(refusals(bare)[0], /never announced a provider thread/)
  assertEquals(told(s[1].eid), false)
})

// A bare git call inside a session's worktree — the test playing owner.
let inTree = (cwd: string, ...args: string[]) =>
  new Deno.Command('git', { args, cwd, stdout: 'null', stderr: 'null' })
    .outputSync()

Deno.test('tidy: a merged clean tree goes at boot, unmerged work stays', async () => {
  let a = begin(seed().t)
  await a.done
  let b = begin(seed().t)
  await b.done
  let treeA = String(row(a.eid)!.cwd), branchA = String(row(a.eid)!.branch)
  let treeB = String(row(b.eid)!.cwd)
  // b runs ahead of main: a commit on its branch that never merged
  Deno.writeTextFileSync(`${treeB}/ahead.txt`, 'unmerged')
  inTree(treeB, 'add', '-A')
  inTree(treeB, 'commit', '-m', 'ahead')
  heard = []
  await tidy(cast)
  // a: its branch tip IS the base tip, tree clean — worktree and branch go.
  // The row keeps its cwd for thread identity and sheds the branch marker.
  assertThrows(() => Deno.statSync(treeA))
  assertEquals(row(a.eid)?.cwd, treeA)
  assertEquals(row(a.eid)?.branch, null)
  assertEquals(
    inTree(scratch, 'rev-parse', '--verify', branchA).success,
    false,
  )
  assert(heard.some((c) => c.eid == a.eid && c.name == 'session'))
  // b: kept, untouched — main does not contain its commit
  assert(Deno.statSync(treeB).isDirectory)
  assert(row(b.eid)?.cwd)
  assert(row(b.eid)?.branch)
})

Deno.test('tidy: a dirty tree stays, whatever its branch says', async () => {
  let { eid, done } = begin(seed().t)
  await done
  let tree = String(row(eid)!.cwd)
  Deno.writeTextFileSync(`${tree}/scratch.txt`, 'uncommitted')
  await tidy(cast)
  assert(Deno.statSync(tree).isDirectory)
  assert(row(eid)?.cwd)
})

Deno.test('tidy: an absent tree is reconciled once', async () => {
  let { eid, done } = begin(seed().t)
  await done
  let tree = String(row(eid)!.cwd)
  Deno.removeSync(tree, { recursive: true })
  heard = []
  await tidy(cast)
  await tidy(cast)
  assertEquals(row(eid)?.cwd, tree)
  assertEquals(row(eid)?.branch, null)
  assertEquals(
    heard.filter((c) => c.eid == eid && c.name == 'session').length,
    1,
  )
})

Deno.test('a comment after the sweep regrows the worktree and resumes', async () => {
  let { p, t } = seed()
  let { eid, done } = begin(t)
  await done
  let tree = String(row(eid)!.cwd), branch = String(row(eid)!.branch)
  await tidy(cast) // merged and clean: swept, with its exact path retained
  assertEquals(row(eid)?.cwd, tree)
  assertEquals(row(eid)?.branch, null)
  let resumed = write(say(eid, 'one more thing'))
  await until(() => row(eid)?.status == 'running', 'the regrown resume')
  assertEquals(row(eid)?.cwd, tree) // the SAME path — the thread lives there
  assertEquals(row(eid)?.branch, branch)
  assert(Deno.statSync(tree).isDirectory)
  await resumed
  assertEquals(row(eid)?.status, 'completed') // the continuation settled
  assertEquals(refusals(eid), [])

  // Rows swept before the visible-root migration lost cwd. Their old path is
  // deterministic, so they still resume on the ground where their thread was
  // born instead of silently moving it.
  await tidy(cast)
  db.prepare('update session set cwd = null where eid = ?').run(eid)
  let legacy = write(say(eid, 'from the old root'))
  await until(() => row(eid)?.status == 'running', 'the legacy regrow')
  assertEquals(row(eid)?.cwd, tree)
  await legacy
  assertEquals(row(eid)?.status, 'completed')

  // and when the graph can't place a tree, the refusal is said
  db.prepare('update session set cwd = null where eid = ?').run(eid)
  db.prepare('delete from repo where eid = ?').run(p)
  await write(say(eid, 'hello?'))
  assertEquals(row(eid)?.status, 'completed')
  assertMatch(refusals(eid)[0], /no worktree to resume in/)
})

// An operator's session as the SessionStart hook reifies one: an id, a cwd,
// a process pid, and the transcript its provider keeps. The transcript must
// live in that provider's store, so the fixture writes one there.
// Called with no lines it reports NO transcript — the operator whose hook
// never named one (most of them, on the owner's graph): nothing to follow,
// and a door all the same.
let stores = {
  claude: `${Deno.env.get('HOME')}/.claude/projects/tasks-test`,
  codex: `${Deno.env.get('HOME')}/.codex/sessions/tasks-test`,
}
for (let store of Object.values(stores)) {
  try {
    Deno.removeSync(store, { recursive: true })
  } catch { /* never made */ }
}
let announce = (
  pid: number,
  lines?: string[],
  transcript = '',
  provider = 'claude',
) => {
  let eid = uid()
  let store = stores[provider as keyof typeof stores] ?? stores.claude
  Deno.mkdirSync(store, { recursive: true })
  let path = transcript || (lines ? `${store}/${uid()}.jsonl` : '')
  if (lines && !transcript) {
    Deno.writeTextFileSync(path, lines.map((l) => `${l}\n`).join(''))
  }
  apply(db, [{
    eid,
    name: 'session',
    comp: {
      id: uid(),
      cwd: scratch,
      pid,
      provider,
      ...(path ? { transcript: path } : {}),
    },
  }])
  return { eid, path }
}

let SAID = JSON.stringify({
  type: 'assistant',
  timestamp: '2026-07-26T12:00:00Z',
  message: { content: [{ type: 'text', text: 'hello from a tty' }] },
})

Deno.test("external session logs read each provider's confined transcript", async () => {
  let c = await fakeClaude()
  let { eid, path } = announce(c.pid, [SAID])
  assertEquals(logs(eid, new URLSearchParams()).entries[0].row, {
    kind: 'say',
    role: 'agent',
    text: 'hello from a tty',
    at: '2026-07-26T12:00:00Z',
  })
  // Older Claude rows predate provider stamping; their store still names
  // the dialect. A contradictory provider cannot cross into another store.
  db.prepare('update session set provider = null where eid = ?').run(eid)
  assertEquals(logs(eid, new URLSearchParams()).entries.length, 1)
  let crossed = announce(c.pid, [], path, 'codex')
  assertEquals(logs(crossed.eid, new URLSearchParams()).entries, [])
  let codex = announce(
    c.pid,
    [JSON.stringify({
      timestamp: '2026-07-26T12:00:00Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'hello Codex' },
    })],
    '',
    'codex',
  )
  assertEquals(logs(codex.eid, new URLSearchParams()).entries[0].row, {
    kind: 'say',
    role: 'user',
    text: 'hello Codex',
    at: '2026-07-26T12:00:00Z',
  })
  let clocked = announce(
    c.pid,
    [JSON.stringify({
      timestamp: '2026-07-26T12:01:00Z',
      type: 'response_item',
      payload: {
        type: 'reasoning',
        summary: [{ type: 'summary_text', text: 'thinking' }],
      },
    })],
    '',
    'codex',
  )
  assertEquals(logs(clocked.eid, new URLSearchParams()).entries[0].row, {
    kind: 'reason',
    text: 'thinking',
    at: '2026-07-26T12:01:00Z',
  })
  // A transcript is a reference, never a capability: traversal and a
  // symlink out of either provider's store both read nothing.
  let sneak = announce(c.pid, [], `${logsDir()}/../../etc/hostname`)
  assertEquals(logs(sneak.eid, new URLSearchParams()).entries, [])
  let outside = Deno.makeTempFileSync({ suffix: '.jsonl' })
  let link = `${stores.codex}/escape.jsonl`
  Deno.symlinkSync(outside, link)
  let escaped = announce(c.pid, [], link, 'codex')
  assertEquals(logs(escaped.eid, new URLSearchParams()).entries, [])
  Deno.removeSync(link)
  Deno.removeSync(outside)
  c.kill('SIGKILL')
  await c.status
})

Deno.test('an external Codex transcript follows its provider process', async () => {
  let c = await fakeCodex()
  let line = JSON.stringify({
    type: 'event_msg',
    payload: { type: 'user_message', message: 'one' },
  })
  let { eid, path } = announce(c.pid, [line], '', 'codex')
  watched(cast)(eid, { pid: c.pid })
  await until(() => !!row(eid)?.started_at, 'the Codex watch to start')
  assertEquals(row(eid)?.latest_seq, 1)
  Deno.writeTextFileSync(path, `${line}\n`, { append: true })
  await until(() => row(eid)?.latest_seq == 2, 'the Codex log to grow')
  c.kill('SIGKILL')
  await c.status
  await until(() => !!row(eid)?.finished_at, 'the Codex process to leave')
})

Deno.test('a session we never forked is watched by its door, not its exit code', async () => {
  let c = await fakeClaude()
  let { eid } = announce(c.pid, [SAID])
  watched(cast)(eid, { pid: c.pid })
  await until(() => !!row(eid)?.started_at, 'the watch to start')
  assertEquals(row(eid)?.finished_at, null) // still at the keyboard
  assertEquals(row(eid)?.latest_seq, 1)
  c.kill('SIGKILL')
  await c.status
  await until(() => !!row(eid)?.finished_at, 'the door to shut')
  // The irreducible difference, said rather than faked.
  assertEquals(row(eid)?.exit_code, null)
  assertEquals(row(eid)?.status, null)
})

// The bug the tray wore (T-7461): watching asked the TRANSCRIPT whether to
// bother, so a session that never reported one was never asked about and
// never stamped — forever pid-and-no-finished_at, indistinguishable from a
// live operator. Following and liveness are two questions; only the door
// answers the second.
Deno.test('a transcript-less session is watched by its door too', async () => {
  let c = await fakeClaude()
  let { eid } = announce(c.pid)
  watched(cast)(eid, { pid: c.pid })
  await until(() => !!row(eid)?.started_at, 'the watch to start')
  assertEquals(row(eid)?.finished_at, null) // still at the keyboard
  assertEquals(row(eid)?.latest_seq, 0) // nothing to count, and that's fine
  c.kill('SIGKILL')
  await c.status
  await until(() => !!row(eid)?.finished_at, 'the door to shut')
})

// A pid outlives its process and gets reused, so a row whose pid is no
// longer a claude serving IT is a ghost: end it and arm no heartbeat. The
// ending is the last time we HEARD from it, not the moment we noticed —
// a restart that stamped now() would parade every ghost through the tray's
// "finished recently" digest.
Deno.test('a ghost row ends when it was last heard from, unwatched', async () => {
  let c = await fakeClaude()
  let { eid } = announce(c.pid)
  c.kill('SIGKILL')
  await c.status
  watched(cast)(eid, { pid: c.pid })
  let born = db.prepare('select at from created where eid = ?').get(eid) as {
    at: string
  }
  assertEquals(row(eid)?.finished_at, born.at)
  assertEquals(row(eid)?.started_at, null) // no watch began, so none is told
})

Deno.test('a comment wakes an external session only when nobody is home', async () => {
  let c = await fakeClaude()
  let { eid } = announce(c.pid, [SAID], '', 'fake')
  await write(say(eid, 'still there?'))
  assertEquals(refusals(eid), []) // its channel delivered — nothing to do
  assertEquals(existsSync(log(eid)), false) // and nothing was spawned
  c.kill('SIGKILL')
  await c.status
  // Dead: the words go back in by the door the CLI left open — the
  // session's own id IS the thread `--resume` takes.
  await write(say(eid, 'anyone there?'))
  await until(() => existsSync(log(eid)), 'the resumed run to start')
  assertEquals(refusals(eid), [])
})
