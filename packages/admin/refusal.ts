import { CallError } from '@yaks/tools/errors'

// An expected refusal of this invocation, not a platform fault.
export class Refused extends CallError {
  constructor(message: string) {
    super('refused', message)
  }
}
