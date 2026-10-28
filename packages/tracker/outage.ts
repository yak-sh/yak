// When a platform tracker that does not answer is a failure.
//
// The box asks the platform tracker on clocks of its own: the heal service's
// poll of its bugs (./poll.ts), and the tracker service's standing and
// delivery syncs (./service.ts). A pass the tracker could not answer for now
// (it threw `Unavailable`, ./remote.ts) is a line in the log, and its
// answering again another; the next pass tries again. Only a tracker that has
// not answered for OUTAGE is reported, once, with the last failure as its
// cause, since the box is the witness when the platform tracker is down. Any
// other failure (a refusal of what was asked, a bad answer, a failure on this
// side) is a bug now, and reports at once.
import { Unavailable } from './remote.ts'

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
   * once, and the tracker not answering for OUTAGE, once */
  report?: (error: unknown) => void
  /** a pass the tracker could not answer, and its answering again (default:
   * `console.warn`) */
  log?: (line: string) => void
  /** how a wait is set (default: `setTimeout`), so a test can hold the clock */
  timer?: Timer
  /** a stop: a pass failing after it decides nothing */
  signal?: AbortSignal
}

/** Runs one pass and keeps its outcome; `close` ends the outage it may be
 * riding out, and the report owed for it. */
export type Outage = (<T>(pass: () => Promise<T>) => Promise<T>) & {
  close: () => void
}

let failed = (n: number) => `${n} failed ${n == 1 ? 'pass' : 'passes'}`

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
  // one's failure, and what cancels the report owed once that lasts OUTAGE.
  // Its clock starts with the pass, so one that hangs is unanswered too.
  let down: { failed: number; error?: unknown; cancel: () => void } | undefined
  let over = () => {
    down?.cancel()
    down = undefined
  }
  let pass = async <T>(run: () => Promise<T>): Promise<T> => {
    let since = down ??= {
      failed: 0,
      cancel: timer(() => {
        if (signal?.aborted) return
        report(
          Error(
            `Remote tracker has not answered for ${OUTAGE / 60_000} minutes`,
            { cause: since.error },
          ),
        )
      }, OUTAGE),
    }
    try {
      let value = await run()
      if (since.failed) {
        log(
          `${name}: Remote tracker answered again after ${
            failed(since.failed)
          }`,
        )
      }
      over()
      return value
    } catch (error) {
      if (signal?.aborted) throw error
      if (error instanceof Unavailable) {
        if (!since.failed++) {
          log(`${name}: ${error.message}; trying again every ${every / 1000} s`)
        }
        since.error = error
      } else {
        // It answered, wrongly, or this side failed: a bug now, not an outage.
        over()
        report(error)
      }
      throw error
    }
  }
  return Object.assign(pass, { close: over })
}
