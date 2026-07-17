// Managed sessions: spawn an agent on a task, in its own git worktree, and
// keep its session row honest while it runs. Server-only.
//
// Three ideas hold the whole thing up:
//
// 1. THE FILE IS THE LOG. The child's stdout lands in
//    ~/.tasks/logs/<eid>.jsonl and that file — not a table, not a queue —
//    is the durable, ordered store: line number IS seq, so there's nothing
//    to allocate, nothing to ingest, and nothing to drift. stderr goes to
//    <eid>.stderr.log, unordered diagnostics served alongside; we never
//    interleave it into the log's seqs and invent a causality we didn't
//    observe.
// 2. THE CHILD OUTLIVES US. It's spawned through setsid, in its own session
//    and process group, so the dev watcher restarting this process (which
//    it does on every server-file edit) neither kills it nor loses it: the
//    pidfile and the log file are enough to adopt it back at boot. Nothing
//    here reaps children.
// 3. ONE WRITER. Every summary column goes through stamp(): row first, then
//    the full session comp down the same cast() path apply()'s return
//    takes — server-constructed, post-commit, so every cache hears the
//    truth exactly once and none of it ever rode the wire inbound.
import { basename, dirname } from 'node:path'
import { type Adapter, adapters, type Event, type Summary } from './adapters.ts'
import { apply, db } from './db.ts'
import { type Change, sessionActive } from './types.ts'

type Cast = (changes: Change[]) => void
type Row = Record<string, unknown>

// Dirs are read per call, not at import: tests point them at a temp dir.
export let logsDir = () => Deno.env.get('LOGS_DIR') ?? home('logs')
let worktreesDir = () => Deno.env.get('WORKTREES_DIR') ?? home('worktrees')
let home = (d: string) => `${Deno.env.get('HOME')}/.tasks/${d}`
let logFile = (eid: string) => `${logsDir()}/${eid}.jsonl`
let errFile = (eid: string) => `${logsDir()}/${eid}.stderr.log`
let pidFile = (eid: string) => `${logsDir()}/${eid}.pid`

let poll = () => Number(Deno.env.get('POLL_MS') ?? 300)
let grace = () => Number(Deno.env.get('STOP_GRACE_MS') ?? 5000)
let sleep = (ms: number) => new Promise((go) => setTimeout(go, ms))
let now = () => new Date().toISOString()

// A line past this is a runaway, not an event: diagnosed, never parsed.
let MAX_LINE = 1_000_000

// ---- the one writer ----

let castRow = (eid: string, cast: Cast) => {
  let row = db.prepare('select * from session where eid = ?').get(eid) as
    | Row
    | undefined
  if (row) cast([{ eid, name: 'session', comp: row }])
}

// Update summary columns and tell everyone. A deleted session updates
// nothing and says nothing — the tombstone wins, as everywhere else.
let stamp = (eid: string, patch: Summary, cast: Cast) => {
  let cols = Object.keys(patch)
  if (!cols.length) return
  let vals = cols.map((c) => (patch as Row)[c] as string | number | null)
  db.prepare(
    `update session set ${cols.map((c) => `${c} = ?`).join(', ')}
     where eid = ?`,
  ).run(...vals, eid)
  castRow(eid, cast)
}

// ---- following the file ----

// Where a tailer is in the file and what it has learned. `at` is a BYTE
// offset (resume is a seek, not a re-read) and seq the line count.
type Tail = { at: number; seq: number; ended: boolean; errs: string[] }

// Read the complete lines written since `t.at`. A half-written tail stays
// unread until its newline lands — so no line is ever seen twice, split in
// two, or torn through a multi-byte character.
let readLines = (path: string, t: Tail) => {
  let f
  try {
    f = Deno.openSync(path, { read: true })
  } catch {
    return [] // nothing written yet
  }
  try {
    let size = f.statSync().size
    if (size <= t.at) return []
    f.seekSync(t.at, Deno.SeekMode.Start)
    let buf = new Uint8Array(size - t.at)
    let n = 0
    for (;;) {
      let r = f.readSync(buf.subarray(n))
      if (!r) break
      n += r
    }
    let cut = buf.subarray(0, n).lastIndexOf(10) // \n
    if (cut < 0) return []
    t.at += cut + 1
    return new TextDecoder().decode(buf.subarray(0, cut)).split('\n')
  } finally {
    f.close()
  }
}

