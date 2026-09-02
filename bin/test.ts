// Run the broad suite with Deno's module-level parallelism while preserving
// fresh-process isolation for fixtures whose contract is process-global state.
// A parallel worker reuses one module graph and environment for several files:
// roles owns HOME, sessions_contention owns a file DB_PATH, and sessions owns
// the managed-process directories. Co-locating any of them can make a cached
// import observe whichever file happened to load first.
//
// The isolated pass follows the parallel pass. Running it concurrently would
// preserve module isolation but not scheduler isolation: debounce and process
// fixtures would again be tested under artificial saturation.
let isolated = new Set([
  'src/roles_test.ts',
  'src/sessions_contention_test.ts',
  'src/sessions_test.ts',
  // Native transcript confinement reads HOME while each drain runs. A
  // co-located fixture changing HOME can make a valid transcript disappear
  // between its creation and ingestion.
  'src/ingest_drain_test.ts',
  'src/ingest_native_test.ts',
  // This one deliberately tests a real debounce interval.
  'src/components/Search_test.tsx',
  // These launch nested Deno/provider processes and own their cache/HOME.
  'src/cli_test.ts',
  'src/harness_integration_test.ts',
])

let tests: string[] = []
let collect = async (dir: string): Promise<void> => {
  for await (let entry of Deno.readDir(dir)) {
    let path = `${dir}/${entry.name}`
    if (entry.isFile && /_test\.tsx?$/.test(entry.name)) {
      tests.push(path)
    } else if (entry.isDirectory && entry.name != 'vendor') {
      await collect(path)
    }
  }
}
for (let dir of ['src', 'bin', 'channels', 'workers']) await collect(dir)
tests.sort()

