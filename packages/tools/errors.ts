// Expected invocation failures, shared by argument parsers and callers without
// loading the graph or the tool runner.
import type { Eid } from '@yaks/graph/bundle'
import { status, unheard } from '@yaks/graph/errors'

export class CallError extends Error {
  constructor(public code: string, message: string) {
    super(message)
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
  let statusCode = e instanceof CallError ? codes[code] ?? 400 : status(e)
  if (statusCode >= 500 && !(e instanceof CallError) && !unheard(e)) throw e
  return Response.json({
    error: { code, message: e instanceof Error ? e.message : String(e) },
  }, { status: statusCode })
}
