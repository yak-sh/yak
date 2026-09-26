// A run's phases, one fresh process at a time, each owning its whole process
// tree. `setsid` makes every phase the leader of its own group, so a signal to
// the run settles every descendant, a group that outlives its leader is ended
// before the next phase starts, and a stubborn one is bounded by a deadline
// and then SIGKILL. A failing phase is a result to report, never a stop.
//
// bin/test.ts runs its platforms through it; nothing here knows what a test
// is, so a process that only needs the runner loads nothing else.

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

export type Result = { code: number; signal?: never } | {
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
