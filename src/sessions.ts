// Managed sessions: spawn an agent on a task, in its own git worktree, and
// keep its session row honest while it runs. Server-only. Everything here
// enters through the GRAPH, not routes: a session created carrying a
// provider is the spawn request, a stop_request is the brake, a comment
// aimed at a settled session resumes it, a deleted session takes its
// process with it. server.ts registers those handlers on the effects
// registry (effects.ts); the only HTTP left is reading the log back.
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
// 2. THE CHILD OUTLIVES US — two escapes deep. The pid the runtime tracks
//    is a launcher that backgrounds a setsid sh wrapper and exits at birth,
//    so the dev watcher restarting this process (every server-file edit,
//    and it KILLS tracked pids) finds nothing left to kill. And the wrapper
//    runs inside its OWN systemd user scope (user-<uid>.slice), OUT of
//    tasksd's cgroup — else a full unit restart mass-kills that cgroup and
//    takes every agent with it, which no KillMode prevents (T-7127). The
//    orphaned wrapper runs the agent in its own session and group, outlives
//    every reload AND every restart, and reports the exit code when the
//    agent goes; the pidfile and the log file are enough to adopt the agent
//    back at boot. Nothing here reaps children.
// 3. ONE WRITER. Every summary column goes through stamp(): row first, then
//    the full session comp down the same cast() path apply()'s return
//    takes — server-constructed, post-commit, so every cache hears the
//    truth exactly once and none of it ever rode the wire inbound.
import { basename, dirname } from 'node:path'
import { type Adapter, adapters, type Event, type Summary } from './adapters.ts'
import { apply, db, snapshot } from './db.ts'
import { listening } from './door.ts'
import { dispatch, trace } from './effects.ts'
import { lapseChanges, rows } from './client.ts'
import { materialize } from './persona.ts'
import { type Change, type LogRow, sessionActive } from './types.ts'

type Cast = (changes: Change[]) => void
type Row = Record<string, unknown>

// Dirs are read per call, not at import: tests point them at a temp dir.
export let logsDir = () => Deno.env.get('LOGS_DIR') ?? home('logs')
let worktreesDir = () => Deno.env.get('WORKTREES_DIR') ?? home('worktrees')
let home = (d: string) => `${Deno.env.get('HOME')}/.tasks/${d}`
let logFile = (eid: string) => `${logsDir()}/${eid}.jsonl`
let errFile = (eid: string) => `${logsDir()}/${eid}.stderr.log`
let pidFile = (eid: string) => `${logsDir()}/${eid}.pid`
let codeFile = (eid: string) => `${logsDir()}/${eid}.code`

// Claude Code's own transcript for a session — the path its SessionStart
// hook reported. It arrives over the WIRE like any other self-report, so
// it is a reference, not a capability: only Claude's project store is
// readable through it, or an unauthed /logs would become a file-read
// oracle for whatever a forged row named.
let transcriptOf = (eid: string) => {
  let p = String(
    (db.prepare('select transcript from session where eid = ?').get(eid) as
      | { transcript: string | null }
      | undefined)?.transcript ?? '',
  )
  let store = `${Deno.env.get('HOME')}/.claude/projects/`
  return p.startsWith(store) && p.endsWith('.jsonl') && !p.includes('..')
    ? p
    : undefined
}

// The dialect a session's log speaks. A managed run was ASKED for a
// provider, so it says which; anything carrying a transcript is Claude
// Code by construction — nothing else writes one. Derived rather than
// stamped, because `provider` is a spawn REQUEST column: a session
// created wearing one is an ask to launch an agent (spawned(), below),
// so writing it onto an operator's reify would turn every terminal into
// a failed spawn.
let dialectOf = (eid: string) => {
  let s = db.prepare('select provider, transcript from session where eid = ?')
    .get(eid) as { provider: string | null; transcript: string | null } | null
  return adapters[String(s?.provider)] ??
    (s?.transcript ? adapters.claude : undefined)
}

// The file that IS a session's log. Whoever owns the PROCESS owns its
// stdout: a run we spawned writes ours, and everything else — an
// operator's terminal claude — keeps Claude Code's transcript, which
// `claude --resume` appends to, so one file is the whole story either
// way. Origin is exactly the right question here (unlike liveness,
// door.ts): it names who forked the process.
let logOf = (eid: string) =>
  (db.prepare('select origin from session where eid = ?').get(eid) as
      | { origin: string }
      | undefined)?.origin == 'managed'
    ? logFile(eid)
    : transcriptOf(eid) ?? logFile(eid)

let poll = () => Number(Deno.env.get('POLL_MS') ?? 300)
let grace = () => Number(Deno.env.get('STOP_GRACE_MS') ?? 5000)
let sleep = (ms: number) => new Promise((go) => setTimeout(go, ms))
let now = () => new Date().toISOString()

// A line past this is a runaway, not an event: diagnosed, never parsed.
let MAX_LINE = 1_000_000

// ---- the one writer ----

let castRow = (eid: string, cast: Cast, table = 'session') => {
  let row = db.prepare(`select * from ${table} where eid = ?`).get(eid) as
    | Row
    | undefined
  if (row) cast([{ eid, name: table, comp: row }])
}

