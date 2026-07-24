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
import { fakeClaude, fakeCodex } from './door_fake.ts'

Deno.env.set('DB_PATH', ':memory:')
let tmp = Deno.makeTempDirSync({ prefix: 'tasks-sessions-' })
Deno.env.set('LOGS_DIR', `${tmp}/logs`)
Deno.env.set('WORKTREES_DIR', `${tmp}/worktrees`)
Deno.env.set('POLL_MS', '10') // tests wait on facts, never on the clock
Deno.env.set('STOP_GRACE_MS', '1000')

let { apply, db } = await import('./db.ts')
let {
  commented,
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

// The same curated list server.ts registers — the tests drive the wire.
on('session', { created: spawned(cast), removed: deleted })
on('stop_request', {
  created: stopped(cast),
  sweep: { pending: 'acted_at is null' },
})
on('comment', { created: commented(cast) })

// The relay's row fetch, as server.ts performs it at boot.
let pending = (comp: string, cond: string) =>
  db.prepare(`select * from ${comp} where ${cond}`).all() as Record<
    string,
    unknown
  >[]
let acted = (sr: string) =>
  (db.prepare('select acted_at from stop_request where eid = ?').get(sr) as {
    acted_at: string | null
  }).acted_at

// A graph write as the server performs it: apply, cast, dispatch. The
// returned promise is every effect the batch set off — a whole run, when
// the batch was a spawn.
let write = (changes: Change[]) => {
  let t = trace()
  let out = apply(db, changes, t)
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
let begin = (task: string, extra: Record<string, unknown> = {}) => {
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
  }])
  return { eid, done }
}

// A comment aimed at a session — the input path.
let say = (
  target: string,
  body: string,
  author = uid(),
  event: number | null = null,
) => {
  let c = uid()
  return [
    { eid: c, name: 'doc', comp: { title: '', body } },
    {
      eid: c,
      name: 'comment',
      comp: { target_eid: target, author_eid: author, event },
    },
  ]
}

// What the server said back on a session — refusals are event comments.
let refusals = (target: string) =>
  (db.prepare(
    `select d.body from comment c join doc d on d.eid = c.eid
     where c.target_eid = ? and c.event = 1`,
  ).all(target) as { body: string }[]).map((c) => c.body)

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