// One pass over the new lines: count them, ask the adapter what they mean,
// stamp what we learned. Everything the adapter doesn't recognize is just
// log — it lives in the file, not in the summary.
let drain = (eid: string, ad: Adapter, t: Tail, cast: Cast) => {
  let lines = readLines(logFile(eid), t)
  if (!lines.length) return
  let patch: Summary = {}
  for (let line of lines) {
    t.seq++
    if (!line.trim()) continue // a blank line is a line, not a fault
    if (line.length > MAX_LINE) {
      t.errs.push(`line ${t.seq}: oversized (${line.length} bytes)`)
      continue
    }
    let e: Event
    try {
      e = JSON.parse(line)
    } catch {
      t.errs.push(`line ${t.seq}: malformed`)
      continue
    }
    // The terminal event is the last word: an agent that keeps talking
    // after it doesn't get to rewrite its own ending, but the noise is
    // diagnosed rather than swallowed.
    if (t.ended) {
      if (!t.errs.some((x) => x.includes('after the terminal'))) {
        t.errs.push(`line ${t.seq}: output after the terminal event`)
      }
      continue
    }
    Object.assign(patch, ad.init(e) ?? {})
    let end = ad.terminal(e)
    if (end) {
      Object.assign(patch, end)
      t.ended = true
    }
  }
  patch.latest_seq = t.seq
  if (t.errs.length) patch.error = diagnosis(t)
  stamp(eid, patch, cast)
}

let diagnosis = (t: Tail) => t.errs.join('; ').slice(0, 2000)

// A running (or adopted) child: enough to follow it, wait for it, and know
// how it ended. `code` is null for a child we didn't spawn — an adopted
// process's exit status is nobody's to read.
type Run = {
  pid: number
  exit: () => boolean | Promise<boolean>
  code: () => number | null
  why: string | null // why the code is unknowable
  done: Promise<void>
}
export let running = new Map<string, Run>()

// The tailer: follow the file until the child is gone, then one LAST pass
// (the bytes it wrote on its way out are the important ones) and finalize.
let follow = async (eid: string, ad: Adapter, cast: Cast) => {
  let run = running.get(eid)!
  let t: Tail = { at: 0, seq: 0, ended: false, errs: [] }
  for (;;) {
    let last = await run.exit()
    drain(eid, ad, t, cast)
    if (last) break
    await sleep(poll())
  }
  finish(eid, t, run, cast)
}

// The ending, derived rather than announced: a clean exit that reached the
// provider's terminal event with nothing malformed on the way is the only
// way to complete. A stop we asked for and then OBSERVED is interrupted —
// stop() never stamps that itself, because a signal sent is not a process
// ended.
let finish = (eid: string, t: Tail, run: Run, cast: Cast) => {
  let row = db.prepare('select stop_requested_at from session where eid = ?')
    .get(eid) as { stop_requested_at: string | null } | undefined
  if (!row) return // deleted mid-run
  let code = run.code()
  let ok = t.ended && !t.errs.length && (code ?? 0) == 0
  stamp(eid, {
    status: row.stop_requested_at ? 'interrupted' : ok ? 'completed' : 'failed',
    exit_code: code,
    stop_reason: code == null ? run.why : null,
    finished_at: now(),
    latest_seq: t.seq,
    ...(t.errs.length ? { error: diagnosis(t) } : {}),
  }, cast)
  running.delete(eid)
  try {
    Deno.removeSync(pidFile(eid)) // terminal: nothing left to adopt
  } catch { /* never written, or already gone */ }
}

// ---- reading the log back ----

let clip = (s: string) => s.length > 64_000 ? `${s.slice(0, 64_000)}…` : s