// Update summary columns and tell everyone. A deleted row updates
// nothing and says nothing — the tombstone wins, as everywhere else.
// Almost always the session row; a stop_request's acted_at goes through
// the same door.
let stamp = (
  eid: string,
  patch: Summary | Row,
  cast: Cast,
  table = 'session',
) => {
  let cols = Object.keys(patch)
  if (!cols.length) return
  // The settle broadcast hangs off the ONE WRITER: lifecycle columns
  // never cross apply(), so the effects dispatcher cannot see this
  // transition — the writer that stamps an ending is the only observer
  // there is. Prior row read first, so a re-stamp of the same ending
  // never says it twice.
  let was = db.prepare(`select * from ${table} where eid = ?`).get(eid) as
    | Row
    | undefined
  let ending = table == 'session' && SETTLED.includes(String(patch.status))
  let vals = cols.map((c) => (patch as Row)[c] as string | number | null)
  db.prepare(
    `update ${table} set ${cols.map((c) => `${c} = ?`).join(', ')}
     where eid = ?`,
  ).run(...vals, eid)
  // A busy agent's tail advances latest_seq every poll tick; a cast per
  // tick makes every client re-render the world for a counter nobody
  // shows, and a long run freezes every open canvas (T-7063). Only a
  // column whose value actually moved is worth telling everyone.
  if (cols.some((c) => c != 'latest_seq' && (patch as Row)[c] != was?.[c])) {
    castRow(eid, cast, table)
  }
  if (ending && was?.status != patch.status) {
    settled(eid, String(patch.status), cast)
  }
}

// A managed session is over in exactly these statuses — the moment one
// lands, whoever asked for the work deserves to hear it.
let SETTLED = ['completed', 'failed', 'interrupted', 'lost']

// The outcome, said on the TASK as an ordinary comment authored by the
// session — and the session's leases released with it, the same batch
// task wrap builds for an interactive end (lapseChanges, the one release
// truth): a dead session's claim must not outlive it and lock its task
// against every successor. Holders and watchers hear it on their next
// tool call (the comms bus), and the task's trail keeps the record.
// Graph data, so it rides apply()+cast+dispatch like any wire write —
// a direct db stamp would skip the journal and leave every client cache
// holding a ghost claim. Telling must never break the ending it reports,
// so a refusal is a warning, not a throw.
let settled = (eid: string, status: string, cast: Cast) => {
  let row = db.prepare('select * from session where eid = ?').get(eid) as
    | Row
    | undefined
  if (!row || row.origin != 'managed') return
  let all = rows(snapshot(db))
  let sess = all.find((r) => r.eid == eid)
  let changes: Change[] = sess ? lapseChanges(all, sess) : []
  let task = String(row.requested_task_eid ?? '')
  if (task && db.prepare('select 1 from task where eid = ?').get(task)) {
    let { num } = db.prepare('select num from entity where eid = ?').get(
      eid,
    ) as { num: number }
    let gist = String(row.final_text ?? '').replace(/\s+/g, ' ').trim()
      .slice(0, 240)
    let body = [
      `S-${num} ${status}${
        row.exit_code == null ? '' : ` · exit ${row.exit_code}`
      }`,
      ...(row.error ? [`error: ${String(row.error).slice(0, 240)}`] : []),
      ...(gist ? [gist] : []),
    ].join('\n')
    let cid = crypto.randomUUID()
    changes.push(
      { eid: cid, name: 'doc', comp: { title: '', body } },
      {
        eid: cid,
        name: 'comment',
        // event: the server speaking, not the agent (M-4062) — the bus
        // delivers it, the mail relay must not.
        comp: { target_eid: task, author_eid: eid, event: 1 },
      },
    )
  }
  if (!changes.length) return
  try {
    let t = trace()
    let out = apply(db, changes, t)
    cast(out)
    dispatch(out, t, (comp, e) => console.warn(`settle effect ${comp} —`, e))
  } catch (e) {
    console.warn('settle batch dropped —', e)
  }
}

// Finished worktrees earn their removal AT BOOT, not at settle — which
// bounds accumulation without racing a settle still stamping. Only a
// COMPLETED session whose branch is fully merged into the base and whose
// tree is clean goes; anything failed, interrupted, dirty, or unmerged
// stays for inspection. Removal never closes the resume window: a later
// comment regrows the tree at the same path (regrow, below).
export let tidy = async (cast: Cast) => {
  let rows = db.prepare(
    `select * from session
     where origin = 'managed' and status = 'completed' and cwd is not null`,
  ).all() as Row[]
  for (let row of rows) await cleanup(row, cast)
}

// The checkout a session runs in comes from the GRAPH: its task's project
// names the repo. The sweep and the regrow read it the same way.
let repoOf = (row: Row) =>
  db.prepare(
    `select r.path, r.base_branch from repo r
     join task t on t.project_eid = r.eid where t.eid = ?`,
  ).get(String(row.requested_task_eid)) as
    | { path: string; base_branch: string }
    | undefined

