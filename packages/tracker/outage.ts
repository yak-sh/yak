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
// failure on this side) is a bug now, and reports at once. Both the outage and
// the setup failure are @yaks/effects/outage's record, as the mail pull's and
// the embedding drain's are: a pass decides on its own clock whether the
// outage has lasted OUTAGE, and only a hang needs a timer.
import { failing, type Outage } from '@yaks/effects/outage'
import { type Clock, system } from '@yaks/fp'
import { Misconfigured, Unavailable } from './remote.ts'

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
  /** what time it is and how a wait is set (default: the runtime's), so a
   * test can hold the clock */
  clock?: Clock
  /** a stop: a pass failing after it decides nothing */
  signal?: AbortSignal
}

/** Runs one pass and keeps its outcome; `close` ends the outage it may be
 * riding out. The pass is handed a signal that aborts once it has hung. */
export type Watched =
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
    clock = system,
    signal,
  }: Watching,
): Watched => {
  // Since the tracker last answered, counted from the start of the first pass
  // it could not answer: how many it could not.
  let down: (Outage & { failed: number }) | undefined
  // The setup failure already reported, its message the cause, while passes
  // keep failing by it.
  let unset: Outage | undefined
  let pass = async <T>(
    run: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> => {
    // Each pass sets a clock as it starts. A pass still running when it rings
    // has hung: each request to the tracker ends within a minute
    // (./remote.ts), so the hold-up is this side's. It is reported as that,
    // and let go, so the next pass runs.
    let began = clock.now()
    let hang = new AbortController()
    let hung = Promise.withResolvers<never>()
    let cancel = clock.after(OUTAGE, () => {
      if (signal?.aborted) return
      let error = Error(`A pass has run for ${minutes} without finishing`)
      hang.abort(error)
      report(error)
      hung.reject(error)
    })
    try {
      let value = await Promise.race([
        run(signal ? AbortSignal.any([signal, hang.signal]) : hang.signal),
        hung.promise,
      ])
      cancel()
      if (unset) log(`${name}: Remote tracker is set up again`)
      unset = undefined
      if (down) {
        log(
          `${name}: Remote tracker answered again after ${failed(down.failed)}`,
        )
      }
      down = undefined
      return value
    } catch (error) {
      cancel()
      if (hang.signal.aborted || signal?.aborted) throw error
      if (!(error instanceof Misconfigured)) unset = undefined
      if (error instanceof Unavailable) {
        let { outage, fresh, stayed } = failing(down, began, { limit: OUTAGE })
        if (fresh) {
          log(`${name}: ${error.message}; trying again every ${every / 1000} s`)
        }
        down = { ...outage, failed: (down?.failed ?? 0) + 1 }
        if (stayed != null) {
          report(
            Error(`Remote tracker has not answered for ${minutes}`, {
              cause: error,
            }),
          )
        }
      } else {
        // It answered, wrongly, or this side failed: a bug now, not an outage.
        down = undefined
        if (error instanceof Misconfigured) {
          let made = failing(unset, began, { cause: error.message })
          unset = made.outage
          if (made.fresh) report(error)
        } else report(error)
      }
      throw error
    }
  }
  return Object.assign(pass, { close: () => void (down = undefined) })
}
