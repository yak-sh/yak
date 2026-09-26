// The supervisor: start a process, adopt one that is already running, pick
// every unfinished one back up at start-up, and keep the wanted ones running.
// Four entry points over one loop — watch the pid, write what the process
// prints, record how it ended.
//
// Exactly one supervisor sits above this one, and it is not this one. In the
// fleet that is systemd, which owns the daemon this code runs inside; this
// code owns everything below it and nothing above. So `supervise` refuses a
// service whose command would start its own program: a supervisor that
// restarts itself is a fork bomb with a restart policy, and its own exit is
// the one thing it cannot observe. The same asymmetry is why a bug here costs
// a restart and never a downed web server — every child outlives us (below),
// so this process dying leaves everything it started running.
//
// The child outlives US, because the process supervising another process
// must be restartable without taking that process with it. The technique is
// the fleet's (src/sessions.ts, T-7127/T-9261), reused rather than reinvented:
// our direct child is a launcher that backgrounds the rest and exits
// immediately, so a supervisor that kills the pids it tracks finds nothing to
// kill; the wrapper starts in a session and process group of its own; and on a
// machine whose service manager stops more than our process group, the run is
// lifted out of its reach too, which is what survives a full restart of the
// unit we run in. The wrapper starts ignoring INT and TERM strictly after
// forking the child — so the child does not inherit them ignored — writes
// "$$ $!" (the group to signal, and the child to watch) to the pidfile, and
// writes the exit code when the child ends. That pidfile and those two output
// files are enough to adopt the run back, which is why nothing here calls
// waitpid or reaps child processes.
//
// Only the detaching differs from one machine to the next, and `platforms`
// below is the whole difference, as data. Everything else here is POSIX: sh,
// kill(1), and files.
//
// What the loop does not do yet: resume reading a launched process's output
// files after a restart. `watch` adopts the process again and records its exit
// code; the lines printed while we were away stay in the files. Importing them
// exactly once needs a per-file read position on the row, and nothing asks for
// one yet.

import type { Bundle } from '@yaks/graph'
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

// Components other packages declare, which a host composes beside this one:
// each line a process prints is `content{body}` with an `output{source}`
// naming the process (@yaks/tools), and a `stop` on a service's entity
// (@yaks/session) is the wish that it stop.
let CONTENT = 'content'
let OUTPUT = 'output'
let STOP = 'stop'

/** What to run. */
export type Spec = {
  /** the program */
  command: string
  /** its arguments */
  args?: string[]
  /** where to run it (default the supervisor's own working directory) */
  cwd?: string
  /** its whole environment — the child inherits nothing else */
  env?: Record<string, string>
}

/** How the supervisor works, all optional. */
export type Opts = {
  /** import the child's output lines into the graph (default true); false
   * keeps only the files, for a caller that publishes its own bounded result */
  stream?: boolean
  /** where the pidfiles and output files live (default `$PROCESS_DIR`, else
   * `$TASKS_HOME/processes`, else `~/.tasks/processes`) */
  dir?: string
  /** how long the wrapper has to write its pidfile before the child is treated
   * as having never started (ms, default 10_000) */
  birth?: number
  /** how often the pid and the output files are read (ms, default 1000) —
   * every pass is a `kill -0`, and noticing an exit within a second is
   * plenty */
  poll?: number
  /** mint the process entity's eid (default a uuid) */
  mint?: () => string
  /** write the process row on this entity instead of a fresh one — what a
   * supervisor passes so the attempt is recorded on the service row that
   * wanted it. The previous attempt's `exit` is deleted by the same
   * transaction, so nothing ever reads a fresh pid beside a stale exit code. */
  eid?: string
  /** which machine's launcher to use (default this one's, `Deno.build.os`);
   * the macOS one runs anywhere perl does, which is how Linux tests it */
  os?: string
}