// The log, bounded: `after=N` reads forward from seq N, `tail=N` reads the
// last N lines, limit clamps at 500 either way. stderr rides along whole
// (its tail, anyway) — unordered diagnostics, plainly labelled as such.
// v0 reads the file per request; when logs get big this is where a seq→
// offset index goes.
export let logs = (eid: string, q: URLSearchParams) => {
  let text = ''
  try {
    text = Deno.readTextFileSync(logFile(eid))
  } catch { /* no log yet: an empty log is not an error */ }
  let lines = text.split('\n')
  if (lines.at(-1) == '') lines.pop() // the trailing newline isn't a line
  let limit = Math.min(Math.max(Number(q.get('limit') ?? 100) || 100, 1), 500)
  let tail = Number(q.get('tail') ?? 0)
  let from = tail > 0
    ? Math.max(0, lines.length - Math.min(tail, limit))
    : Math.max(0, Number(q.get('after') ?? 0))
  let entries = lines.slice(from, from + limit)
    .map((line, i) => ({ seq: from + i + 1, line: clip(line) }))
  let err = errTail(eid)
  return { entries, ...(err ? { stderr: err } : {}) }
}

let errTail = (eid: string) => {
  try {
    let text = Deno.readTextFileSync(errFile(eid))
    return text.length > 8192 ? text.slice(-8192) : text
  } catch {
    return ''
  }
}

// ---- spawning ----

// The child outlives this process (setsid detaches it, --watch restarts
// us), so after a restart it isn't our child any more and waitpid is out
// of reach: `kill -0` is the only liveness we have. The signal goes to the
// process GROUP (-pid) — an agent's own children die with it.
let alive = async (pid: number) =>
  (await new Deno.Command('kill', {
    args: ['-0', String(pid)],
    stdout: 'null',
    stderr: 'null',
  }).output()).success

let pidOf = (eid: string) => {
  try {
    let n = Number(Deno.readTextFileSync(pidFile(eid)).trim())
    return n > 0 ? n : null
  } catch {
    return null
  }
}

