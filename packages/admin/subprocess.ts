import { CallError } from '@yaks/tools'

/** How long an interrupted command has to stop before its group is killed. */
export let GRACE = 5_000

let interrupted = () =>
  new CallError('interrupted', 'the platform operation was interrupted')

/**
 * Start one platform command under the host's lifetime. The command gets its
 * own process group, so a signal to `yak` reaches the host first instead of
 * becoming a child failure. Stopping the host then interrupts that whole
 * group, including wrappers such as npx and every child they started.
 */
export let spawn = (
  command: string,
  options: Deno.CommandOptions,
  stopping: AbortSignal,
): {
  child: Deno.ChildProcess
  stopped: () => boolean
  stop: () => void
  finish: () => Promise<void>
} => {
  if (stopping.aborted) throw interrupted()
  let child = new Deno.Command(command, { ...options, detached: true }).spawn()
  let stopped = false
  let kill: ReturnType<typeof setTimeout> | undefined
  let group = (signal: Deno.Signal) => {
    try {
      Deno.kill(-child.pid, signal)
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
  options: Deno.CommandOptions,
  stopping: AbortSignal,
): Promise<Deno.CommandOutput> => {
  let run = spawn(command, options, stopping)
  let finished = false
  try {
    let result = await run.child.output()
    finished = true
    if (run.stopped()) throw interrupted()
    return result
  } finally {
    if (!finished) run.stop()
    await run.finish()
  }
}