// One worktree, considered and (maybe) removed. Every refusal is a
// warning, never a throw. The row sheds cwd and branch afterwards — a
// later comment-resume sees the shed and regrows instead of spawning
// into a directory that no longer exists.
let cleanup = async (row: Row, cast: Cast) => {
  try {
    let tree = String(row.cwd ?? '')
    let branch = String(row.branch ?? '')
    if (!tree || !branch) return
    let repo = repoOf(row)
    if (!repo) return
    if (await git(tree, ['status', '--porcelain'])) return // dirty: keep
    // merged? --is-ancestor exits nonzero when not — git() throws, we keep
    await git(repo.path, [
      'merge-base',
      '--is-ancestor',
      branch,
      repo.base_branch,
    ])
    await git(repo.path, ['worktree', 'remove', tree])
    await git(repo.path, ['branch', '-d', branch])
    stamp(String(row.eid), { cwd: null, branch: null }, cast)
  } catch (e) {
    console.warn('worktree cleanup skipped —', e)
  }
}

// The sweep's inverse: the same deterministic path and branch the spawn
// chose, recreated from the base. The provider keys its thread by cwd, so
// only the SAME path lets a resume find it; the merged work is already in
// the base, so the continuation starts where the base is now. Throws are
// the caller's to say — a resume that can't regrow refuses out loud.
let regrow = async (row: Row) => {
  let repo = repoOf(row)
  if (!repo) throw new Error("the task's project has no repo")
  let { num } = db.prepare('select num from entity where eid = ?')
    .get(String(row.eid)) as { num: number }
  let sid = `S-${num}`
  let tree = `${worktreesDir()}/${basename(repo.path)}/${sid}`
  Deno.mkdirSync(dirname(tree), { recursive: true })
  await git(repo.path, [
    'worktree',
    'add',
    tree,
    '-b',
    `session/${sid}`,
    repo.base_branch,
  ])
  return { cwd: tree, branch: `session/${sid}` }
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
    // The prompt line is ours — launch() writes what it sent as line 1,
    // context for a debugger, not provider output.
    if ((e as { type?: unknown }).type == 'session.prompt') continue
    // A resumption re-OPENS the log: input() appends this marker before
    // spawning the continuation, so a terminal event behind it was a
    // previous run's ending, not this one's. The live tail never re-reads
    // a settled run — but recover() drains whole files, and must not
    // flag the shape resume writes by design.
    if ((e as { type?: unknown }).type == 'session.input') {
      t.ended = false
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
// A resume starts the tail PAST the settled log (input() hands it a Tail at
// the file's current end), so it reads only the continuation and never
// re-sees the previous run's terminal event.
let follow = async (eid: string, ad: Adapter, cast: Cast, from?: Tail) => {
  let run = running.get(eid)!
  let t: Tail = from ?? { at: 0, seq: 0, ended: false, errs: [] }
  for (;;) {
    let last = await run.exit()
    drain(eid, ad, t, cast)
    if (last) break
    await sleep(poll())
  }
  await finish(eid, t, run, cast)
}

// The ending, derived rather than announced: a clean exit that reached the
// provider's terminal event with nothing malformed on the way is the only
// way to complete. A stop we asked for and then OBSERVED is interrupted —
// stop() never stamps that itself, because a signal sent is not a process
// ended.
let finish = async (eid: string, t: Tail, run: Run, cast: Cast) => {
  let row = db.prepare('select stop_requested_at from session where eid = ?')
    .get(eid) as { stop_requested_at: string | null } | undefined
  if (!row) return // deleted mid-run
  // The wrapper reports a beat AFTER the child vanishes (wait, then the
  // echo into the code file) — give it that beat before calling the code
  // unknowable. No pidfile means no wrapper ever reported for duty
  // (a recovered corpse): nothing to wait for.
  let code = run.code()
  if (code == null && pids(eid)) {
    for (let end = Date.now() + 1000; code == null && Date.now() < end;) {
      await sleep(50)
      code = run.code()
    }
  }
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
  for (let f of [pidFile(eid), codeFile(eid)]) {
    try {
      Deno.removeSync(f) // terminal: nothing left to adopt or report
    } catch { /* never written, or already gone */ }
  }
}

// ---- watching a session we did not spawn ----

// An operator's `claude` is not our child: we never forked it, so there
// is no stdout to own and no exit code to report — and that difference is
// SAID (started_at/finished_at move, exit_code stays null forever) rather
// than faked. What such a session does have is Claude Code's transcript,
// its durable log, read per request by logs() below.
//
// So watching is a heartbeat, not a tail: the one thing a client cannot
// work out for itself is WHEN THE DOOR SHUT (nobody but this process can
// ask /proc), plus how much has happened. latest_seq rides free — stamp()
// keeps a bare counter move off the wire (T-7063), so the only broadcast
// in a whole session's life is the one that ends it.
let watching = new Set<string>()

// Re-armed by the graph, never by a timer: every claude announces itself
// by stamping session.pid at SessionStart — including the `claude
// --resume` a comment spawns (probed live), which is how a woken session
// starts being followed again without this code knowing it was woken.
export let watched = (cast: Cast) => (eid: string, comp: Row) => {
  if (!comp.pid || watching.has(eid)) return
  if (!transcriptOf(eid)) return // nothing of its own to follow
  watching.add(eid)
  let was = db.prepare('select started_at from session where eid = ?').get(
    eid,
  ) as { started_at: string | null } | undefined
  stamp(eid, {
    ...(was?.started_at ? {} : { started_at: now() }),
    finished_at: null, // the door is open again
  }, cast)
  // Detached on purpose: this is a heartbeat that outlives the batch, not
  // a job the batch is waiting on — a caller awaiting the dispatch would
  // wait as long as the operator stays logged in.
  trail(eid, cast)
    .catch((e) => console.warn('session watch stopped —', e))
    .finally(() => watching.delete(eid))
}

// Follow the transcript for as long as somebody is home. Lines are
// COUNTED, not parsed: an external session's summary is nobody's to
// derive — the provider never wrote us a terminal event, and inventing
// one from a conversation would be a guess.
let trail = async (eid: string, cast: Cast) => {
  let t: Tail = { at: 0, seq: 0, ended: false, errs: [] }
  for (;;) {
    let shut = !listening(eid)
    t.seq += readLines(logOf(eid), t).length
    stamp(eid, {
      latest_seq: t.seq,
      ...(shut ? { finished_at: now() } : {}),
    }, cast)
    if (shut) return
    await sleep(poll())
  }
}

// ---- reading the log back ----

let clip = (s: string) => s.length > 64_000 ? `${s.slice(0, 64_000)}…` : s

// One line, normalized for the renderer: the synthetic input line is a
// `say` from the human for EVERY provider (so it's handled here, before any
// dialect dispatch), everything else goes through the session's adapter.
// A line that isn't JSON, or that the adapter doesn't recognize, carries no
// row — the client renders it as its bare type, as before.
let rowOf = (line: string, ad: Adapter | undefined): LogRow | undefined => {
  let e: Event
  try {
    e = JSON.parse(line)
  } catch {
    return undefined
  }
  if (
    e && typeof e == 'object' &&
    (e.type == 'session.input' || e.type == 'session.prompt')
  ) {
    return {
      kind: 'say',
      role: 'user',
      text: String(e.text ?? ''),
      ...(e.timestamp ? { at: String(e.timestamp) } : {}),
    }
  }
  return ad?.row(e) ?? undefined
}

// The log, bounded: `after=N` reads forward from seq N, `tail=N` reads the
// last N lines, limit clamps at 500 either way. Each line carries its
// renderer `row` (the adapter's normalization — omitted when the line isn't
// worth one). stderr rides along whole (its tail, anyway) — unordered
// diagnostics, plainly labelled as such. v0 reads the file per request; when
// logs get big this is where a seq→offset index goes.
export let logs = (eid: string, q: URLSearchParams) => {
  let text = ''
  try {
    text = Deno.readTextFileSync(logOf(eid))
  } catch { /* no log yet: an empty log is not an error */ }
  let ad = dialectOf(eid)
  let lines = text.split('\n')
  if (lines.at(-1) == '') lines.pop() // the trailing newline isn't a line
  let limit = Math.min(Math.max(Number(q.get('limit') ?? 100) || 100, 1), 500)
  let tail = Number(q.get('tail') ?? 0)
  let from = tail > 0
    ? Math.max(0, lines.length - Math.min(tail, limit))
    : Math.max(0, Number(q.get('after') ?? 0))
  let entries = lines.slice(from, from + limit)
    .map((line, i) => {
      let row = rowOf(line, ad)
      return { seq: from + i + 1, line: clip(line), ...(row ? { row } : {}) }
    })
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

// The agent is never our child (the launcher exits at birth; setsid
// detaches the rest), so waitpid is out of reach from the first moment:
// `kill -0` is the only liveness we have. The signal goes to the
// process GROUP (-pid) — an agent's own children die with it.
let alive = async (pid: number) =>
  (await new Deno.Command('kill', {
    args: ['-0', String(pid)],
    stdout: 'null',
    stderr: 'null',
  }).output()).success

// The pidfile holds "group child" (older files, one number meaning both):
// the CHILD is watched for aliveness, the GROUP is what stop() signals.
let pids = (eid: string) => {
  try {
    let ns = Deno.readTextFileSync(pidFile(eid)).trim().split(/\s+/)
      .map(Number).filter((n) => n > 0)
    return ns.length ? { group: ns[0], child: ns[ns.length - 1] } : null
  } catch {
    return null
  }
}
let pidOf = (eid: string) => pids(eid)?.child ?? null

// The exit code the wrapper reported — null while running, and null
// forever when the wrapper died before reporting (a SIGKILL took it).
let codeOf = (eid: string) => {
  try {
    let n = Number(Deno.readTextFileSync(codeFile(eid)).trim())
    return Number.isFinite(n) ? n : null
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

// The firebreak script, run inside the scope by `setsid sh <this file>`:
// agent first, then the trap — armed strictly AFTER the fork, or the agent
// would inherit INT/TERM as ignored — which keeps the wrapper alive through
// stop()'s group TERM so it still reports the exit. setsid makes the wrapper
// a NEW session/group leader, so its `$$` is the group stop() signals; the
// pidfile carries "$$ $!" (group to signal, child to watch). A missing code
// file means the wrapper died unreporting (stop()'s SIGKILL escalation takes
// the whole group). It rides a FILE, not `sh -c '<script>'`, because
// systemd-run applies systemd's OWN $-expansion to the command it launches
// and `$$` is systemd's escape for a literal `$` — a bare path carries no
// metacharacter for it to shred.
let WRAPPER = '"$@" >> "$TASKS_LOG" 2>> "$TASKS_ERR" & trap "" INT TERM; ' +
  'echo "$$ $!" > "$TASKS_PID"; wait $!; echo $? > "$TASKS_CODE"'

// The uid that owns this server — derived, never hardcoded: the per-session
// scope lands in THIS user's slice.
let uid = () => Deno.uid() ?? 0

// The coordinates systemd-run needs to reach the --user manager's bus and
// register a scope under user-<uid>.slice. Linger (loginctl enable-linger)
// keeps that manager alive across the owner's logout, so an escaped agent's
// slice never tears down under it; the bus exists iff user@<uid> is active,
// so a missing one makes systemd-run fail loudly into the err file.
let userBus = () => ({
  XDG_RUNTIME_DIR: `/run/user/${uid()}`,
  DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${uid()}/bus`,
})

// The one fixed helper on disk — same bytes every spawn (see WRAPPER).
let wrapperFile = () => `${logsDir()}/wrapper.sh`

let spawn = (
  eid: string,
  argv: string[],
  cwd: string,
  env: Record<string, string>,
) => {
  Deno.mkdirSync(logsDir(), { recursive: true })
  Deno.writeTextFileSync(wrapperFile(), WRAPPER)
  let child = new Deno.Command('sh', {
    args: [
      '-c',
      // The LAUNCHER — our direct child, the only pid the runtime tracks —
      // backgrounds the rest and exits at birth: a --watch reload KILLS
      // tracked pids (unref is no shield, a reload took two live agents on
      // 2026-07-17), so the only safe pid to hand it is a dead one. Then two
      // escapes: setsid orphans the wrapper into its own session/group (no
      // reload can reach it), and systemd-run --user --scope lifts the whole
      // thing OUT of tasksd's cgroup into its OWN scope in user-<uid>.slice —
      // a unit restart mass-kills the service cgroup and no KillMode opts out
      // (T-7127), so the cgroup escape is what survives a full restart. The
      // scope's unit name is the eid: unique per spawn (respawning a live name
      // fails "already loaded"), --collect frees a settled one so a resume
      // reclaims it. systemd-run stays in tasksd's cgroup and dies at restart
      // — harmless, the agent is already in the scope; its OWN stderr (a
      // missing user bus complains here) joins the err file, so an unreachable
      // manager surfaces as a failed session, the same as a missing CLI's
      // exit 127. `sh <file>` gives systemd a metacharacter-free command line
      // (WRAPPER above); inside it, the file's `$@` is the agent argv and sh
      // does the log/err redirection Deno.Command can't.
      `systemd-run --user --scope --collect --unit="task-${eid}" ` +
      `setsid sh "$WRAPPER_SH" "$@" 2>> "$TASKS_ERR" &`,
      'sh',
      ...argv,
    ],
    cwd,
    clearEnv: true,
    env: {
      ...env,
      ...userBus(),
      WRAPPER_SH: wrapperFile(),
      TASKS_LOG: logFile(eid),
      TASKS_ERR: errFile(eid),
      TASKS_PID: pidFile(eid),
      TASKS_CODE: codeFile(eid),
    },
    stdin: 'null',
    stdout: 'null',
    stderr: 'null',
  }).spawn()
  child.unref() // don't hold the event loop open for the launcher's exit
  return child
}

// ---- the spawn effect ----

// The standing contract every managed spawn carries — the default
// persona, replaced wholesale once a session names a real one. Repo-
// agnostic on purpose: a spawn may land in any project's checkout, so
// the repo's own docs carry the specifics (this graph's docs/STYLE.md
// names its exact gate chain). Born of S-3648, which merged a commit
// that failed the format check because nothing told it not to.
let CONTRACT = `House rules for this run:
- You are in a dedicated worktree on your own branch. Commit focused
  work there; merge to the base branch only with git merge --ff-only —
  if refused, rebase and retry. Never force-push.
- Before merging, run the repo's checks (format, lint, typecheck,
  tests — docs/STYLE.md or the task runner names them), chained with
  && so a failure stops the line, and READ the output. Never merge
  red; formatting counts.
- Read docs/STYLE.md before writing code, if the repo has one, and
  match the existing code's voice.
- File discoveries as new tasks linked to yours instead of silently
  widening scope.`

// created(session) carrying a provider — the spawn request, arrived over
// the wire like any other data (its card and pin, if it was started onto
// a canvas, rode the same batch: the client minted them). The session is
// already committed and broadcast, so every way this can fail is a failed
// Session on the board rather than a toast nobody kept: validation stamps
// `failed` with the reason, and only a request the graph can honor
// reaches launch(). A session created WITHOUT a provider is an external
// one announcing itself — no effect.
export let spawned =
  (cast: Cast) => (eid: string, comp: Record<string, unknown>) => {
    if (!comp.provider) return
    let fail = (error: string) =>
      stamp(eid, {
        origin: 'managed',
        status: 'failed',
        error,
        finished_at: now(),
      }, cast)
    // The committed row is the request — the patch already landed.
    let row = db.prepare('select * from session where eid = ?').get(eid) as
      | Row
      | undefined
    if (!row) return // deleted in its own batch: the tombstone wins
    let ad = adapters[String(row.provider)]
    if (!ad) return fail(`unknown provider: ${row.provider}`)
    let model = String(row.model)
    if (!ad.models.includes(model)) return fail(`unknown model: ${row.model}`)
    if (row.effort && !ad.efforts.includes(String(row.effort))) {
      return fail(`unknown effort: ${row.effort}`)
    }
    let task = db.prepare(`
      select t.project_eid, e.num, d.title, d.body from task t
      join entity e on e.eid = t.eid
      left join doc d on d.eid = t.eid
      where t.eid = ?
    `).get(String(row.requested_task_eid)) as
      | { project_eid: string | null; num: number; title: string; body: string }
      | undefined
    if (!task) return fail(`no such task: ${row.requested_task_eid}`)
    // The workspace comes from the GRAPH, never the request: the task's
    // project says which checkout, and that's the only path we'll run in.
    let repo = task.project_eid
      ? db.prepare('select path, base_branch from repo where eid = ?')
        .get(task.project_eid) as
          | { path: string; base_branch: string }
          | undefined
      : undefined
    if (!repo) {
      return fail("the task's project has no repo — set repo.path first")
    }
    // The worn persona rides whole — core text plus its tiers, rendered
    // by materialize() so the spawn's prompt and the repo's .tasks files
    // say the same thing. A docless persona_eid falls back to CONTRACT.
    let worn: string | undefined
    if (row.persona_eid) {
      let snap = snapshot(db)
      let all = rows(snap)
      let p = all.find((r) => r.eid == String(row.persona_eid) && r.comps.doc)
      if (p) worn = materialize(all, snap.deps, p, Date.now())
    }
    let { num } = db.prepare('select num from entity where eid = ?')
      .get(eid) as { num: number }
    let sid = `S-${num}`
    let tree = `${worktreesDir()}/${basename(repo.path)}/${sid}`
    stamp(eid, {
      origin: 'managed',
      status: 'starting',
      branch: `session/${sid}`,
      cwd: tree,
      started_at: now(),
      // A request that named no actor acts for the task's project — the
      // cwd fill can't place a worktree, and its owner fallback would
      // credit the agent's words to a person (T-7081).
      ...(row.actor_eid ? {} : { actor_eid: task.project_eid }),
    }, cast)
    let instruction = [
      worn ?? CONTRACT,
      `T-${task.num}: ${task.title}`,
      task.body,
    ].filter(Boolean).join('\n\n')
    // The fs and the child are the SLOW half — the returned promise is
    // the whole run, riding the dispatch for callers that await it
    // (tests); the wire never does.
    return launch(eid, ad, {
      instruction,
      session_id: String(row.id),
      task: `T-${task.num}`,
      repo,
      tree,
      branch: `session/${sid}`,
      model,
      effort: row.effort ? String(row.effort) : undefined,
    }, cast)
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
    // What we SENT is line 1: argv carries the instruction to the
    // provider, but a debugger reads the file — the prompt belongs in it.
    Deno.writeTextFileSync(
      logFile(eid),
      `${
        JSON.stringify({
          type: 'session.prompt',
          text: j.instruction,
          timestamp: new Date().toISOString(),
        })
      }\n`,
      { append: true },
    )
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
    await track(eid, ad, ad.argv(j), j.tree, {
      ...childEnv(j.session_id),
      TASKS_TASK: j.task,
    }, cast)
  } catch (e) {
    running.delete(eid)
    stamp(eid, {
      status: 'failed',
      error: String(e).slice(0, 2000),
      finished_at: now(),
    }, cast)
  }
}

// A minimal env by allowlist: what a program needs to run, plus its own
// coordinates. Nothing of this server's environment rides along by
// accident — TASKS_HOST does, because a child reports its life through
// the `task` CLI, and it must report to the graph that spawned it.
let childEnv = (session: string) => ({
  PATH: Deno.env.get('PATH') ?? '',
  HOME: Deno.env.get('HOME') ?? '',
  TERM: Deno.env.get('TERM') ?? 'dumb',
  TASKS_SESSION: session,
  ...(Deno.env.get('TASKS_HOST')
    ? { TASKS_HOST: Deno.env.get('TASKS_HOST')! }
    : {}),
})

// Spawn a detached child, record its pid, and follow its output into the
// row until it exits. The seam a fresh launch and a resume share — the only
// difference between them is the worktree (launch makes one; a resume runs
// in the one already there) and where the tail starts (`from`).
let track = (
  eid: string,
  ad: Adapter,
  argv: string[],
  cwd: string,
  env: Record<string, string>,
  cast: Cast,
  from?: Tail,
) => {
  try {
    Deno.removeSync(codeFile(eid)) // a resume must not read the last ending
  } catch { /* first run */ }
  spawn(eid, argv, cwd, env)
  // The AGENT is the pidfile, not the launcher: the wrapper writes it
  // first thing, and the launcher's death (at birth, by design) says
  // nothing about the run. Until the file appears the child is unborn —
  // and a wrapper that never writes one is stillborn, given a grace.
  let born = Date.now()
  let run: Run = {
    pid: 0,
    exit: async () => {
      run.pid ||= pidOf(eid) ?? 0
      if (!run.pid) return Date.now() - born > 10_000
      return !(await alive(run.pid))
    },
    code: () => codeOf(eid),
    why: 'exit unobserved: the wrapper died before reporting',
    done: Promise.resolve(),
  }
  running.set(eid, run)
  run.done = follow(eid, ad, cast, from)
  return run.done
}

// ---- the stop effect ----

// created(stop_request) — the brake, pulled as data. apply()'s rule
// already guaranteed the target is an ACTIVE managed session, so this
// half only acts: CAS to 'stopping' (two requests race, one writes), ask
// the process group to go, escalate once, and let the tailer stamp the
// ending when it SEES the exit — a session we can't watch die is `lost`,
// said plainly, not assumed dead. The request itself is stamped acted_at
// and stays as audit, like conflict.
export let stopped =
  (cast: Cast) => async (eid: string, comp: Record<string, unknown>) => {
    let target = String(comp.target_eid)
    let acted = () => stamp(eid, { acted_at: now() }, cast, 'stop_request')
    let lost = (stop_reason: string) =>
      stamp(target, {
        status: 'lost',
        stop_reason,
        finished_at: now(),
      }, cast)
    // The guard IS the CAS: two stops race, one WRITES the status. A
    // missed CAS means either the target settled on its own after the
    // request committed — nothing to stop IS acted (the sweep's replay
    // case) — or it's still 'stopping': a stop was recorded whose signal
    // may never have left (another request mid-drive, or a crash between
    // CAS and kill). Fall through and signal again; a TERM at a dying
    // group is a no-op, and acted_at then says the signals were truly
    // sent, not merely intended.
    let hit = db.prepare(`
      update session set status = 'stopping', stop_requested_at = ?
      where eid = ? and status in ('starting', 'running')
    `).run(now(), target).changes
    if (!hit) {
      let s = db.prepare('select status from session where eid = ?')
        .get(target) as { status: string | null } | undefined
      if (!sessionActive.includes(String(s?.status))) return acted()
    } else castRow(target, cast)
    let pid = running.get(target)?.pid || pidOf(target) // run.pid is 0 pre-birth
    if (!pid) {
      lost('no pid: the child was never spawned or its pidfile is gone')
      return acted()
    }
    let grp = pids(target)?.group ?? pid
    let signal = (sig: Deno.Signal) => {
      try {
        Deno.kill(-grp, sig) // the GROUP: an agent's own children go too
      } catch { /* already gone — the wait below is the truth */ }
    }
    signal('SIGTERM')
    if (!await departed(target, pid, grace())) {
      signal('SIGKILL')
      if (!await departed(target, pid, grace())) {
        lost(`pid ${pid} outlived SIGKILL`)
        return acted()
      }
    }
    await running.get(target)?.done // the tailer stamps the ending
    acted()
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

// ---- the input effect ----

// The plain refusal: a machine-event comment on the session saying why
// the words didn't wake it, so the sender learns on their next glance.
// event marks the server speaking (M-4062) — the bus delivers it, the
// mail relay must not, and the resume gate never wakes on it. Telling
// must never throw out of the effect.
let refuse = (eid: string, why: string, cast: Cast) => {
  try {
    let cid = crypto.randomUUID()
    let t = trace()
    let out = apply(db, [
      {
        eid: cid,
        name: 'doc',
        comp: { title: '', body: `can't resume — ${why}` },
      },
      { eid: cid, name: 'comment', comp: { target_eid: eid, event: 1 } },
    ], t)
    cast(out)
    dispatch(out, t, (comp, e) => console.warn(`resume refusal ${comp} —`, e))
  } catch (e) {
    console.warn('resume refusal dropped —', e)
  }
}

// created(comment) — commenting on a session IS messaging that agent (the
// comms bus already says so): aimed at a session nobody is listening to,
// the comment resumes its provider thread with the comment's body. A
// session with someone home takes no stdin — its channel plugin (or the
// bus, on its next tool call) hands the comment over, so the comment
// alone is delivery and nothing happens here. Which one it is is a
// question of LIVENESS, never of origin (door.ts): an operator runs plain
// `claude` and reifies as 'external', and gating on origin left every
// operator's session unresumable and every knock at one unheard. A
// session's own comments never resume it (an agent must not wake itself
// by talking), and machine events carry news, never words to wake on —
// which is also what keeps refuse()'s own reply out of this gate. Words
// that CAN'T wake the session get a refusal said on the session, never a
// silent drop: a swallowed message reads as delivered. The human's line
// and the reply land in the SAME log — seq just continues — and the
// existing tailer closes the session again when the continuation ends.
export let commented =
  (cast: Cast) => async (ceid: string, comp: Record<string, unknown>) => {
    let eid = String(comp.target_eid)
    if (comp.author_eid == eid) return // the session talking about itself
    if (comp.event) return // the server speaking, not someone to answer
    let row = db.prepare('select * from session where eid = ?').get(eid) as
      | Row
      | undefined
    if (!row) return // not aimed at a session
    if (listening(eid)) return // somebody is home — the cast is delivery
    let body = String(
      (db.prepare('select body from doc where eid = ?').get(ceid) as
        | { body: string }
        | undefined)?.body ?? '',
    ).trim()
    if (!body) return // a bare comment says nothing to say
    // The thread to resume. A managed run announced one in its init
    // event; an external claude never had to — `session.id` IS its
    // thread, the id the CLI minted and `--resume` takes back.
    let thread = String(row.provider_session_id ?? '') ||
      (row.origin == 'managed' ? '' : String(row.id ?? ''))
    if (!thread) {
      return refuse(eid, 'the run never announced a provider thread', cast)
    }
    let ad = dialectOf(eid)
    if (!ad) return refuse(eid, `no adapter for '${row.provider}'`, cast)
    let job = {
      instruction: body,
      session_id: String(row.id),
      model: row.model ? String(row.model) : '',
      effort: row.effort ? String(row.effort) : undefined,
    }
    // A session we did not fork has no stdin and no log of ours to append
    // to. Waking it is a `claude --resume` in the cwd it recorded, and
    // that run writes the words AND the answer into the same transcript
    // the watcher follows — so the conversation simply continues where
    // the operator left it. Nothing derives an ending here: the courier
    // is not the session. Re-arming the watch isn't ours either — the
    // resumed process stamps its own pid at SessionStart, and watched()
    // hangs off that. Its raw stream and stderr land beside the log.
    if (row.origin != 'managed') {
      if (!row.cwd) return refuse(eid, 'the session recorded no cwd', cast)
      Deno.mkdirSync(logsDir(), { recursive: true })
      spawn(
        eid,
        ad.resume(job, thread, body),
        String(row.cwd),
        childEnv(job.session_id),
      )
      return
    }
    // A swept worktree is no reason to stay quiet: tidy only removes
    // MERGED trees, and the provider's thread outlives them — regrow at
    // the same path and carry on.
    if (!row.cwd) {
      try {
        let back = await regrow(row)
        stamp(eid, back, cast)
        row = { ...row, ...back }
      } catch (e) {
        return refuse(eid, `no worktree to resume in (${e})`, cast)
      }
    }

    // The human's line joins the log as a `say` — same file, next seq.
    let path = logFile(eid)
    Deno.mkdirSync(logsDir(), { recursive: true })
    Deno.writeTextFileSync(
      path,
      `${
        JSON.stringify({
          type: 'session.input',
          text: body,
          timestamp: new Date().toISOString(),
        })
      }\n`,
      { append: true },
    )
    // Follow the continuation from the END of what's there now: the settled
    // run's terminal event stays behind us — never re-drained, never counted
    // twice, and its `ended` never poisons the new turn.
    let lines = Deno.readTextFileSync(path).split('\n')
    if (lines.at(-1) == '') lines.pop()
    let from: Tail = {
      at: Deno.statSync(path).size,
      seq: lines.length,
      ended: false,
      errs: [],
    }

    // Back to running, every trace of the last ending cleared — the tailer
    // derives a fresh one (stop_requested_at too, or a clean resume would
    // inherit the old 'interrupted').
    stamp(eid, {
      status: 'running',
      exit_code: null,
      error: null,
      stop_reason: null,
      stop_requested_at: null,
      finished_at: null,
    }, cast)

    return track(
      eid,
      ad,
      ad.resume(job, thread, body),
      String(row.cwd),
      childEnv(job.session_id),
      cast,
      from,
    ).catch((e) => {
      running.delete(eid)
      stamp(eid, {
        status: 'failed',
        error: String(e).slice(0, 2000),
        finished_at: now(),
      }, cast)
    })
  }

// ---- the delete effect ----

// removed(session) — the row is gone (tombstoned), so the process goes
// with it: nobody is watching a dead entity's agent, and stamp() on a
// deleted session says nothing anyway. SIGKILL, no grace — there is no
// ending left to derive. The log file stays on disk (a debugger may still
// want it); the pid and code files are torn up so boot never adopts a
// ghost.
export let deleted = (eid: string) => {
  let grp = pids(eid)?.group ?? running.get(eid)?.pid
  if (grp) {
    try {
      Deno.kill(-grp, 'SIGKILL')
    } catch { /* already gone */ }
  }
  running.delete(eid)
  for (let f of [pidFile(eid), codeFile(eid)]) {
    try {
      Deno.removeSync(f)
    } catch { /* never written, or already gone */ }
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
      code: () => codeOf(eid), // the wrapper's report survives restarts
      why: 'exit unobserved: the child outlived the server',
      done: Promise.resolve(),
    }
    running.set(eid, run)
    run.done = follow(eid, ad, cast)
  }
  // The other half of boot: sessions we never spawned but were watching.
  // A restart drops every trail, and an operator's terminal doesn't
  // re-announce itself for us — so ask the door directly, and stamp the
  // ending of anyone who left while we were away.
  for (
    let s of db.prepare(`
      select eid, pid from session
      where origin != 'managed' and pid is not null and finished_at is null
    `).all() as { eid: string; pid: number }[]
  ) watched(cast)(s.eid, s)
  return rows.map((r) => r.eid)
}
