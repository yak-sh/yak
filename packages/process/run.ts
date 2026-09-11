// The supervisor: start a process, adopt one that is already running, pick
// every unfinished one back up at boot, and keep the wanted ones up. Four
// entry points over one loop — watch the pid, write what it says, stamp how it
// ended.
//
// EXACTLY ONE SUPERVISOR SITS ABOVE THIS ONE, and it is not this one. In the
// fleet that is systemd, which owns the daemon this code runs inside; this
// code owns everything below it and nothing above. So `supervise` refuses a
// service whose command would start its own program: a supervisor that
// respawns itself is a fork bomb with a restart policy, and its own death is
// the one ending it cannot witness. The same asymmetry is why a bug here costs
// a restart and never a downed web server — the child outlives us (below), so
// this process dying leaves everything it started running.
//
// THE CHILD OUTLIVES US, two escapes deep, because the thing supervising a
// process must be restartable without taking the process with it. The idiom is
// the fleet's (src/sessions.ts, T-7127/T-9261), reused rather than reinvented:
// our direct child is a LAUNCHER that backgrounds the rest and exits at birth,
// so a watcher that kills tracked pids finds nothing to kill; `setsid` orphans
// the wrapper into its own session and group; and `systemd-run --user --scope`
// lifts the whole thing out of the supervisor's cgroup, which is what survives
// a full unit restart. The wrapper arms its trap strictly AFTER the fork — so
// the child does not inherit INT/TERM ignored — writes "$$ $!" (the group to
// signal, the child to watch) to the pidfile, and reports the exit code when
// the child goes. That pidfile and those two stream files are enough to adopt
// the run back, which is why nothing here reaps anything.
//
// It is Linux-shaped for exactly that reason: `setsid` and a user manager are
// what buy the two escapes. A host without them wants a different launcher,
// not a weaker one.
//
// What the loop does NOT do yet: resume TAILING a launched process's streams
// after a restart. `watch` re-adopts liveness and stamps the ending; the lines
// written while we were away stay in the files. Importing them exactly once
// needs a per-stream cursor on the row, and nothing asks for one yet.

import type { Bundle } from '@yaks/graph'
import { CONTENT, STOP_ENTRY } from '@yaks/session'
import {
  EXIT,
  type Exit,
  PROCESS,
  type Process,
  type Restart,
  SERVICE,
  type Service,
} from './comp.ts'
import type { Store } from './store.ts'

/** What to run. */
export type Spec = {
  /** the program */
  command: string
  /** its arguments */
  args?: string[]
  /** where to run it (default the supervisor's own cwd) */
  cwd?: string
  /** its whole environment — the child inherits nothing else */
  env?: Record<string, string>
}

/** How the supervisor works, all optional. */
export type Opts = {
  /** import stream lines into the graph (default true); false keeps only the
   * files for a caller that publishes its own bounded result */
  stream?: boolean
  /** where pidfiles and stream files live (default `$PROCESS_DIR`, else
   * `$TASKS_HOME/processes`, else `~/.tasks/processes`) */
  dir?: string
  /** how long a wrapper has to write its pidfile before the child is called
   * stillborn (ms, default 10_000) */
  birth?: number
  /** how often liveness and the streams are read (ms, default 1000) — every
   * tick is a `kill -0`, and noticing an ending within a second is plenty */
  poll?: number
  /** mint the process entity's eid (default a uuid) */
  mint?: () => string
  /** land the process row on THIS entity instead of a fresh one — what a
   * supervisor passes so the attempt lands on the row that wanted it. The
   * previous attempt's `exit` is cleared by the same batch, so nothing ever
   * reads a fresh pid beside a stale ending. */
  eid?: string
}

/** What a caller holds of a tracked process. */
export type Run = {
  /** Elapsed wall-clock milliseconds, including time before adoption when known. */
  elapsed: () => number
  /** the process entity */
  eid: string
  /** its pid — 0 when no wrapper ever reported one */
  pid: number
  /** the exit code, once the ending is stamped; null when it was not seen */
  done: Promise<number | null>
}

