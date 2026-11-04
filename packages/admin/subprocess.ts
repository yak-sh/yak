import * as systemProcess from '@yaks/process/system'
import type { Signal } from '@yaks/process/system'
import { command as processCommand } from '@yaks/process/command'
import type {
  ChildProcess,
  CommandOptions,
  CommandOutput,
  CommandStatus,
} from '@yaks/process/command'
import { Interrupted } from '@yaks/tools/errors'

/** How long an interrupted command has to stop before its group is killed. */
export let GRACE = 5_000

let interrupted = () =>
  new Interrupted('the platform operation was interrupted', 'signal')

let SIGNALS = ['SIGTERM', 'SIGINT', 'SIGHUP']

/** Whether the process was interrupted directly, before its host observed it. */
export let wasInterrupted = (status: CommandStatus): boolean =>
  status.signal != null && SIGNALS.includes(status.signal)

/**
 * Start one platform command under the host's lifetime. The command gets its
 * own process group, so a signal to `yak` reaches the host first instead of
 * becoming a child failure. Stopping the host then interrupts that whole
 * group, including wrappers such as npx and every child they started.
 */
export let spawn = (
  command: string,
  options: CommandOptions,
  stopping: AbortSignal,
): {
  child: ChildProcess
  stopped: () => boolean
  stop: () => void
  finish: () => Promise<void>
} => {
  if (stopping.aborted) throw interrupted()
  let child = processCommand(command, { ...options, detached: true }).spawn()
  let stopped = false
  let kill: ReturnType<typeof setTimeout> | undefined
  let group = (signal: Signal) => {
    try {
      systemProcess.kill(-child.pid, signal)
    } catch { /* The group is gone. */ }
  }
  let stop = () => {
    if (stopped) return
    stopped = true
    group('SIGINT')
    kill = setTimeout(() => group('SIGKILL'), GRACE)
  }
  stopping.addEventListener('abort', stop, { once: true })
  return {
    child,
    stopped: () => stopped,
    stop,
    finish: async () => {
      stopping.removeEventListener('abort', stop)
      try {
        await child.status
      } finally {
        clearTimeout(kill)
      }
    },
  }
}

/** Run a finite platform command and collect what it wrote. */
export let output = async (
  command: string,
  options: CommandOptions,
  stopping: AbortSignal,
): Promise<CommandOutput> => {
  let run = spawn(command, options, stopping)
  let finished = false
  try {
    let result = await run.child.output()
    finished = true
    if (run.stopped() || wasInterrupted(result)) throw interrupted()
    return result
  } finally {
    if (!finished) run.stop()
    await run.finish()
  }
}
