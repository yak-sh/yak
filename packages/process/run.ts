// The supervisor: start a process, adopt one that is already running, and pick
// every unfinished one back up at boot. Three entry points over one loop —
// watch the pid, write what it says, stamp how it ended.
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
import { CONTENT } from '@yaks/session'
import { EXIT, PROCESS, type Process } from './comp.ts'
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
  /** where pidfiles and stream files live (default `$PROCESS_DIR`, else
   * `~/.tasks/processes`) */
  dir?: string
  /** how long a wrapper has to write its pidfile before the child is called
   * stillborn (ms, default 10_000) */
  birth?: number
  /** how often liveness and the streams are read (ms, default 1000) — every
   * tick is a `kill -0`, and noticing an ending within a second is plenty */
  poll?: number
  /** mint the process entity's eid (default a uuid) */
  mint?: () => string
}

/** What a caller holds of a tracked process. */
export type Run = {
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
export let dirOf = (o: Opts = {}) =>
  o.dir ?? Deno.env.get('PROCESS_DIR') ??
    `${Deno.env.get('HOME')}/.tasks/processes`

let files = (dir: string, eid: string) => ({
  out: `${dir}/${eid}.out`,
  err: `${dir}/${eid}.err`,
  pid: `${dir}/${eid}.pid`,
  code: `${dir}/${eid}.code`,
})

// The firebreak script, run inside the scope by `setsid sh <this file>`. It
// rides a FILE, not `sh -c '<script>'`, because systemd-run applies systemd's
// own $-expansion to the command it launches and `$$` is its escape for a
// literal `$` — a bare path carries no metacharacter for it to shred.
let WRAPPER = '"$@" >> "$TASKS_OUT" 2>> "$TASKS_ERR" & trap "" INT TERM; ' +
  'echo "$$ $!" > "$TASKS_PID"; wait $!; echo $? > "$TASKS_CODE"'

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
    },
    stdin: 'null',
    stdout: 'null',
    stderr: 'null',
  }).spawn()
  child.unref() // the launcher's death says nothing; don't hold the loop open
}

// The pidfile holds "group child": the CHILD is what liveness asks about.
let pidOf = (path: string) => {
  try {
    let ns = Deno.readTextFileSync(path).trim().split(/\s+/)
      .map(Number).filter((n) => n > 0)
    return ns.length ? ns[ns.length - 1] : 0
  } catch {
    return 0
  }
}

let codeOf = (path: string) => {
  try {
    let n = Number(Deno.readTextFileSync(path).trim())
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

// The agent is never our child, so waitpid is out of reach from the first
// moment: `kill -0` is the only liveness there is.
let alive = async (pid: number) =>
  (await new Deno.Command('kill', {
    args: ['-0', String(pid)],
    stdout: 'null',
    stderr: 'null',
  }).output()).success

// One stream, read forward. The decoder is per-stream and streaming, so a
// multi-byte character split across two reads survives the seam.
type Tail = { path: string; at: number; rest: string; dec: TextDecoder }
let tail = (path: string): Tail => ({
  path,
  at: 0,
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
  let eid = (o.mint ?? uuid)()
  let dir = dirOf(o)
  Deno.mkdirSync(dir, { recursive: true })
  let f = files(dir, eid)
  let argv = [spec.command, ...(spec.args ?? [])]
  let cwd = spec.cwd ?? Deno.cwd()
  spawn(eid, argv, cwd, spec.env ?? {}, dir)
  let pid = 0
  for (let end = Date.now() + (o.birth ?? 10_000); !pid && Date.now() < end;) {
    pid = pidOf(f.pid)
    if (!pid) await sleep(beat(o))
  }
  await store.apply([{
    entity: { eid },
    [PROCESS]: { pid: pid || null, command: argv.join(' '), cwd },
  }])
  let tails = [tail(f.out), tail(f.err)]
  let done = follow(store, eid, pid, tails, reported(f.code, beat(o)), o)
  return { eid, pid, done }
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
      done: follow(store, eid, pid, [], reported(f.code, beat(o)), o),
    })
  }
  return runs
}