/** What a caller holds of a tracked process. */
export type Run = {
  /** Elapsed wall-clock milliseconds, including time before adoption when known. */
  elapsed: () => number
  /** the process entity */
  eid: string
  /** its pid — 0 when the wrapper never reported one */
  pid: number
  /** the exit code, once it has been recorded; null when it was not
   * observed */
  done: Promise<number | null>
}

/** How an adopted process is described, when the adopter knows more than a
 * pid. */
export type Adoption = Opts & {
  /** the command line, if the adopter knows it */
  command?: string | null
  /** where it runs, if the adopter knows it */
  cwd?: string | null
  /** the exit code, read by whoever did launch it (the fleet's session
   * launcher keeps an exit-code file of its own) */
  code?: () => number | null
}

let uuid = () => crypto.randomUUID() as string
let sleep = (ms: number) => new Promise((go) => setTimeout(go, ms))

// The two moments that last only milliseconds — the wrapper writing its
// pidfile, and the wrapper writing its exit code — are polled on their own
// short interval. Checking that the process is still alive can wait for
// `poll`; polling these two any slower would only add delay.
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
})

/**
 * The files one run keeps, named after the entity it is recorded on: its
 * stdout and stderr files, the pidfile the wrapper writes its pid to, the
 * file it writes the exit code to, and the file holding when it started.
 *
 * ```ts
 * import { paths } from '@yaks/process'
 *
 * // paths('7f3…').out  // the stdout file to read
 * ```
 *
 * A caller that reads the output itself — @yaks/spawn imports a provider's
 * JSON-lines stdout as transcript entries — needs the name of the file this
 * package writes, and this package should state that layout rather than leave
 * callers to assume it.
 */
export let paths = (
  eid: string,
  o: Opts = {},
): Record<'out' | 'err' | 'pid' | 'code' | 'started', string> =>
  files(dirOf(o), eid)

// The wrapper script, run detached as `sh <this file> <argv…>`. It is kept in
// a file, not passed as `sh -c '<script>'`, because a detaching command may
// expand its own command line (systemd-run does; see `literal`), and a bare
// path gives it nothing to expand. When the child ended is the exit-code
// file's mtime, not a date(1) the wrapper runs: date's sub-second format is
// not POSIX, macOS prints `%N` as a letter, and shell arithmetic on that
// would end the wrapper before it wrote the code.
let WRAPPER = '"$@" >> "$TASKS_OUT" 2>> "$TASKS_ERR" & trap "" INT TERM; ' +
  'echo "$$ $!" > "$TASKS_PID"; wait $!; echo $? > "$TASKS_CODE"'

// The launcher, our direct child: it backgrounds the detaching command and
// exits at once. The whole command line arrives as its arguments, so nothing
// in it is parsed as shell, and a detaching command that fails says why in
// the stderr file.
let LAUNCHER = '"$@" 2>> "$TASKS_ERR" &'

// A transient scope name, unique per launch: systemd refuses a name whose
// previous unit is still loaded, and --collect frees a finished scope but not
// synchronously, so starting the program again would race the name it just
// released.
let launches = 0
let unit = (eid: string) =>
  `process-${eid}-${Date.now().toString(36)}${++launches}`

// systemd expands `$VAR` and `${VAR}` in the command line it launches, so an
// argv element containing a shell variable, a template literal or a heredoc
// body reaches the program mangled: a hosted shell wrote a test file with
// every `${…}` deleted and systemd's "Referenced but unset environment
// variable" note in its stderr (T-37332). `$$` is systemd's escape for a
// literal `$`, so the program receives exactly the argv the caller passed.
// Only the command line is expanded — `%` specifiers are not — so this is the
// whole quoting rule.
export let literal = (arg: string): string => arg.replaceAll('$', '$$$$')

/** How one machine detaches a run, given this launch's name and the user it
 * runs as. */
type Platform = (launch: { unit: string; uid: number }) => {
  /** the command that starts the wrapper in a session and process group of
   * its own, beyond whatever stops the host */
  detach: string[]
  /** what that command needs in its environment */
  env: Record<string, string>
  /** one word of the wrapper's command line, written so the detaching
   * command passes it on unchanged */
  word: (arg: string) => string
}

