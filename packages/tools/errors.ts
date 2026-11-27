// Expected invocation failures, shared by argument parsers and callers without
// loading the graph or the tool runner.
import type { Eid } from '@yaks/graph/bundle'
import { status, unheard } from '@yaks/graph/errors'

export class CallError extends Error {
  constructor(
    public code: string,
    public summary: string,
    public detail?: string,
  ) {
    super(detail ? `${summary}\n${detail}` : summary)
    this.name = 'CallError'
  }
}

/** A stored claim exists but no result does. The caller must reconcile it:
 * running the tool again could repeat an effect the outside world already
 * saw. */
export class UnfinishedCall extends Error {
  constructor(public call: Eid) {
    super('Call execution was started without a recorded result: ' + call)
    this.name = 'UnfinishedCall'
  }
}

/** Work cut off deliberately, not a refusal or a defect. */
export class Interrupted extends Error {
  code: string
  constructor(message: string, code = 'aborted') {
    super(message)
    this.name = 'Interrupted'
    this.code = code
  }
}

/** Say a refusal once when its message already starts with its code. */
export let refusalText = (code: string, message: string): string => {
  let first = /^\w+/.exec(message)?.[0]
  return first && first.toLowerCase() == code.toLowerCase()
    ? message
    : [code, message].filter(Boolean).join(': ')
}

let codes: Record<string, number> = {
  access: 403,
  arguments: 400,
  conflict: 409,
  limit: 429,
  missing: 404,
  unavailable: 503,
}

/** The HTTP status a failure answers with: a refusal's, by its code, else
 * the graph's table (@yaks/graph `status`, 500 for a defect).
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { CallError, statusOf } from './errors.ts'
 *
 * assertEquals(statusOf(new CallError('missing', 'no app a/b')), 404)
 * assertEquals(statusOf(new Error('boom')), 500)
 * ```
 */
export let statusOf = (e: unknown): number =>
  e instanceof CallError ? codes[e.code] ?? 400 : status(e)

/** A thrown invocation refusal as its JSON HTTP answer, and a service that
 * did not answer for now (@yaks/graph `unheard`) as `unavailable`. Defects
 * are thrown through so the host's failure boundary can report them. */
export let refused = (e: unknown): Response => {
  let code = e instanceof CallError
    ? e.code
    : unheard(e)
    ? 'unavailable'
    : e instanceof Error
    ? e.name.toLowerCase()
    : 'refused'
  let statusCode = statusOf(e)
  if (statusCode >= 500 && !(e instanceof CallError) && !unheard(e)) throw e
  return Response.json({
    error: { code, message: e instanceof Error ? e.message : String(e) },
  }, { status: statusCode })
}
