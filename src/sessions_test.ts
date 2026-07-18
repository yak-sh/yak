// The managed-session lifecycle against a :memory: db, a temp log dir, and
// a scratch git repo: what start refuses, what a fake provider's run leaves
// in the row, what the file teaches the tailer, how a stop ends, and what
// boot makes of children that outlived the server. Real children only where
// only a real child will do — everything else is written to the log file
// the tailer reads, because that file IS the log.
// Static imports for the two that hold no db handle (assert must be static:
// an assertion function only narrows when it's declared, not destructured);
// db.ts and sessions.ts come in dynamically, AFTER the env below points them
// at :memory: and the temp dirs.
import { assert, assertEquals, assertMatch } from '@std/assert'
import { type Change } from './types.ts'

Deno.env.set('DB_PATH', ':memory:')
let tmp = Deno.makeTempDirSync({ prefix: 'tasks-sessions-' })
Deno.env.set('LOGS_DIR', `${tmp}/logs`)
Deno.env.set('WORKTREES_DIR', `${tmp}/worktrees`)
Deno.env.set('POLL_MS', '10') // tests wait on facts, never on the clock
Deno.env.set('STOP_GRACE_MS', '1000')

let { apply, db } = await import('./db.ts')
let { input, logs, logsDir, recover, running, start, stop } = await import(
  './sessions.ts'
)

let uid = () => crypto.randomUUID()
let heard: Change[] = []
let cast = (c: Change[]) => heard.push(...c)
let row = (eid: string) =>
  db.prepare('select * from session where eid = ?').get(eid) as
    | Record<string, string | number | null>
    | undefined

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

// project(+repo) → task: the graph start() reads its workspace from.
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

let job = (t: string) => ({ task_eid: t, provider: 'fake', model: 'fake-fast' })

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

Deno.test('start refuses anything it cannot trust', () => {
  let { t } = seed()
  let no = seed('', null) // a project with no repo comp
  let cases: [Record<string, unknown>, string][] = [
    [{ ...job(t), provider: 'oracle' }, 'unknown provider'],
    [{ ...job(t), model: 'gpt-9' }, 'unknown model'],
    [{ ...job(t), effort: 'heroic' }, 'unknown effort'],
    [{ ...job(uid()) }, 'no such task'],
    [{ ...job(no.t) }, 'no repo'],
    [{ ...job(t), canvas_eid: uid() }, 'no such canvas'],
  ]
  for (let [input, says] of cases) {
    let r = start(input, cast)
    assert('error' in r, `${JSON.stringify(input)} should have been refused`)
    assertMatch(r.error, new RegExp(says))
  }
})

Deno.test('a fake session runs end to end', async () => {
  let { t } = seed('noise') // tell the fake to write to stderr too
  let canvas = uid()
  apply(db, [{ eid: canvas, name: 'canvas', comp: {} }])
  heard = []
  let r = start(
    {
      ...job(t),
      effort: 'low',
      canvas_eid: canvas,
      position: { x: 10, y: 20 },
    },
    cast,
  )
  assert('eid' in r)
  // Visible BEFORE any fs or process work: the session and its card are
  // already on the wire while the status is still 'starting'.
  assert(heard.some((c) => c.eid == r.eid && c.name == 'session'))
  assertEquals(heard.find((c) => c.name == 'pin')?.comp?.canvas_eid, canvas)
  assertEquals(heard.find((c) => c.name == 'card')?.comp?.view, 'Session')
  assertEquals(row(r.eid)?.status, 'starting')

  await r.done
  let s = row(r.eid)!
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
  let first = logs(r.eid, new URLSearchParams('after=0&limit=1')).entries[0]
  assertEquals(first.seq, 1)
  assertEquals(JSON.parse(first.line).type, 'session.prompt')
  assertMatch(JSON.parse(first.line).text, /T-\d+/)
  assertEquals(first.row?.kind, 'say')

  // The log reads back from the file, bounded, line number = seq.
  let page = logs(r.eid, new URLSearchParams('after=2&limit=2'))
  assertEquals(page.entries.map((e) => e.seq), [3, 4])
  assertEquals(JSON.parse(page.entries[0].line).type, 'message')
  assertEquals(logs(r.eid, new URLSearchParams('tail=1')).entries[0].seq, 5)
  assertEquals(logs(r.eid, new URLSearchParams('after=99')).entries, [])
  assertMatch(String(page.stderr), /stderr noise/) // diagnostics, unordered
})