let git = async (cwd: string, args: string[]) => {
  let out = await new Deno.Command('git', {
    args,
    cwd,
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!out.success) {
    throw new Error(
      `git ${args[0]}: ${new TextDecoder().decode(out.stderr).trim()}`,
    )
  }
  return new TextDecoder().decode(out.stdout).trim()
}

// setsid puts the child in a NEW session and process group; it execs in
// place (it only forks when it's already a group leader, which a spawned
// child isn't), so our direct child IS the agent — same pid as the
// pidfile, and its exit code is ours to read while we live. sh does the
// redirection Deno.Command can't: stdout and stderr straight into the
// files, no pipe for us to pump and nothing to lose when we restart.
let spawn = (
  eid: string,
  argv: string[],
  cwd: string,
  env: Record<string, string>,
) => {
  let child = new Deno.Command('setsid', {
    args: [
      'sh',
      '-c',
      'exec "$@" >> "$TASKS_LOG" 2>> "$TASKS_ERR"',
      'sh',
      ...argv,
    ],
    cwd,
    clearEnv: true,
    env: { ...env, TASKS_LOG: logFile(eid), TASKS_ERR: errFile(eid) },
    stdin: 'null',
    stdout: 'null',
    stderr: 'null',
  }).spawn()
  // unref, or Deno kills the child on --watch reload (setsid is no shield —
  // the runtime signals the exact pid it tracks). status still resolves
  // while we live; after a reload the pidfile is how we find it again.
  child.unref()
  return child
}

// ---- start ----

export type StartInput = {
  task_eid?: string
  provider?: string
  model?: string
  effort?: string
  persona_eid?: string
  canvas_eid?: string
  position?: { x?: number; y?: number; w?: number }
}

let bad = (error: string, status = 400) => ({ error, status })

// POST /sessions/start. The session (and its card, if it was started onto
// a canvas) is minted and broadcast BEFORE any filesystem or process work,
// so the run is visible from its first moment and every way it can fail is
// a failed Session on the board rather than a toast nobody kept.
export let start = (input: StartInput, cast: Cast) => {
  let ad = adapters[String(input.provider)]
  if (!ad) return bad(`unknown provider: ${input.provider}`)
  let model = String(input.model)
  if (!ad.models.includes(model)) return bad(`unknown model: ${input.model}`)
  if (input.effort && !ad.efforts.includes(input.effort)) {
    return bad(`unknown effort: ${input.effort}`)
  }
  let task = db.prepare(`
    select t.project_eid, e.num, d.title, d.body from task t
    join entity e on e.eid = t.eid
    left join doc d on d.eid = t.eid
    where t.eid = ?
  `).get(String(input.task_eid)) as
    | { project_eid: string | null; num: number; title: string; body: string }
    | undefined
  if (!task) return bad(`no such task: ${input.task_eid}`)
  // The workspace comes from the GRAPH, never the request: the task's
  // project says which checkout, and that's the only path we'll run in.
  let repo = task.project_eid
    ? db.prepare('select path, base_branch from repo where eid = ?')
      .get(task.project_eid) as
        | { path: string; base_branch: string }
        | undefined
    : undefined
  if (!repo) return bad("the task's project has no repo — set repo.path first")
  if (
    input.canvas_eid &&
    !db.prepare('select 1 from entity where eid = ?').get(input.canvas_eid)
  ) return bad(`no such canvas: ${input.canvas_eid}`)
  let persona = input.persona_eid
    ? db.prepare('select body from doc where eid = ?').get(input.persona_eid) as
      | { body: string }
      | undefined
    : undefined

  let eid = crypto.randomUUID()
  let id = crypto.randomUUID()
  let born = apply(db, [
    { eid, name: 'session', comp: { id } },
    ...(input.canvas_eid ? card(eid, input.canvas_eid, input.position) : []),
  ])
  cast(born)
  let num = Number(
    born.find((c) => c.eid == eid && c.name == 'entity')?.comp?.num,
  )
  let sid = `S-${num}`
  let tree = `${worktreesDir()}/${basename(repo.path)}/${sid}`
  stamp(eid, {
    origin: 'managed',
    status: 'starting',
    provider: String(input.provider),
    model,
    effort: input.effort ?? null,
    persona_eid: input.persona_eid ?? null,
    requested_task_eid: String(input.task_eid),
    branch: `session/${sid}`,
    cwd: tree,
    started_at: now(),
  }, cast)
  let instruction = [persona?.body, `T-${task.num}: ${task.title}`, task.body]
    .filter(Boolean).join('\n\n')
  // The fs and the child are the SLOW half: hand back the session now, let
  // it fail (visibly) on its own time. `done` is the whole run, for callers
  // that want to await it (tests) — the route doesn't.
  let done = launch(eid, ad, {
    instruction,
    session_id: id,
    task: `T-${task.num}`,
    repo,
    tree,
    branch: `session/${sid}`,
    model,
    effort: input.effort,
  }, cast)
  return { eid, done }
}

// The card+pin a canvas start lands: the same two changes the browser
// builds when it spawns a card, minted here so the session shows up where
// it was asked for.
let card = (
  target: string,
  canvas_eid: string,
  at: StartInput['position'],
): Change[] => {
  let eid = crypto.randomUUID()
  let { z } = db.prepare(
    'select coalesce(max(z), 0) + 1 as z from pin where canvas_eid = ?',
  ).get(canvas_eid) as { z: number }
  return [
    { eid, name: 'card', comp: { target_eid: target, view: 'Session' } },
    {
      eid,
      name: 'pin',
      comp: {
        canvas_eid,
        x: Math.round(at?.x ?? 0),
        y: Math.round(at?.y ?? 0),
        w: Math.round(at?.w ?? 420),
        h: 0,
        z,
      },
    },
  ]
}

type Launch = {
  instruction: string
  session_id: string
  task: string
  repo: { path: string; base_branch: string }
  tree: string
  branch: string
  model: string
  effort?: string
}

// Worktree, then child, then tailer. Every failure lands in the same
// place: a failed session that says why.
let launch = async (eid: string, ad: Adapter, j: Launch, cast: Cast) => {
  try {
    Deno.mkdirSync(dirname(j.tree), { recursive: true })
    Deno.mkdirSync(logsDir(), { recursive: true })
    await git(j.repo.path, [
      'worktree',
      'add',
      j.tree,
      '-b',
      j.branch,
      j.repo.base_branch,
    ])
    stamp(
      eid,
      { base_revision: await git(j.tree, ['rev-parse', 'HEAD']) },
      cast,
    )
    // A minimal env by allowlist: the child gets what a program needs to
    // run, plus its own coordinates. Nothing of this server's environment
    // rides along by accident.
    let child = spawn(eid, ad.argv(j), j.tree, {
      PATH: Deno.env.get('PATH') ?? '',
      HOME: Deno.env.get('HOME') ?? '',
      TERM: Deno.env.get('TERM') ?? 'dumb',
      TASKS_TASK: j.task,
      TASKS_SESSION: j.session_id,
    })
    Deno.writeTextFileSync(pidFile(eid), String(child.pid))
    let code: number | null = null
    let gone = false
    child.status.then((s) => {
      code = s.code
      gone = true
    })
    let run: Run = {
      pid: child.pid,
      exit: () => gone,
      code: () => code,
      why: null,
      done: Promise.resolve(),
    }
    running.set(eid, run)
    run.done = follow(eid, ad, cast)
    await run.done
  } catch (e) {
    running.delete(eid)
    stamp(eid, {
      status: 'failed',
      error: String(e).slice(0, 2000),
      finished_at: now(),
    }, cast)
  }
}

// ---- stop ----

// POST /sessions/:eid/stop. Ask the process group to go, escalate once,
// and let the tailer stamp the ending when it SEES the exit — a session
// we can't watch die is `lost`, said plainly, not assumed dead.
export let stop = async (eid: string, cast: Cast) => {
  let row = db.prepare('select origin, status from session where eid = ?')
    .get(eid) as { origin: string; status: string | null } | undefined
  if (!row) return bad(`no such session: ${eid}`, 404)
  if (row.origin != 'managed') return bad('not a managed session')
  if (!sessionActive.includes(String(row.status))) {
    return bad(`session is ${row.status ?? 'external'}`)
  }
  // The guard IS the CAS: two stops race, one writes.
  let hit = db.prepare(`
    update session set status = 'stopping', stop_requested_at = ?
    where eid = ? and status in ('starting', 'running')
  `).run(now(), eid).changes
  if (!hit) return bad('already stopping')
  castRow(eid, cast)
  let pid = running.get(eid)?.pid ?? pidOf(eid)
  if (!pid) {
    stamp(eid, {
      status: 'lost',
      stop_reason: 'no pid: the child was never spawned or its pidfile is gone',
      finished_at: now(),
    }, cast)
    return { ok: true }
  }
  let signal = (sig: Deno.Signal) => {
    try {
      Deno.kill(-pid, sig) // the GROUP: an agent's own children go too
    } catch { /* already gone — the wait below is the truth */ }
  }
  signal('SIGTERM')
  if (!await departed(eid, pid, grace())) {
    signal('SIGKILL')
    if (!await departed(eid, pid, grace())) {
      stamp(eid, {
        status: 'lost',
        stop_reason: `pid ${pid} outlived SIGKILL`,
        finished_at: now(),
      }, cast)
      return { ok: true }
    }
  }
  await running.get(eid)?.done // the tailer stamps the ending
  return { ok: true }
}

// Wait (bounded) for a pid to be gone — through its own run when we have
// one, since a direct child is a zombie until Deno reaps it.
let departed = async (eid: string, pid: number, ms: number) => {
  let run = running.get(eid)
  let deadline = Date.now() + ms
  for (;;) {
    if (run ? await run.exit() : !await alive(pid)) return true
    if (Date.now() >= deadline) return false
    await sleep(poll())
  }
}

// ---- boot ----

// Our children outlive us on purpose, so booting means looking at every
// managed session that was still going and asking the pid: alive → adopt
// it and tail its file from byte 0 (recomputing seq from the file is
// cheap, and the file is the truth); dead → one pass over what it left
// behind and an ending derived from that. Called from server.ts, not
// open(): db.ts stays pure.
export let recover = (cast: Cast) => {
  let rows = db.prepare(`
    select eid, provider from session
    where origin = 'managed' and status in ('starting', 'running', 'stopping')
  `).all() as { eid: string; provider: string | null }[]
  for (let { eid, provider } of rows) {
    let ad = adapters[String(provider)]
    if (!ad) {
      stamp(eid, {
        status: 'failed',
        error: `no adapter for provider ${provider}`,
        finished_at: now(),
      }, cast)
      continue
    }
    let pid = pidOf(eid)
    let run: Run = {
      pid: pid ?? 0,
      exit: () => pid == null ? true : alive(pid).then((a) => !a),
      code: () => null, // never ours to read: we didn't spawn it
      why: 'exit unobserved: the child outlived the server',
      done: Promise.resolve(),
    }
    running.set(eid, run)
    run.done = follow(eid, ad, cast)
  }
  return rows.map((r) => r.eid)
}