let until = async (fact: () => boolean, what = 'it') => {
  for (let i = 0; i < 400; i++) {
    if (fact()) return
    await new Promise((go) => setTimeout(go, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

let INIT = '{"type":"init","session_id":"sid-1","model":"fake-fast"}'
let RESULT =
  '{"type":"result","final_text":"first","usage":{"output_tokens":7}}'

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
  assertMatch(String(s.final_text), /^done: /)
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
  assert(!text.includes('House rules')) // the persona replaces CONTRACT
})

Deno.test('a child that exits nonzero failed, whatever it said', async () => {
  let { t } = seed('fail:3')
  let { eid, done } = begin(t)
  await done
  assertEquals(row(eid)?.status, 'failed') // it printed a result anyway
  assertEquals(row(eid)?.exit_code, 3)
})

// The settle broadcast: whoever holds the task hears the ending on the
// bus, because the ending IS a comment on the task, authored by the
// session — cast like any wire write, exactly once per settle.
let settleComments = (task: string, author: string) =>
  (db.prepare(
    `select d.body from comment c join doc d on d.eid = c.eid
     where c.target_eid = ? and c.author_eid = ?`,
  ).all(task, author) as { body: string }[]).map((c) => c.body)

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

Deno.test('a failed spawn tells the task too — and only once', async () => {
  let { t } = seed()
  let { eid, done } = begin(t, { model: 'no-such-model' })
  await done
  assertEquals(row(eid)?.status, 'failed')
  let said = settleComments(t, eid)
  assertEquals(said.length, 1)
  assertMatch(said[0], /^S-\d+ failed\n/)
  assertMatch(said[0], /unknown model/)
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
  let sr = uid()
  await write([{ eid: sr, name: 'stop_request', comp: { target_eid: eid } }])
  let s = row(eid)!
  assertEquals(s.status, 'interrupted') // never stamped before the exit
  assert(s.stop_requested_at)
  assertEquals(s.exit_code, 143) // SIGTERM, from a child that was ours
  // The request stays as audit, stamped when the signals had been sent.
  let sat = db.prepare('select acted_at from stop_request where eid = ?')
    .get(sr) as { acted_at: string | null }
  assert(sat.acted_at)
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
  await relay(pending)
  assert(acted(sr)) // nothing to stop IS acted
  let s = row(eid)!
  assertEquals(s.status, 'completed') // never re-stamped, never 'lost'
  assertEquals(s.exit_code, 0)
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

Deno.test('bad lines are diagnosed, and the ending is the FIRST one', async () => {
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
  assertEquals(s.status, 'failed') // a log with holes is not a clean run
  assertEquals(s.final_text, 'first') // the late result never lands
  assertEquals(s.latest_seq, 5) // every line counted, none skipped
  assertMatch(String(s.error), /line 2: malformed/)
  assertMatch(String(s.error), /line 4: oversized/)
  assertMatch(String(s.error), /line 5: output after the terminal event/)
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
  let f = Deno.openSync(log(eid), { append: true, write: true })
  f.writeSync(new TextEncoder().encode(
    '{"type":"message","text":"a"}\n{"type":"message","text":"b"}\n',
  ))
  await until(() => row(eid)?.latest_seq == 3, 'the counted lines')
  assertEquals(heard.filter((c) => c.name == 'session'), [])

  // The terminal event is news — it rides the wire, counter and all.
  f.writeSync(new TextEncoder().encode(`${RESULT}\n`))
  f.close()
  await until(() => row(eid)?.final_text == 'first', 'the terminal event')
  assert(heard.some((c) => c.name == 'session' && c.comp?.latest_seq == 4))

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
  // a machine event is news, not words to wake on — no resume, no refusal
  let evented = plant([INIT])
  db.prepare("update session set status = 'completed' where eid = ?")
    .run(evented)
  await write(say(evented, 'S-1 completed · exit 0', uid(), 1))
  assertEquals(row(evented)?.status, 'completed')
  assertEquals(refusals(evented).length, 1) // only the event we wrote
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
  await write(say(eid, 'note to self', eid)) // the author IS the session
  assertEquals(row(eid)?.status, 'completed')
  assertEquals(row(eid)?.latest_seq, before) // the log never heard it
})

Deno.test('words said mid-turn wait, and the settle delivers them', async () => {
  let { t } = seed()
  let { eid, done } = begin(t)
  await done
  // The resume dawdles (delay: the fake reads stage directions), long
  // enough for more words to land while the door says busy.
  let resumed = write(say(eid, 'delay:200 keep going'))
  assertEquals(row(eid)?.status, 'running')
  let while1 = say(eid, 'also: rename it')
  let while2 = say(eid, 'and: green gate')
  await write(while1)
  await write(while2)
  // Mid-turn nobody took them: the effect stayed out, nothing stamped —
  // owed, not lost.
  assertEquals(told(while1[1].eid), false)
  assertEquals(row(eid)?.status, 'running')
  await resumed
  // The settle flushed the backlog as one more resume: both delivered,
  // both stamped, and the session settles clean again.
  await until(
    () =>
      told(while1[1].eid) && told(while2[1].eid) &&
      row(eid)?.status == 'completed',
    'the settle flush to deliver',
  )
  let events = Deno.readTextFileSync(log(eid)).split('\n').filter(Boolean)
    .map((l) => JSON.parse(l) as { type: string; text?: string })
  // Each message joined the log as its own say, in the order it was said…
  assertEquals(
    events.filter((e) => e.type == 'session.input').map((e) => e.text),
    ['delay:200 keep going', 'also: rename it', 'and: green gate'],
  )
  // …and ONE continuation carried both (the fake echoes its instruction).
  assert(
    events.some((e) => e.text == 'working: also: rename it\n\nand: green gate'),
  )
})

Deno.test('a failed run stays down, but the next word carries the backlog', async () => {
  let { t } = seed()
  let { eid, done } = begin(t)
  await done
  let crashed = write(say(eid, 'delay:200 fail:3 then crash'))
  assertEquals(row(eid)?.status, 'running')
  let missed = say(eid, 'you okay?')
  await write(missed) // mid-turn: owed
  await crashed
  assertEquals(row(eid)?.status, 'failed') // no flush — a broken run stays down
  assertEquals(told(missed[1].eid), false)
  await write(say(eid, 'wake up'))
  await until(() => row(eid)?.status == 'completed', 'the woken run to settle')
  assertEquals(told(missed[1].eid), true) // the wake carried the backlog
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
  // a: its branch tip IS the base tip, tree clean — worktree and branch go,
  // the row sheds both, and the shed rides the cast
  assertThrows(() => Deno.statSync(treeA))
  assertEquals(row(a.eid)?.cwd, null)
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

Deno.test('a comment after the sweep regrows the worktree and resumes', async () => {
  let { p, t } = seed()
  let { eid, done } = begin(t)
  await done
  let tree = String(row(eid)!.cwd), branch = String(row(eid)!.branch)
  await tidy(cast) // merged and clean: swept, the row shed cwd and branch
  assertEquals(row(eid)?.cwd, null)
  let resumed = write(say(eid, 'one more thing'))
  await until(() => row(eid)?.status == 'running', 'the regrown resume')
  assertEquals(row(eid)?.cwd, tree) // the SAME path — the thread lives there
  assertEquals(row(eid)?.branch, branch)
  assert(Deno.statSync(tree).isDirectory)
  await resumed
  assertEquals(row(eid)?.status, 'completed') // the continuation settled
  assertEquals(refusals(eid), [])
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
  message: { content: [{ type: 'text', text: 'hello from a tty' }] },
})

Deno.test("external session logs read each provider's confined transcript", async () => {
  let c = await fakeClaude()
  let { eid, path } = announce(c.pid, [SAID])
  assertEquals(logs(eid, new URLSearchParams()).entries[0].row, {
    kind: 'say',
    role: 'agent',
    text: 'hello from a tty',
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