/** How an adopted process is described, when the adopter knows more than a
 * pid. */
export type Adoption = Opts & {
  /** the command line, if the adopter knows it */
  command?: string | null
  /** where it runs, if the adopter knows it */
  cwd?: string | null
  /** the exit code, read by whoever DID launch it (the fleet's session
   * launcher keeps its own code file) */
  code?: () => number | null
}

let uuid = () => crypto.randomUUID() as string
let sleep = (ms: number) => new Promise((go) => setTimeout(go, ms))

// The two moments that are milliseconds wide — a wrapper reporting for duty,
// and a wrapper reporting an exit — are read on their own short beat. Liveness
// can idle at `poll`; these two would only be waited out.
let BEAT = 20
let beat = (o: Opts) => Math.min(o.poll ?? 1000, BEAT)

/** Where this supervisor keeps its files. */
export let dirOf = (
  o: Opts = {},
  env: (name: string) => string | undefined = Deno.env.get,
): string =>
  o.dir ?? env('PROCESS_DIR') ??
    `${env('TASKS_HOME') || `${env('HOME')}/.tasks`}/processes`

let files = (dir: string, eid: string) => ({
  out: `${dir}/${eid}.out`,
  err: `${dir}/${eid}.err`,
  pid: `${dir}/${eid}.pid`,
  code: `${dir}/${eid}.code`,
  started: `${dir}/${eid}.started`,
  ended: `${dir}/${eid}.ended`,
})

// The firebreak script, run inside the scope by `setsid sh <this file>`. It
// rides a FILE, not `sh -c '<script>'`, because systemd-run applies systemd's
// own $-expansion to the command it launches and `$$` is its escape for a
// literal `$` — a bare path carries no metacharacter for it to shred.
let WRAPPER = '"$@" >> "$TASKS_OUT" 2>> "$TASKS_ERR" & trap "" INT TERM; ' +
  'echo "$$ $!" > "$TASKS_PID"; wait $!; code=$?; date +%s%3N > "$TASKS_ENDED"; echo $code > "$TASKS_CODE"'

// A transient scope name, unique per LAUNCH: systemd refuses a name whose
// predecessor is still loaded, and --collect frees a settled scope but not
// synchronously, so a relaunch would race the name it just released.
let launches = 0
let unit = (eid: string) =>
  `process-${eid}-${Date.now().toString(36)}${++launches}`