// A server import is itself process-global state: server.ts binds once, owns
// one db singleton, and installs signal handlers. Addressing `http.addr` makes
// accidental co-location correct for the in-memory HTTP tests, but file-db and
// shutdown tests still require a fresh process, so keep the whole boundary in
// the ordinary runner.
for (let file of tests) {
  let source = await Deno.readTextFile(file)
  if (/(?:from\s*|import\s*\()\s*['"]\.\/server\.ts['"]/.test(source)) {
    isolated.add(file)
  }
}

let common = [
  'test',
  '--frozen',
  // `deno task gate` runs the stricter whole-repo check first. Re-checking
  // every module graph once per pass dominates the few-second test budget and
  // adds no coverage here; direct test runs still exercise module loading.
  '--no-check',
  '-A',
  '--unstable-net',
  '--unstable-worker-options',
  '--fail-fast',
]
function denoDir(): string {
  let configured = Deno.env.get('DENO_DIR')
  if (configured) return configured
  let home = Deno.env.get('HOME')
  if (Deno.build.os === 'darwin') return `${home}/Library/Caches/deno`
  if (Deno.build.os === 'windows') {
    return `${Deno.env.get('LOCALAPPDATA')}\\deno`
  }
  return `${Deno.env.get('XDG_CACHE_HOME') ?? `${home}/.cache`}/deno`
}
export type TestCommand = {
  command: string
  args: string[]
  env?: Record<string, string>
}

export type TestCommandOptions = {
  /** Terminate this process with an accepted/owned signal after cleanup. */
  terminateOnSignal?: boolean
}

type Result = { code: number; signal?: never } | {
  code?: never
  signal: Deno.Signal
}

const cancellationSignals = ['SIGINT', 'SIGTERM'] as const

// `setsid` makes the direct child the leader of a new process group. Deno's
// ChildProcess.kill() reaches only that child, which is not enough for test
// workers that have launched providers or servers of their own.
function spawnGroup(spec: TestCommand): Deno.ChildProcess {
  return new Deno.Command('setsid', {
    args: [spec.command, ...spec.args],
    env: spec.env,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn()
}

function signalGroup(pid: number, signal: Deno.Signal): void {
  try {
    Deno.kill(-pid, signal)
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error
  }
}

async function groupExists(pid: number): Promise<boolean> {
  // Do not spawn `ps`/`kill` while a phase's descendants are settling: the
  // phase process must remain the runner's only child. This runner is used by
  // the Linux self-hosted gate, where procfs exposes each process group.
  for await (let entry of Deno.readDir('/proc')) {
    if (!entry.isDirectory || !/^\d+$/.test(entry.name)) continue
    try {
      let stat = await Deno.readTextFile(`/proc/${entry.name}/stat`)
      let fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
      if (Number(fields[2]) === pid) return true
    } catch (error) {
      // Processes routinely disappear between readdir and read.
      // Linux procfs can report that race as either ENOENT (2) or ESRCH (3),
      // and Deno currently maps the latter to a plain Error rather than
      // Deno.errors.NotFound.
      if (
        !(error instanceof Deno.errors.NotFound) &&
        !(error instanceof Error && /\(os error [23]\)/.test(error.message))
      ) throw error
    }
  }
  return false
}

async function settleGroup(
  pid: number,
  alreadySignaled: boolean,
  startedAt = Date.now(),
): Promise<void> {
  if (!(await groupExists(pid))) return
  if (!alreadySignaled) signalGroup(pid, 'SIGTERM')

  // Cancellation hands us its acceptance time. Time spent discovering a
  // stubborn group is part of the bound, rather than a prelude to it.
  let deadline = startedAt + 2_000
  while (Date.now() < deadline) {
    if (!(await groupExists(pid))) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  signalGroup(pid, 'SIGKILL')
  deadline = Date.now() + 2_000
  while (Date.now() < deadline && await groupExists(pid)) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  if (await groupExists(pid)) {
    throw new Error(`test child process group ${pid} did not settle`)
  }
}

/** Run one fresh process at a time, owning its complete process tree. */
export async function runTestCommands(
  commands: TestCommand[],
  options: TestCommandOptions = {},
): Promise<Result> {
  let active: Deno.ChildProcess | undefined
  let cancellation: (typeof cancellationSignals)[number] | undefined
  let terminalSignal: Deno.Signal | undefined
  let forwarded = false
  let terminating = false
  let settlement: Promise<void> | undefined
  let settlementStarted: (() => void) | undefined

  let startSettlement = (signal?: Deno.Signal): Promise<void> => {
    if (!active) return Promise.resolve()
    if (!settlement) {
      let startedAt = Date.now()
      if (signal) {
        forwarded = true
        signalGroup(active.pid, signal)
      }
      // Mint this promise exactly once while `active` still names the owned
      // group. In particular, do not put it behind active.status: a phase
      // leader is allowed to handle TERM/INT and remain alive.
      settlement = settleGroup(active.pid, !!signal, startedAt)
      settlementStarted?.()
    }
    return settlement
  }

  let handlers = Object.fromEntries(cancellationSignals.map((signal) => {
    let handler = () => {
      // The first signal owns the result. Overlapping/repeated delivery cannot
      // change it or send a second signal while orderly cleanup is in flight.
      if (terminalSignal) return
      cancellation = signal
      terminalSignal = signal
      if (active) {
        // Signal dispatch cannot await, but it can start the one owned
        // settlement clock. The phase-status path below joins this promise.
        void startSettlement(signal).catch(() => {})
      }
    }
    Deno.addSignalListener(signal, handler)
    return [signal, handler]
  })) as Record<(typeof cancellationSignals)[number], () => void>

  let finish = async (result: Result): Promise<Result> => {
    if (!result.signal) return result
    terminalSignal ??= result.signal
    result = { signal: terminalSignal }
    if (!options.terminateOnSignal) return result

    // Keep the other handler installed and inert while handing the accepted
    // signal to the OS. Removing both handlers and returning the signal to a
    // caller creates a window in which a later, different signal can replace
    // the already-settled outcome. A repeat of this same signal is harmless:
    // it has the same terminal status as the accepted outcome.
    if (result.signal === 'SIGINT' || result.signal === 'SIGTERM') {
      Deno.removeSignalListener(result.signal, handlers[result.signal])
    }
    terminating = true
    Deno.kill(Deno.pid, result.signal)
    // Yield to Deno's signal dispatch without reopening the terminal boundary.
    // The opposite handlers stay installed and inert until this process dies.
    return await new Promise<Result>(() => {})
  }

  try {
    for (let spec of commands) {
      if (cancellation) return await finish({ signal: cancellation })
      active = spawnGroup(spec)
      let cancellationStarted = new Promise<void>((resolve) => {
        settlementStarted = resolve
      })
      // No asynchronous work occurs between spawn and ownership above, so a
      // signal handler can never observe an unowned child.
      if (cancellation && !forwarded) {
        void startSettlement(cancellation).catch(() => {})
      }
      let statusPromise = active.status
      let first = await Promise.race([
        statusPromise.then((status) => ({ kind: 'status' as const, status })),
        cancellationStarted.then(() => ({ kind: 'settlement' as const })),
      ])
      // If cancellation won, observe its bounded cleanup before joining the
      // leader. This propagates a failed group bound instead of hiding forever
      // behind a leader status that may never arrive.
      if (first.kind === 'settlement') await settlement
      let status = first.kind === 'status' ? first.status : await statusPromise
      await startSettlement()
      active = undefined
      settlement = undefined
      settlementStarted = undefined

      if (cancellation) return await finish({ signal: cancellation })
      if (status.signal) return await finish({ signal: status.signal })
      if (!status.success) return { code: status.code }
      forwarded = false
    }
    return { code: 0 }
  } finally {
    // A synchronous spawn failure and any future exception still cannot leave
    // an already-owned group behind.
    if (active) {
      let cleanup = startSettlement(cancellation ?? 'SIGTERM')
      // Join leader status and whole-group settlement concurrently. Awaiting
      // the leader first would recreate the unbounded stubborn-handler bug.
      await Promise.all([
        active.status.catch(() => undefined),
        cleanup,
      ])
    }
    if (!terminating) {
      for (let signal of cancellationSignals) {
        Deno.removeSignalListener(signal, handlers[signal])
      }
    }
  }
}

if (import.meta.main) {
  let env = { TEST_DENO_DIR: denoDir() }
  let result = await runTestCommands([
    {
      command: Deno.execPath(),
      args: [...common, '--parallel', ...tests.filter((f) => !isolated.has(f))],
      env,
    },
    {
      command: Deno.execPath(),
      args: [...common, ...tests.filter((f) => isolated.has(f))],
      env,
    },
  ], { terminateOnSignal: true })
  Deno.exit(result.code)
}