Deno.test('a child that exits nonzero failed, whatever it said', async () => {
  let { t } = seed('fail:3')
  let r = start(job(t), cast)
  assert('eid' in r)
  await r.done
  assertEquals(row(r.eid)?.status, 'failed') // it printed a result anyway
  assertEquals(row(r.eid)?.exit_code, 3)
})

Deno.test('stop: the group is signalled, the ending is OBSERVED', async () => {
  let { t } = seed('delay:9000')
  let r = start(job(t), cast)
  assert('eid' in r)
  await until(() => row(r.eid)?.status == 'running', 'the init event')
  let out = await stop(r.eid, cast)
  assert(!('error' in out))
  let s = row(r.eid)!
  assertEquals(s.status, 'interrupted') // never stamped before the exit
  assert(s.stop_requested_at)
  assertEquals(s.exit_code, 143) // SIGTERM, from a child that was ours
  await r.done
  assertEquals(await stop(r.eid, cast), {
    error: 'session is interrupted',
    status: 400,
  })
})

Deno.test('stop refuses sessions that are not ours to end', async () => {
  let ext = uid()
  apply(db, [{ eid: ext, name: 'session', comp: { id: 'announced' } }])
  assertEquals(await stop(ext, cast), {
    error: 'not a managed session',
    status: 400,
  })
  let gone = await stop(uid(), cast)
  assert('error' in gone && gone.status == 404)
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

Deno.test('boot: a session whose provider is gone fails loudly', () => {
  let eid = plant([INIT], 'oracle')
  recover(cast)
  assertEquals(row(eid)?.status, 'failed')
  assertMatch(String(row(eid)?.error), /no adapter/)
})

Deno.test('input: refused unless settled with a thread to resume', () => {
  // no such session
  let gone = input(uid(), 'hi', cast)
  assert('error' in gone && gone.status == 404)
  // active: the fake started but hasn't reached its provider id yet
  let active = plant([INIT]) // status 'running'
  db.prepare('update session set provider_session_id = ? where eid = ?')
    .run('sid-1', active)
  assertEquals(input(active, 'hi', cast), {
    error: 'session is running — wait for it to settle',
    status: 400,
  })
  // settled but never announced a provider thread
  let settled = plant([INIT])
  db.prepare("update session set status = 'completed' where eid = ?")
    .run(settled)
  let refused = input(settled, 'hi', cast)
  assert('error' in refused)
  assertMatch(refused.error, /no provider thread/)
})

Deno.test('input: the human line joins the log, seq continues, run resumes', async () => {
  // A real end-to-end run leaves a settled session with a worktree + thread.
  let { t } = seed()
  let r = start(job(t), cast)
  assert('eid' in r)
  await r.done
  assertEquals(row(r.eid)?.status, 'completed')
  let before = row(r.eid)!.latest_seq as number

  heard = []
  let inp = input(r.eid, 'and one more thing', cast)
  assert('eid' in inp, JSON.stringify(inp))
  // Flipped running on the wire, straight away.
  assertEquals(row(r.eid)?.status, 'running')
  assertEquals(row(r.eid)?.finished_at, null)
  assert(heard.some((c) => c.name == 'session' && c.comp?.status == 'running'))
  // The synthetic line is now in the file, as the next seq, a user say.
  let page = logs(r.eid, new URLSearchParams(`after=${before}&limit=1`))
  assertEquals(page.entries[0].seq, before + 1)
  assertEquals(JSON.parse(page.entries[0].line).type, 'session.input')
  assertEquals(page.entries[0].row, {
    kind: 'say',
    role: 'user',
    text: 'and one more thing',
  })

  // The continuation appends and the tailer settles it again — seq only grew.
  await inp.done
  assertEquals(row(r.eid)?.status, 'completed')
  assert((row(r.eid)!.latest_seq as number) > before + 1)
})
