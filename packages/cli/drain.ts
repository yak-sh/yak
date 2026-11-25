// A host leaving the effects pool reports which runs are keeping it open.
// A supervised worker also sets a deadline for handing back those claims.

import type { Effects, Run } from '@yaks/effects'
import { type Clock, system } from '@yaks/fp'

/** How often a drain says what it is still waiting on (ms). */
export let EVERY = 30_000

// A duration as a person reads it.
let took = (ms: number) => {
  let s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`
}

/**
 * What a drain says while runs are going: each run's handler, its target by
 * `name`, and how long it has run.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { waiting } from './drain.ts'
 *
 * let runs = [{ eid: 'r', handler: 'session_run', target: 's', since: 0 }]
 * assertEquals(
 *   waiting(runs, () => 'S-7', 95_000),
 *   'winding down — waiting on session_run S-7 (1m35s)',
 * )
 * ```
 */
export let waiting = (
  runs: Run[],
  name: (eid: string) => string,
  now: number,
): string =>
  'winding down — waiting on ' +
  runs.map((r) => `${r.handler} ${name(r.target)} (${took(now - r.since)})`)
    .join(', ')

/** Leave the pool and wait for what was started, telling `say` what is still
 * running while it goes. */
export let drain = async (
  fx: Pick<Effects, 'stop' | 'running'>,
  say: (line: string) => void,
  every = EVERY,
): Promise<void> => {
  let stopped = fx.stop()
  // Reporting must not query the graph: a busy or blocked read must neither
  // hide the last blockers nor keep an otherwise finished drain open. Full
  // targets and run ids remain resolvable after this process has been killed.
  let tell = () => {
    let runs = fx.running()
    say(
      runs.length
        ? waiting(runs, (eid) => eid, Date.now()) +
          ` [runs: ${runs.map((r) => r.eid).join(', ')}]`
        : 'winding down — waiting on effects pool pass (no handlers running)',
    )
  }
  let timer = setInterval(tell, every)
  try {
    await stopped
  } finally {
    clearInterval(timer)
  }
}

// Reserve five seconds of the worker's shutdown budget to write the handoff.
// Systemd's stop hook reports a forced exit with the diagnostic below.
export let bound = (
  fx: Pick<Effects, 'handoff' | 'running'>,
  stopping: AbortSignal,
  exit: () => void,
  say: (line: string, error?: unknown) => void,
  clock: Clock = system,
): () => void => {
  let deadline = () => {}, handoff = () => {}
  let closed = false
  let force = () => {
    if (closed) return
    closed = true
    deadline()
    exit()
  }
  let give = async (due: number) => {
    let active = fx.running()
    say('yak work shutdown did not drain within 55s')
    if (active.length) {
      say(
        waiting(active, (eid) => eid, clock.now()) +
          ` [runs: ${active.map((r) => r.eid).join(', ')}]`,
      )
    }
    try {
      await fx.handoff(due)
    } catch (error) {
      say('yak work could not hand off its claims', error)
    } finally {
      force()
    }
  }
  let limit = () => {
    let due = clock.now() + 60_000
    deadline = clock.after(60_000, force)
    handoff = clock.after(55_000, () => void give(due))
  }
  stopping.addEventListener('abort', limit, { once: true })
  if (stopping.aborted) limit()
  return () => {
    closed = true
    stopping.removeEventListener('abort', limit)
    deadline()
    handoff()
  }
}
