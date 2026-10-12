// Expected invocation failures, shared by argument parsers and callers without
// loading the graph or the tool runner.
import type { Eid } from '@yaks/graph/bundle'

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
