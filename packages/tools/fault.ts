// An exception keeps what the runtime caught; reporting skips failures that
// clear on their own, whether the exception was recorded or storage failed.
import type { Comp } from '@yaks/graph'

let transient = [
  /timed? ?out|timeout/i,
  /temporarily unavailable|try again|rate limit/i,
  /econnreset|econnrefused|socket hang up|network/i,
  /\bhttp 5\d\d\b/i,
  /responses: transport failed/i,
]

/** Whether a failure is worth reporting: anything but a known transient. */
export let actionable = (message: string): boolean =>
  !transient.some((re) => re.test(message))

/** The original error's type, message and stack for an exception record. */
export let exceptionOf = (error: unknown): Comp =>
  error instanceof Error
    ? {
      type: error.name,
      value: error.message,
      ...error.stack ? { stack: error.stack } : {},
    }
    : { value: String(error) }