// The coordinates systemd-run needs to reach the --user manager's bus. The bus
// exists iff user@<uid> is active, so a missing one fails loudly into the err
// file rather than silently running in our own cgroup.
let userBus = () => {
  let uid = Deno.uid() ?? 0
  return {
    XDG_RUNTIME_DIR: `/run/user/${uid}`,
    DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${uid}/bus`,
  }
}

let spawn = (
  eid: string,
  argv: string[],
  cwd: string,
  env: Record<string, string>,
  dir: string,
) => {
  let f = files(dir, eid)
  let wrapper = `${dir}/wrapper.sh`
  Deno.writeTextFileSync(wrapper, WRAPPER)
  let child = new Deno.Command('sh', {
    args: [
      '-c',
      `systemd-run --user --scope --collect --quiet --unit="${unit(eid)}" ` +
      `setsid sh "$WRAPPER_SH" "$@" 2>> "$TASKS_ERR" &`,
      'sh',
      ...argv,
    ],
    cwd,
    clearEnv: true,
    env: {
      ...env,
      ...userBus(),
      WRAPPER_SH: wrapper,
      TASKS_OUT: f.out,
      TASKS_ERR: f.err,
      TASKS_PID: f.pid,
      TASKS_CODE: f.code,
      TASKS_ENDED: f.ended,
    },
    stdin: 'null',
    stdout: 'null',
    stderr: 'null',
  }).spawn()
  child.unref() // the launcher's death says nothing; don't hold the loop open
}

// The pidfile holds "group child".
let pids = (path: string) => {
  try {
    return Deno.readTextFileSync(path).trim().split(/\s+/)
      .map(Number).filter((n) => n > 0)
  } catch {
    return []
  }
}

// The CHILD is what liveness asks about.
let pidOf = (path: string) => pids(path).at(-1) ?? 0

// The wrapper is what a SIGNAL asks about: it is the process group leader
// (setsid put it there), so signalling `-group` takes the wrapper, the child
// and anything the child started — nothing is left holding a port. A process
// we only adopted has no pidfile, and then the pid we were given is all there
// is.
let groupOf = (path: string) => {
  let ns = pids(path)
  return ns.length > 1 ? ns[0] : 0
}

let codeOf = (path: string) => {
  try {
    let n = Number(Deno.readTextFileSync(path).trim())
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

// Durable start/end clocks keep reattachment from reporting only the final wait.
let elapsedOf = (dir: string, eid: string) => {
  let f = files(dir, eid)
  let start = codeOf(f.started) ?? Date.now()
  return () => Math.max(0, (codeOf(f.ended) ?? Date.now()) - start)
}

// The agent is never our child, so waitpid is out of reach from the first
// moment: `kill` is the only handle there is — `-0` for liveness, and a real
// signal for a stop. A negative target is a process group.
let kill = async (target: number, sig: string) =>
  (await new Deno.Command('kill', {
    args: [`-${sig}`, String(target)],
    stdout: 'null',
    stderr: 'null',
  }).output()).success

let alive = (pid: number) => kill(pid, '0')

let sizeOf = (path: string) => {
  try {
    return Deno.statSync(path).size
  } catch {
    return 0 // never written
  }
}

// The previous attempt's answer, which this one must not be given.
let clear = (path: string) => {
  try {
    Deno.removeSync(path)
  } catch {
    // never written
  }
}

// One stream, read forward from where it already stands. Starting at the END
// is what makes a relaunch onto the same row honest: the stream files are
// appended across attempts (one service, one log), so a tail that started at 0
// would import every earlier line a second time. Measure before the child can
// write a byte, and the seam is exact. The decoder is per-stream and
// streaming, so a multi-byte character split across two reads survives it.
type Tail = { path: string; at: number; rest: string; dec: TextDecoder }
let tail = (path: string): Tail => ({
  path,
  at: sizeOf(path),
  rest: '',
  dec: new TextDecoder(),
})

let sip = (t: Tail) => {
  let f
  try {
    f = Deno.openSync(t.path)
  } catch {
    return '' // never written: the stream said nothing yet
  }
  try {
    f.seekSync(t.at, Deno.SeekMode.Start)
    let buf = new Uint8Array(64 * 1024)
    let text = ''
    for (let n = f.readSync(buf); n; n = f.readSync(buf)) {
      t.at += n
      text += t.dec.decode(buf.subarray(0, n), { stream: true })
    }
    return text
  } finally {
    f.close()
  }
}

// The complete lines this stream has produced since the last read. `final`
// flushes a last line the process never terminated with a newline.
let lines = (t: Tail, final: boolean) => {
  let parts = (t.rest + sip(t)).split('\n')
  t.rest = final ? '' : parts.pop() ?? ''
  if (final && parts.at(-1) === '') parts.pop()
  return parts
}

let drain = async (
  store: Store,
  source: string,
  tails: Tail[],
  final: boolean,
  mint: () => string,
) => {
  let bundles: Bundle[] = []
  for (let t of tails) {
    for (let body of lines(t, final)) {
      bundles.push({ entity: { eid: mint() }, [CONTENT]: { body, source } })
    }
  }
  if (bundles.length) await store.apply(bundles)
}

// The wrapper writes the code file just after the child it waited on is gone,
// so a clean ending is known a moment before its code is. This is the reader
// for the runs whose files are OURS; an adopter that keeps its own ending
// reads it once, with no grace to wait out.
let reported = (path: string, poll: number) => async () => {
  for (let i = 0; i < 20; i++) {
    let code = codeOf(path)
    if (code != null) return code
    await sleep(poll)
  }
  return null
}

// The one loop: watch the pid, write what it says, stamp how it ended.
// `gone` is read BEFORE the drain, so the last read sees the last bytes.
let follow = async (
  store: Store,
  eid: string,
  pid: number,
  tails: Tail[],
  code: () => number | null | Promise<number | null>,
  o: Opts,
) => {
  let poll = o.poll ?? 1000
  let mint = o.mint ?? uuid
  while (true) {
    let gone = !pid || !(await alive(pid))
    if (tails.length) await drain(store, eid, tails, gone, mint)
    if (gone) break
    await sleep(poll)
  }
  let ended = await code()
  await store.apply([{ entity: { eid }, [EXIT]: { code: ended } }])
  return ended
}

/**
 * Start a process, write its row, stream what it says, and stamp how it ended.
 *
 * ```ts
 * import { launch, store } from '@yaks/process'
 *
 * // let run = await launch(store(graph), { command: 'sh', args: ['-c', 'echo hi'] })
 * // await run.done // 0
 * ```
 *
 * Resolves once the pid is known (or the wrapper's grace has passed); `done`
 * resolves when the ending is stamped.
 */
export let launch = async (
  store: Store,
  spec: Spec,
  o: Opts = {},
): Promise<Run> => {
  let eid = o.eid ?? (o.mint ?? uuid)()
  let dir = dirOf(o)
  Deno.mkdirSync(dir, { recursive: true })
  let f = files(dir, eid)
  let argv = [spec.command, ...(spec.args ?? [])]
  let cwd = spec.cwd ?? Deno.cwd()
  // Everything the last attempt on this row left behind, settled before this
  // one starts: the streams are picked up where they stand, and the pidfile
  // and code file GO — read as this attempt's, they would report the previous
  // process alive and already finished.
  let tails = o.stream === false ? [] : [tail(f.out), tail(f.err)]
  clear(f.pid)
  clear(f.code)
  clear(f.ended)
  Deno.writeTextFileSync(f.started, String(Date.now()))
  spawn(eid, argv, cwd, spec.env ?? {}, dir)
  let pid = 0
  for (let end = Date.now() + (o.birth ?? 10_000); !pid && Date.now() < end;) {
    pid = pidOf(f.pid)
    if (!pid) await sleep(beat(o))
  }
  await store.apply([{
    entity: { eid },
    [PROCESS]: { pid: pid || null, command: argv.join(' '), cwd },
    // A row we were given may carry the last attempt's ending. One batch, so
    // no reader ever sees the new pid beside it.
    ...(o.eid ? { [EXIT]: null } : {}),
  }])
  let done = follow(store, eid, pid, tails, reported(f.code, beat(o)), o)
  return { eid, pid, done, elapsed: elapsedOf(dir, eid) }
}

/**
 * Track a process nobody here launched. A pid is all it takes — `command` and
 * `cwd` are recorded only when the adopter happens to know them.
 *
 * ```ts
 * import { adopt, store } from '@yaks/process'
 *
 * // let run = await adopt(store(graph), 4242)
 * ```
 */
export let adopt = async (
  store: Store,
  pid: number,
  o: Adoption = {},
): Promise<Run> => {
  let eid = (o.mint ?? uuid)()
  await store.apply([{
    entity: { eid },
    [PROCESS]: { pid, command: o.command ?? null, cwd: o.cwd ?? null },
  }])
  return {
    eid,
    pid,
    elapsed: elapsedOf(dirOf(o), eid),
    done: follow(store, eid, pid, [], o.code ?? (() => null), o),
  }
}

/**
 * Boot reconcile: pick every process that has not exited back up. One that is
 * still alive is watched again; one that is already gone is stamped now — with
 * its wrapper's code when we launched it, and `null` when nobody saw the
 * ending.
 *
 * ```ts
 * import { store, watch } from '@yaks/process'
 *
 * // let runs = await watch(store(graph))
 * ```
 */
export let watch = async (store: Store, o: Opts = {}): Promise<Run[]> => {
  let dir = dirOf(o)
  let runs: Run[] = []
  for (let b of await store.running()) {
    let eid = b.entity.eid
    let f = files(dir, eid)
    // The pidfile leads: it is what a wrapper reported for duty with, and it
    // is current even for a row whose pid never got stamped.
    let pid = pidOf(f.pid) || Number((b[PROCESS] as Process)?.pid ?? 0)
    runs.push({
      eid,
      pid,
      elapsed: elapsedOf(dir, eid),
      done: follow(store, eid, pid, [], reported(f.code, beat(o)), o),
    })
  }
  return runs
}

/** How supervision works, beside how a process is watched. */
export type Care = Opts & {
  /** the first backoff step (ms, default 1000): the nth respawn waits
   * `min(step * 2 ** (n - 1), ceiling)` from the attempt it follows */
  step?: number
  /** the longest a backoff ever waits (ms, default 60_000) — and the age at
   * which a run stops counting as a flap, so the tally starts over */
  ceiling?: number
  /** how long a stopped process has after TERM before KILL follows (ms,
   * default 10_000) */
  grace?: number
  /** commands this supervisor must not run, BESIDE its own program, which is
   * always refused (see the header) */
  refuse?: (command: string) => boolean
}

// What a pass remembers between passes — the only thing here that is not graph
// data, and it is all clock. The graph holds the tally (`service.attempts`);
// turning a tally into a WAIT needs the moment of the last attempt, and a
// column for that would be a timestamp rewritten on every respawn. A
// supervisor that just restarted forgets the waits, which is the answer we
// want anyway: a restart is a fair reason to try again now.
type Wait = {
  /** when the last attempt was launched */
  at?: number
  /** the earliest the next attempt may be launched */
  after?: number
  /** the last attempt's pid — what a takedown needs after the row is gone */
  pid?: number
  /** when TERM was sent, so KILL can follow the grace */
  termed?: number
  /** this command was refused, and has been said about once */
  told?: boolean
}

let backoff = (n: number, o: Care) =>
  Math.min((o.step ?? 1000) * 2 ** (n - 1), o.ceiling ?? 60_000)

// A shell runs the command line, because one text column cannot carry an argv
// without somebody parsing quotes, and `sh -c` is the parser every host
// already has. It also makes a service row exactly what you would have typed.
let shell = (s: Service): Spec => ({
  command: 'sh',
  args: ['-c', String(s.command)],
  cwd: s.cwd ?? undefined,
})

// An ending nobody could read is not a success.
let again = (restart: Restart | null | undefined, code: number) =>
  restart == 'always' ? true : restart == 'on-failure' ? code != 0 : false

// This supervisor's own program, by the name it was started with — the one
// command it may never run (see the header). Matching the basename catches
// every spelling of the path that would start it again.
let mine = () => {
  let name = (Deno.mainModule ?? '').split('/').pop() ?? ''
  return (command: string) =>
    !!name && command.split(/\s+/).some((a) => a.split('/').pop() == name)
}

/**
 * Keep the wanted programs running. Desired state is a `service` row; this is
 * the pass that makes the world match it, returned as the function a host's
 * tick drives (the fleet's `tick()` in src/doing.ts).
 *
 * ```ts
 * import { store, supervise } from '@yaks/process'
 *
 * // let pass = supervise(store(graph))
 * // await pass()   // start what is missing, respawn what ended, stop what stopped
 * ```
 *
 * One pass, four decisions per row:
 *
 * - `stop` beside the service → TERM the group, then KILL after the grace, and
 *   never respawn. The row stays, so the wanting is recorded as over rather
 *   than forgotten.
 * - no `process` at all → launch it.
 * - `exit` on the process → respawn if `restart` says so, after a backoff that
 *   climbs with `attempts` and stops at `ceiling`.
 * - the service row is gone → take the process down too, since nobody wants it
 *   any more.
 *
 * A process with no `exit` belongs to the WATCHER, not to this pass: `launch`'s
 * own follow and `watch` at boot are what stamp an ending, so there is exactly
 * one writer of that word and this pass never guesses one.
 *
 * The pass answers with the runs it started, so a caller that wants to wait
 * one out — a test, mostly — has the handle.
 */
export let supervise = (store: Store, o: Care = {}): () => Promise<Run[]> => {
  let waits = new Map<string, Wait>()
  let own = mine()
  let dir = dirOf(o)
  let wait = (eid: string) => {
    let w = waits.get(eid)
    if (!w) waits.set(eid, w = {})
    return w
  }
  let signal = (eid: string, pid: number, sig: string) => {
    let group = groupOf(files(dir, eid).pid)
    return kill(group ? -group : pid, sig)
  }
  // Down, politely and then not: TERM on the pass that first sees it, KILL on
  // the first pass after the grace. Nothing here waits — the tick comes back.
  let down = async (eid: string, w: Wait, pid: number) => {
    if (!pid || !(await alive(pid))) return
    if (!w.termed) {
      w.termed = Date.now()
      return signal(eid, pid, 'TERM')
    }
    if (Date.now() - w.termed >= (o.grace ?? 10_000)) {
      return signal(eid, pid, 'KILL')
    }
  }
  return async (): Promise<Run[]> => {
    let started: Run[] = []
    let seen = new Set<string>()
    for (let b of await store.services()) {
      let eid = b.entity.eid
      seen.add(eid)
      let s = (b[SERVICE] ?? {}) as Service
      let p = b[PROCESS] as Process | undefined
      let w = wait(eid)
      let pid = Number(p?.pid ?? 0) || 0
      if (pid) w.pid = pid
      let over = b[EXIT] != null

      if (b[STOP_ENTRY] != null) {
        if (!over) await down(eid, w, pid)
        continue
      }
      if (!s.command) continue
      if (own(s.command) || o.refuse?.(s.command)) {
        if (!w.told) console.warn(`supervise refused ${eid} — ${s.command}`)
        w.told = true
        continue
      }
      // Up, or ending: either way the watcher owns the next word.
      if (p && !over) continue
      if (p && !again(s.restart, Number((b[EXIT] as Exit)?.code ?? 1))) continue
      if (w.after && Date.now() < w.after) continue

      // A run that outlived the longest backoff was not a flap, so its
      // successor starts the tally over.
      let flap = !!w.at && Date.now() - w.at < (o.ceiling ?? 60_000)
      let attempts = (flap ? Number(s.attempts ?? 0) : 0) + 1
      if (p) await store.apply([{ entity: { eid }, [SERVICE]: { attempts } }])
      w.at = Date.now()
      w.after = w.at + backoff(p ? attempts : 1, o)
      w.termed = undefined
      let run = await launch(store, shell(s), { ...o, eid })
      w.pid = run.pid
      // Nothing holds this promise, and in Deno a rejection nobody handled
      // ends the process — which would be this supervisor dying of a child.
      run.done.catch((e) => console.warn(`supervise ${eid} —`, e))
      started.push(run)
    }
    // A service row that is gone is a program nobody wants any more. Only this
    // pass's memory still knows its pid, since the row that held it is
    // deleted, so the takedown lives exactly as long as this supervisor does.
    for (let [eid, w] of waits) {
      if (seen.has(eid)) continue
      if (w.pid && await alive(w.pid)) await down(eid, w, w.pid)
      else waits.delete(eid)
    }
    return started
  }
}
