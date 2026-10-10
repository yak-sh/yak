// Whether an exception is actionable.

// Failures that clear on their own. Reporting one is noise; teach a new
// transient by adding a line.
let transient = [
  /timed? ?out|timeout/i,
  /temporarily unavailable|try again|rate limit/i,
  /econnreset|econnrefused|socket hang up|network/i,
  /\bhttp 5\d\d\b/i, // the provider's server failed, not this code
  /responses: transport failed/i,
]

/**
 * Whether a failure is worth reporting: anything but a known transient.
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
