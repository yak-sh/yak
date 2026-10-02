// Whether a tracked fault is worth a fixer, and its priority.

// TODO T-59079: heal callers move directly onto tracker grouping.
export { faultKey, normalize } from '@yaks/tracker'

// Failures that clear on their own. A task for one is noise; teach a new
// transient by adding a line.
let transient = [
  /timed? ?out|timeout/i,
  /temporarily unavailable|try again|rate limit/i,
  /econnreset|econnrefused|socket hang up|network/i,
  /\bhttp 5\d\d\b/i, // the provider's server failed, not this code
  /responses: transport failed/i,
]

/**
 * Whether a failure is worth a task: anything but a known transient.
 *
 * ```ts
 * import { actionable } from '@yaks/heal'
 *
 * actionable('fetch timed out') // false
 * actionable('no such table: bug') // true
 * ```
 */
export let actionable = (message: string): boolean =>
  !transient.some((re) => re.test(message))

/**
 * The priority a new bug is filed at: 1 where the message says something is
 * missing or broken outright, 2 otherwise.
 *
 * ```ts
 * import { severity } from '@yaks/heal'
 *
 * severity('exit 127: codex not found') // 1
 * severity('unexpected token') // 2
 * ```
 */
export let severity = (message: string): number =>
  /exit (?!0\b)\d|not found|127|cannot |failed to |unable to /i.test(message)
    ? 1
    : 2

let MARK = '\n\n— ↻ '

/**
 * A bug's body with its recurrence line brought up to date: replaced where it
 * has one, appended where it does not, so the body never grows with the storm.
 *
 * ```ts
 * import { recurred } from '@yaks/heal'
 *
 * recurred('it broke', 2, 'noon') // 'it broke\n\n— ↻ recurred 2× · last seen noon'
 * ```
 */
export let recurred = (body: string, hits: number, at: string): string => {
  let i = body.indexOf(MARK)
  return `${i < 0 ? body : body.slice(0, i)}${MARK}recurred ${hits}× · ` +
    `last seen ${at}`
}
