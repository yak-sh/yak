// Every test in the repository, divided by the platform it runs on, and each
// platform's environment started once per run (M-39441):
//
// - deno: every `*_test.ts`, sharded across processes;
// - workerd: every `*_workerd_test.ts`, against the one kernel
//   workers/yak/probe-suite.ts starts for the run.
//
// `deno task test [--only=deno|workerd] [path...]` runs what lies under the
// paths given, or all of it, on every platform or the one named.

import { denoDir } from './testing.ts'

export let ROOTS = ['packages', 'bin', 'workers']

/** A test that runs against the run's kernel, in workerd. */
export let workerd = (file: string) => /_workerd_test\.tsx?$/.test(file)

// Ours only. `node_modules` is walked into otherwise, and a dependency that
// ships its own `*_test.ts` (`@jsr/std__streams` does) is then run as if it
// were this repo's, against an import map that is not its own.
let SKIP = ['vendor', 'node_modules', '.wrangler']

export async function inventory(roots = ROOTS) {
  let tests: string[] = []
  let collect = async (dir: string): Promise<void> => {
    for await (let entry of Deno.readDir(dir)) {
      let path = `${dir}/${entry.name}`
      if (entry.isFile && /_test\.tsx?$/.test(entry.name)) {
        tests.push(path)
      } else if (entry.isDirectory && !SKIP.includes(entry.name)) {
        await collect(path)
      }
    }
  }
  for (let root of roots) {
    let path = root.replace(/\/+$/, '')
    if ((await Deno.stat(path)).isDirectory) await collect(path)
    else tests.push(path)
  }
  return tests.sort()
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
  // No --fail-fast. A suite reports every failure it has: stopping at the
  // first one turns a red run into a single symptom, and the shard that never
  // ran is indistinguishable from a green one.
]

export type TestCommand = {
  command: string
  args: string[]
  env?: Record<string, string>
  /** Names this phase in the runner's closing failure list. */
  label?: string
}

export type SettlementClock = {
  now(): number
  wait(ms: number): Promise<void>
}

