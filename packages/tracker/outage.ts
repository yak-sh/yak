// When a platform tracker that does not answer is a failure.
//
// The box asks the platform tracker on clocks of its own: the heal service's
// poll of its bugs (./poll.ts), and the tracker service's standing and
// delivery syncs (./service.ts). A pass the tracker could not answer for now
// (it threw `Unavailable`, ./remote.ts) is a line in the log, and its
// answering again another; the next pass tries again. Only a tracker that has
// not answered for OUTAGE is reported, once, with the last failure as its
// cause, since the box is the witness when the platform tracker is down. A
// pass that has not finished in OUTAGE has hung on this side, and reports
// that, once. A pass this side could not set up (`Misconfigured`: no
// address, no secret, a bad address) reports at once, and once until a pass
// ends otherwise: the remote is read at each use, so the pass after its fix
// goes out. Any other failure (a refusal of what was asked, a bad answer, a
// failure on this side) is a bug now, and reports at once.
import { Misconfigured, Unavailable } from './remote.ts'

/** How a wait is set, returning what cancels it. */
export type Timer = (run: () => void, ms: number) => () => void

/** A wait set with `setTimeout`. */
export let later: Timer = (run, ms) => {
  let id = setTimeout(run, ms)
  return () => clearTimeout(id)
}

/** How long the platform tracker may go unanswered before a pass reports it,
 * in ms: five minutes, ten polls at the default pace. Each request already
 * retries for up to a minute (./remote.ts), and what has passed on its own (a
 * Durable Object reset, a runtime that stalls for half a minute, a bad path to
 * one colo) was over well within it. Past it, the platform's own reports may
 * not be landing, and nobody else is saying so. */
export const OUTAGE = 300_000

export type Watching = {
  /** what makes the passes, at the head of each line: `Tracker poll` */
  name: string
  /** time between passes, in ms */
  every: number
  /** a failure to fix: a pass that failed other than by `Unavailable`, at
   * once (`Misconfigured` once until a pass ends otherwise), the tracker not
   * answering for OUTAGE, once, and a pass running for OUTAGE, once */
  report?: (error: unknown) => void
  /** a pass the tracker could not answer, and its answering again or being
   * set up again (default: `console.warn`) */
  log?: (line: string) => void
  /** how a wait is set (default: `setTimeout`), so a test can hold the clock */
  timer?: Timer
  /** a stop: a pass failing after it decides nothing */
  signal?: AbortSignal
}

/** Runs one pass and keeps its outcome; `close` ends the outage it may be
 * riding out, and the report owed for it. The pass is handed a signal that
 * aborts once it has hung. */
export type Outage =
  & (<T>(pass: (signal: AbortSignal) => Promise<T>) => Promise<T>)
  & { close: () => void }

let failed = (n: number) => `${n} failed ${n == 1 ? 'pass' : 'passes'}`
let minutes = `${OUTAGE / 60_000} minutes`

/** The passes of one asker of the platform tracker, each deciding what its
 * failure is. */
export let outage = (
  {
    name,
    every,
    report = () => {},
    log = console.warn,
    timer = later,
    signal,
  }: Watching,
): Outage => {
  // Since the tracker last answered: the passes it could not answer, the last
  // one's failure, and what cancels the report owed once that lasts OUTAGE,
  // counted from the start of the first of them.
  let down: { failed: number; error?: unknown; cancel: () => void } | undefined
  let over = () => {
    down?.cancel()
    down = undefined
  }
  // The message of the setup failure already reported, while passes keep
  // failing by it.
  let unset: string | undefined
  let pass = async <T>(
    run: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> => {
    // Each pass sets its own clock as it starts. A pass still running when it
    // rings has hung: each request to the tracker ends within a minute
    // (./remote.ts), so the hold-up is this side's. It is reported as that,
    // and let go, so the next pass runs. A pass the tracker could not answer
    // keeps its clock when it is the first since the tracker last answered,
    // and the outage is reported when it rings.
    let running = true
    let hang = new AbortController()
    let hung = Promise.withResolvers<never>()
    let cancel = timer(() => {
      if (signal?.aborted) return
      if (!running) {
        report(
          Error(`Remote tracker has not answered for ${minutes}`, {
            cause: down?.error,
          }),
        )
        return
      }
      let error = Error(`A pass has run for ${minutes} without finishing`)
      hang.abort(error)
      report(error)
      hung.reject(error)
    }, OUTAGE)
    try {
      let value = await Promise.race([
        run(signal ? AbortSignal.any([signal, hang.signal]) : hang.signal),
        hung.promise,
      ])
      running = false
      cancel()
      if (unset) log(`${name}: Remote tracker is set up again`)
      unset = undefined
      if (down) {
        log(
          `${name}: Remote tracker answered again after ${failed(down.failed)}`,
        )
      }
      over()
      return value
    } catch (error) {
      running = false
      if (hang.signal.aborted || signal?.aborted) {
        cancel()
        throw error
      }
      if (!(error instanceof Misconfigured)) unset = undefined
      if (error instanceof Unavailable) {
        if (down) cancel()
        else {
          down = { failed: 0, cancel }
          log(`${name}: ${error.message}; trying again every ${every / 1000} s`)
        }
        down.failed++
        down.error = error
      } else {
        // It answered, wrongly, or this side failed: a bug now, not an outage.
        cancel()
        over()
        if (error instanceof Misconfigured) {
          if (unset != error.message) report(error)
          unset = error.message
        } else report(error)
      }
      throw error
    }
  }
  return Object.assign(pass, { close: over })
}