let platforms: Record<string, Platform> = {
  // `systemd-run --user --scope` lifts the run out of our cgroup, which
  // systemd stops whole with our unit, and `setsid` gives it its session. The
  // two variables are how systemd-run reaches the --user manager's D-Bus
  // socket; that socket exists only while user@<uid> is active, so a missing
  // one fails loudly into the stderr file rather than silently running the
  // child in our own cgroup.
  linux: ({ unit, uid }) => ({
    detach: [
      'systemd-run',
      '--user',
      '--scope',
      '--collect',
      '--quiet',
      `--unit=${unit}`,
      'setsid',
    ],
    env: {
      XDG_RUNTIME_DIR: `/run/user/${uid}`,
      DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${uid}/bus`,
    },
    word: literal,
  }),
  // launchd stops a job by signalling its process group (launchd.plist(5),
  // AbandonProcessGroup), so a session of its own is the whole lift. macOS
  // ships no setsid(1); its perl makes the setsid(2) call and execs the rest,
  // with no shell and no expansion between.
  darwin: () => ({
    detach: [
      'perl',
      '-MPOSIX=setsid',
      '-e',
      'setsid or die "setsid: $!\\n"; exec { $ARGV[0] } @ARGV or die "exec: $!\\n"',
    ],
    env: {},
    word: (arg) => arg,
  }),
}

let platformOf = (o: Opts): Platform => {
  let os = o.os ?? Deno.build.os
  let platform = platforms[os]
  if (!platform) throw new Error(`@yaks/process cannot launch on ${os}`)
  return platform
}

let spawn = (
  eid: string,
  argv: string[],
  cwd: string,
  env: Record<string, string>,
  dir: string,
  platform: Platform,
) => {
  let f = files(dir, eid)
  let wrapper = `${dir}/wrapper.sh`
  // Every launch shares this file, and a write truncates before it writes: a
  // `sh wrapper.sh` opened in between ran an empty script, so its child never
  // started. A rename replaces the file whole, and a shell already reading the
  // old one keeps reading all of it.
  Deno.writeTextFileSync(`${wrapper}.${eid}`, WRAPPER)
  Deno.renameSync(`${wrapper}.${eid}`, wrapper)
  let p = platform({ unit: unit(eid), uid: Deno.uid() ?? 0 })
  let child = new Deno.Command('sh', {
    args: [
      '-c',
      LAUNCHER,
      'sh',
      ...p.detach,
      ...['sh', wrapper, ...argv].map(p.word),
    ],
    cwd,
    clearEnv: true,
    env: {
      ...env,
      ...p.env,
      TASKS_OUT: f.out,
      TASKS_ERR: f.err,
      TASKS_PID: f.pid,
      TASKS_CODE: f.code,
    },
    stdin: 'null',
    stdout: 'null',
    stderr: 'null',
  }).spawn()
  // The launcher exits immediately and tells us nothing, so don't hold the
  // event loop open waiting for it.
  child.unref()
}

// The pidfile holds two numbers: the process group, then the child's pid.
let pids = (path: string) => {
  try {
    return Deno.readTextFileSync(path).trim().split(/\s+/)
      .map(Number).filter((n) => n > 0)
  } catch {
    return []
  }
}

// The child is the pid to test for liveness.
let pidOf = (path: string) => pids(path).at(-1) ?? 0

// The wrapper is what a signal should be sent to: setsid made it the process
// group leader, so signalling the negated group id reaches the wrapper, the
// child and anything the child started — nothing is left holding a port. A
// process we only adopted has no pidfile, and then the pid we were given is
// all there is.
let groupOf = (path: string) => {
  let ns = pids(path)
  return ns.length > 1 ? ns[0] : 0
}

let textOf = (path: string) => {
  try {
    return Deno.readTextFileSync(path)
  } catch {
    return '' // not written yet
  }
}

// A number the wrapper wrote, or null until it is there. `Number('')` is 0,
// so an empty file must not reach it.
let numberIn = (text: string) => {
  let n = Number(text.trim())
  return text.trim() && Number.isFinite(n) ? n : null
}

let codeOf = (path: string) => numberIn(textOf(path))

// The exit code, once the wrapper has written all of it. Its `echo $code >
// file` creates the file empty and writes the line a moment later; a load that
// stretches that moment let a read see the empty file and stamp a clean exit on
// a child that exited 3 (T-38290). echo ends the line with a newline, so a
// complete write is one that ends with one.
let exitIn = (path: string) => {
  let text = textOf(path)
  return text.endsWith('\n') ? numberIn(text) : null
}

let mtimeOf = (path: string) => {
  try {
    return Deno.statSync(path).mtime?.getTime() ?? null
  } catch {
    return null // not written yet
  }
}

// The start and end times are kept in files, so a process picked back up
// after a restart reports its whole running time and not just the last wait.
// The end is when the wrapper wrote the exit code.
let elapsedOf = (dir: string, eid: string) => {
  let f = files(dir, eid)
  let start = codeOf(f.started) ?? Date.now()
  return () => Math.max(0, (mtimeOf(f.code) ?? Date.now()) - start)
}

// The process we track is never our direct child, so waitpid is unavailable
// from the first moment: kill(1) is the only handle there is — `-0` to test
// that it is still alive, and a signal to stop it. A negative target is a
// process group.
let kill = async (target: number, sig: string) =>
  (await new Deno.Command('kill', {
    args: [`-${sig}`, String(target)],
    stdout: 'null',
    stderr: 'null',
  }).output()).success

let alive = (pid: number) => kill(pid, '0')

/**
 * Send a signal to a tracked run: to its process group where we launched it —
 * the wrapper leads that group, so the child and anything the child started
 * get the signal too — and to the bare pid where we only adopted it.
 *
 * ```ts
 * import { signal } from '@yaks/process'
 *
 * // await signal(run.eid, run.pid, 'TERM')
 * ```
 *
 * Nothing waits here: the exit code is written by the code watching the pid,
 * in this case as in every other.
 */
export let signal = (
  eid: string,
  pid: number,
  sig: string,
  o: Opts = {},
): Promise<boolean> => {
  let group = groupOf(paths(eid, o).pid)
  return kill(group ? -group : pid, sig)
}

let sizeOf = (path: string) => {
  try {
    return Deno.statSync(path).size
  } catch {
    return 0 // the file was never written
  }
}

// Delete a file the previous attempt left behind, so this attempt is not
// handed the previous attempt's result.
let clear = (path: string) => {
  try {
    Deno.removeSync(path)
  } catch {
    // the file was never written
  }
}

// One output file, read forward from wherever it already stands. Starting at
// the end is what keeps a restart onto the same entity correct: the output
// files are appended to across attempts (one service, one log), so reading
// from byte 0 would import every earlier line a second time. Taking the size
// before the child can write a byte makes the boundary exact. The decoder is
// per-file and streaming, so a multi-byte character split across two reads
// still decodes.
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
    return '' // the file does not exist yet: nothing has been printed
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

// The complete lines this file has gained since the last read. `final` also
// returns a last line the process never terminated with a newline.
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
      bundles.push({
        entity: { eid: mint() },
        [CONTENT]: { body },
        [OUTPUT]: { source },
      })
    }
  }
  if (bundles.length) await store.apply(bundles)
}

// The wrapper writes the exit-code file just after the child it waited on is
// gone, so we know the process ended a moment before we know its code. It is
// waited for while the wrapper lives, since load can stretch that moment past
// any fixed count of polls; once the wrapper is gone the file is final. A run
// with no wrapper pid on file gets the old short grace, and WRITE bounds a
// wrapper pid another process took over. This is the reader for runs whose
// files are ours; a caller that adopted a process and keeps its own exit code
// reads that once, with no delay to wait out.
let WRITE = 10_000
let reported = (f: ReturnType<typeof files>, poll: number) => async () => {
  let wrapper = groupOf(f.pid)
  for (let i = 0, end = Date.now() + WRITE;; i++) {
    let code = exitIn(f.code)
    if (code != null) return code
    let over = wrapper ? !(await alive(wrapper)) : i >= 20
    if (over || Date.now() >= end) return exitIn(f.code)
    await sleep(poll)
  }
}

// The one loop: watch the pid, write what the process printed, record how it
// ended. Whether the process is gone is checked before the last read, so that
// read sees the final bytes.
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
 * Start a process, write its row, import what it prints, and record how it
 * ended.
 *
 * ```ts
 * import { launch, store } from '@yaks/process'
 *
 * // let run = await launch(store(graph), { command: 'sh', args: ['-c', 'echo hi'] })
 * // await run.done // 0
 * ```
 *
 * Resolves once the pid is known, or once the wrapper has run out of time to
 * report one; `done` resolves when the exit code has been written.
 */
export let launch = async (
  store: Store,
  spec: Spec,
  o: Opts = {},
): Promise<Run> => {
  let platform = platformOf(o)
  let eid = o.eid ?? (o.mint ?? uuid)()
  let dir = dirOf(o)
  Deno.mkdirSync(dir, { recursive: true })
  let f = files(dir, eid)
  let argv = [spec.command, ...(spec.args ?? [])]
  let cwd = spec.cwd ?? Deno.cwd()
  // Deal with everything the last attempt on this row left behind before this
  // one starts: the output files are read on from where they stand, and the
  // pidfile and exit-code file are deleted — read as if they belonged to this
  // attempt, they would report the previous process both alive and already
  // finished.
  let tails = o.stream === false ? [] : [tail(f.out), tail(f.err)]
  clear(f.pid)
  clear(f.code)
  Deno.writeTextFileSync(f.started, String(Date.now()))
  spawn(eid, argv, cwd, spec.env ?? {}, dir, platform)
  let pid = 0
  for (let end = Date.now() + (o.birth ?? 10_000); !pid && Date.now() < end;) {
    pid = pidOf(f.pid)
    if (!pid) await sleep(beat(o))
  }
  await store.apply([{
    entity: { eid },
    [PROCESS]: { pid: pid || null, command: argv.join(' '), cwd },
    // A row we were handed may still carry the last attempt's exit code. One
    // transaction, so no reader ever sees the new pid beside it.
    ...(o.eid ? { [EXIT]: null } : {}),
  }])
  let done = follow(store, eid, pid, tails, reported(f, beat(o)), o)
  return { eid, pid, done, elapsed: elapsedOf(dir, eid) }
}

/**
 * Track a process nobody here launched. A pid is all it takes — `command` and
 * `cwd` are recorded only when the caller happens to know them.
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
 * The start-up pass: pick every process that has not exited back up. One that
 * is still alive is watched again; one that is already gone has its exit
 * recorded now — with the code its wrapper wrote when we launched it, and
 * `null` when nothing observed the exit.
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
    // The pidfile wins: it is where the wrapper wrote its own pid, and it is
    // current even for a row whose pid was never written.
    let pid = pidOf(f.pid) || Number((b[PROCESS] as Process)?.pid ?? 0)
    runs.push({
      eid,
      pid,
      elapsed: elapsedOf(dir, eid),
      done: follow(store, eid, pid, [], reported(f, beat(o)), o),
    })
  }
  return runs
}

/**
 * The processes whose row says they are running on this machine and whose pid
 * is gone: a run that ended without writing its own `exit` — killed, crashed,
 * or the machine restarted under it. A run this package launched is left out,
 * since its wrapper writes the ending and {@link watch} records it with the
 * code, and so is `me`, the process asking.
 *
 * ```ts
 * import { selfEid, store, vanished } from '@yaks/process'
 *
 * // let dead = await vanished(store(graph), { me: selfEid() })
 * ```
 */
export let vanished = async (
  store: Store,
  o: Asking = {},
): Promise<Bundle[]> => {
  let out: Bundle[] = []
  for (let b of await store.running()) if (await dead(b, o)) out.push(b)
  return out
}

/** Who is asking after the dead, and how a pid is looked for. */
export type Asking = Opts & {
  /** the process asking, never counted among them */
  me?: string
  /** whether a pid is running (default: `kill -0`) */
  running?: (pid: number) => Promise<boolean>
}

/**
 * Whether a process is over, so nothing it held is held any more: its row
 * records an `exit`, or it is among the {@link vanished}. A Worker thread is a
 * row of its own in the pid it runs in (./self.ts), and that pid outlives it;
 * the `exit` the process that ended it writes is what says it is over. What a
 * process contending for something another holds asks (@yaks/effects `take`).
 * `me`, the process asking, is never over to itself.
 *
 * ```ts
 * import { gone, selfEid, store } from '@yaks/process'
 *
 * // if (await gone(store(graph), holder, { me: selfEid() })) …
 * ```
 */
export let gone = async (
  store: Store,
  eid: string,
  o: Asking = {},
): Promise<boolean> => {
  if (eid == o.me) return false
  let [b] = await store.get([eid])
  return !!b?.[EXIT] || (!!b?.[PROCESS] && await dead(b, o))
}

// A running row whose pid is gone. A run this package launched is not one:
// its wrapper writes the ending, and `watch` records it with the code.
let dead = async (b: Bundle, o: Asking): Promise<boolean> => {
  let eid = b.entity.eid
  let pid = Number((b[PROCESS] as Process)?.pid ?? 0)
  if (eid == o.me || !pid || mtimeOf(files(dirOf(o), eid).started) != null) {
    return false
  }
  return !await (o.running ?? alive)(pid)
}

/** How supervision behaves, in addition to how a process is watched. */
export type Care = Opts & {
  /** the first backoff step (ms, default 1000): the nth respawn waits
   * `min(step * 2 ** (n - 1), ceiling)` from the attempt it follows */
  step?: number
  /** the longest a backoff ever waits (ms, default 60_000) — and the age at
   * which a run stops counting as part of a crash loop, so the count of
   * attempts starts over */
  ceiling?: number
  /** how long a stopped process has after SIGTERM before SIGKILL follows (ms,
   * default 10_000) */
  grace?: number
  /** commands this supervisor must not run, in addition to its own program,
   * which is always refused (see the header) */
  refuse?: (command: string) => boolean
}

// What a pass remembers between passes — the only state here that is not in
// the graph, and it is all timestamps. The graph holds the count
// (`service.attempts`); turning that count into a wait also needs the time of
// the last attempt, and a property for that would be a timestamp rewritten on
// every restart. A supervisor that has just restarted forgets these waits,
// which is what we want anyway: a restart is a fair reason to try again now.
type Wait = {
  /** when the last attempt was launched */
  at?: number
  /** the earliest the next attempt may be launched */
  after?: number
  /** the last attempt's pid — needed to shut the process down after the
   * service row has been deleted */
  pid?: number
  /** when SIGTERM was sent, so SIGKILL can follow after the grace period */
  termed?: number
  /** this command was refused, and has been warned about once */
  told?: boolean
}

let backoff = (n: number, o: Care) =>
  Math.min((o.step ?? 1000) * 2 ** (n - 1), o.ceiling ?? 60_000)

// A shell runs the command line, because one text property cannot hold an argv
// without somebody parsing quotes, and `sh -c` is the parser every machine
// already has. It also makes a service row exactly what you would have typed.
let shell = (s: Service): Spec => ({
  command: 'sh',
  args: ['-c', String(s.command)],
  cwd: s.cwd ?? undefined,
})

// An exit code nobody could read does not count as a success.
let again = (restart: Restart | null | undefined, code: number) =>
  restart == 'always' ? true : restart == 'on-failure' ? code != 0 : false

// This supervisor's own program, by the name it was started with — the one
// command it may never run (see the header). Matching the basename catches
// every way of writing the path that would start it again.
let mine = () => {
  let name = (Deno.mainModule ?? '').split('/').pop() ?? ''
  return (command: string) =>
    !!name && command.split(/\s+/).some((a) => a.split('/').pop() == name)
}

/**
 * Keep the wanted programs running. What is wanted is a `service` row; this is
 * the pass that makes the machine match it, returned as a function for the
 * caller's own timer to drive (the fleet's `tick()` in src/doing.ts).
 *
 * ```ts
 * import { store, supervise } from '@yaks/process'
 *
 * // let pass = supervise(store(graph))
 * // await pass()   // start what is missing, restart what exited, stop what stopped
 * ```
 *
 * One pass, four decisions per row:
 *
 * - a `stop` component beside the service → SIGTERM the process group, then
 *   SIGKILL after the grace period, and never start it again. The row stays,
 *   so the fact that the program was wanted is recorded as over rather than
 *   deleted.
 * - no `process` component at all → launch it.
 * - an `exit` on the process → launch it again if `restart` calls for it,
 *   after a backoff that grows with `attempts` and stops at `ceiling`.
 * - the service row deleted → shut the process down too, since nobody wants it
 *   any more.
 *
 * A process with no `exit` belongs to the code watching it, not to this pass:
 * `launch`'s own follow loop and `watch` at start-up are what record an exit
 * code, so there is exactly one writer of that component and this pass never
 * infers one.
 *
 * The pass returns the runs it started, so a caller that wants to wait for one
 * — a test, mostly — has the handle.
 */
export let supervise = (store: Store, o: Care = {}): () => Promise<Run[]> => {
  let waits = new Map<string, Wait>()
  let own = mine()
  let wait = (eid: string) => {
    let w = waits.get(eid)
    if (!w) waits.set(eid, w = {})
    return w
  }
  // Shut it down, politely and then not: SIGTERM on the pass that first sees
  // the stop, SIGKILL on the first pass after the grace period. Nothing here
  // waits — the timer calls us again.
  let down = async (eid: string, w: Wait, pid: number) => {
    if (!pid || !(await alive(pid))) return
    if (!w.termed) {
      w.termed = Date.now()
      return signal(eid, pid, 'TERM', o)
    }
    if (Date.now() - w.termed >= (o.grace ?? 10_000)) {
      return signal(eid, pid, 'KILL', o)
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

      if (b[STOP] != null) {
        if (!over) await down(eid, w, pid)
        continue
      }
      if (!s.command) continue
      if (own(s.command) || o.refuse?.(s.command)) {
        if (!w.told) console.warn(`supervise refused ${eid} — ${s.command}`)
        w.told = true
        continue
      }
      // Running, or exiting: either way the code watching the pid makes the
      // next write.
      if (p && !over) continue
      if (p && !again(s.restart, Number((b[EXIT] as Exit)?.code ?? 1))) continue
      if (w.after && Date.now() < w.after) continue

      // A run that outlived the longest backoff was not part of a crash loop,
      // so the next attempt starts the count over.
      let flap = !!w.at && Date.now() - w.at < (o.ceiling ?? 60_000)
      let attempts = (flap ? Number(s.attempts ?? 0) : 0) + 1
      if (p) await store.apply([{ entity: { eid }, [SERVICE]: { attempts } }])
      w.at = Date.now()
      w.after = w.at + backoff(p ? attempts : 1, o)
      w.termed = undefined
      let run = await launch(store, shell(s), { ...o, eid })
      w.pid = run.pid
      // Nothing holds this promise, and in Deno an unhandled rejection ends
      // the process — which would be this supervisor dying because a child
      // did.
      run.done.catch((e) => console.warn(`supervise ${eid} —`, e))
      started.push(run)
    }
    // A deleted service row is a program nobody wants any more. Only this
    // pass's own memory still knows its pid, since the row that held it is
    // gone, so the shutdown lasts exactly as long as this supervisor does.
    for (let [eid, w] of waits) {
      if (seen.has(eid)) continue
      if (w.pid && await alive(w.pid)) await down(eid, w, w.pid)
      else waits.delete(eid)
    }
    return started
  }
}