const realClock: SettlementClock = {
  now: () => Date.now(),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

export type TestCommandOptions = {
  /** Deadline seam; process ownership and signals remain real. */
  clock?: SettlementClock
  /** Observe deliveries, including repeats while cleanup owns the outcome. */
  onSignal?: (signal: Deno.Signal) => void
  /** Observe each failing phase as it ends; the run continues past it. */
  onFailure?: (spec: TestCommand, code: number) => void
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
  clock: SettlementClock,
  startedAt = clock.now(),
): Promise<void> {
  if (!(await groupExists(pid))) return
  if (!alreadySignaled) signalGroup(pid, 'SIGTERM')

  // Cancellation hands us its acceptance time. Time spent discovering a
  // stubborn group is part of the bound, rather than a prelude to it.
  let deadline = startedAt + 2_000
  while (clock.now() < deadline) {
    if (!(await groupExists(pid))) return
    await clock.wait(10)
  }
  signalGroup(pid, 'SIGKILL')
  deadline = clock.now() + 2_000
  while (clock.now() < deadline && await groupExists(pid)) {
    await clock.wait(10)
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
  let clock = options.clock ?? realClock
  let active: Deno.ChildProcess | undefined
  let failure: Result | undefined
  let cancellation: (typeof cancellationSignals)[number] | undefined
  let terminalSignal: Deno.Signal | undefined
  let forwarded = false
  let terminating = false
  let settlement: Promise<void> | undefined
  let settlementStarted: (() => void) | undefined

  let startSettlement = (signal?: Deno.Signal): Promise<void> => {
    if (!active) return Promise.resolve()
    if (!settlement) {
      let startedAt = clock.now()
      if (signal) {
        forwarded = true
        signalGroup(active.pid, signal)
      }
      // Mint this promise exactly once while `active` still names the owned
      // group. In particular, do not put it behind active.status: a phase
      // leader is allowed to handle TERM/INT and remain alive.
      settlement = settleGroup(active.pid, !!signal, clock, startedAt)
      settlementStarted?.()
    }
    return settlement
  }

  let handlers = Object.fromEntries(cancellationSignals.map((signal) => {
    let handler = () => {
      options.onSignal?.(signal)
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
      if (!status.success) {
        // A failed phase is a result to report, not a reason to skip the
        // phases after it. The first failing code is the run's code; a signal
        // still ends the run at once, since the whole tree is going down.
        failure ??= { code: status.code }
        options.onFailure?.(spec, status.code)
      }
      forwarded = false
    }
    return failure ?? { code: 0 }
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

/** Stable, bounded partition: every module runs exactly once. */
export function shards(files: string[], jobs: number): string[][] {
  if (!Number.isInteger(jobs) || jobs < 1) throw new Error('invalid test jobs')
  let groups = Array.from(
    { length: Math.min(jobs, files.length) },
    () => [] as string[],
  )
  files.forEach((file, i) => groups[i % groups.length].push(file))
  return groups
}

// Writes to a pipe may be short. Finish one report synchronously so another
// shard cannot splice bytes into its test names/durations.
function report(
  stream: { writeSync(bytes: Uint8Array): number },
  bytes: Uint8Array,
) {
  while (bytes.length) bytes = bytes.subarray(stream.writeSync(bytes))
}

// `--bulk <file>...`
if (import.meta.main && Deno.args[0] === '--bulk') {
  // Deno --parallel shares a native SQLite allocator across its worker threads.
  // Separate processes avoid its mutex contention. This coordinator and all
  // its children stay in the outer runner's process group: a signal still
  // settles the complete tree, not just a shard's leader.
  let files = Deno.args.slice(1)
  let jobs = Number(Deno.env.get('DENO_JOBS') ?? navigator.hardwareConcurrency)
  let children = shards(files, jobs).map((f) =>
    new Deno.Command(Deno.execPath(), {
      args: [...common, ...f],
      stdin: 'inherit',
      // Keep each reporter intact: interleaved half-lines would also fool
      // test:budget's per-test duration parser. Drain concurrently below.
      stdout: 'piped',
      stderr: 'piped',
    }).spawn()
  )
  let failed: string[] = []
  await Promise.all(children.map(async (child) => {
    let status = await child.output()
    report(Deno.stdout, status.stdout)
    report(Deno.stderr, status.stderr)
    // Every shard runs to its own end and prints its own report. Exiting here
    // on the first failure killed the shards still running, so their failures
    // were never printed at all.
    if (!status.success) {
      failed.push(`test shard ${child.pid}: ${status.signal ?? status.code}`)
    }
  }))
  for (let line of failed) console.error(line)
  if (failed.length) Deno.exit(1)
} else if (import.meta.main) {
  let only = Deno.args.find((a) => a.startsWith('--only='))?.slice(7)
  let paths = Deno.args.filter((a) => !a.startsWith('--only='))
  let files = (await inventory(paths.length ? paths : ROOTS))
    .filter((f) => !only || workerd(f) == (only == 'workerd'))
  let { sandboxKey } = await import('../workers/yak/probe.ts')
  let stripe = await sandboxKey()
  let env: Record<string, string> = {
    TEST_DENO_DIR: denoDir(),
    DENO_DIR: denoDir(),
    ...stripe ? { STRIPE_KEY: stripe } : {},
  }
  let wd = files.filter(workerd)
  // The kernel starts while the deno pass runs, and is ready by its end.
  let started = wd.length
    ? import('../workers/yak/probe-suite.ts').then((m) => m.probeSuite(stripe))
    : undefined
  started?.catch(() => {})
  let bulk = (label: string, args: string[], extra = {}): TestCommand => ({
    command: Deno.execPath(),
    args: [
      'run',
      '-A',
      '--unstable-worker-options',
      import.meta.filename!,
      '--bulk',
      ...args,
    ],
    env: { ...env, ...extra },
    label,
  })
  let failed: string[] = []
  let options = {
    onFailure: (spec: TestCommand) =>
      failed.push(spec.label ?? spec.args.join(' ')),
  }
  let suite: Awaited<typeof started>
  let result: Result = { code: 1 }
  try {
    result = await runTestCommands([
      bulk('deno', files.filter((f) => !workerd(f))),
    ], options)
    if (started && !result.signal) {
      try {
        suite = await started
      } catch (e) {
        console.error(e)
        failed.push('workerd: the kernel did not start')
        result = { code: 1 }
      }
      if (suite) {
        let passed = await runTestCommands(
          [bulk('workerd', wd, suite.env)],
          options,
        )
        result = passed.signal || !result.code ? passed : result
      }
    }
  } finally {
    await (suite ?? await started?.catch(() => undefined))?.stop()
    // The closing word on a long run: which platforms were red, after every
    // one of them has printed its own report.
    if (failed.length) {
      console.error(`\n─── ${failed.length} failing platform(s) ───`)
      for (let phase of failed) console.error(`  ${phase}`)
    }
  }
  // The code is said last and outright: wrangler's close sets Node's exit
  // code, which is Deno's.
  Deno.exit(result.code ?? (result.signal === 'SIGINT' ? 130 : 143))
}
