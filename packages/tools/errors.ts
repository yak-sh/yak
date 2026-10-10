// Expected invocation failures, shared by argument parsers and callers without
// loading the graph or the tool runner.
export class CallError extends Error {
  constructor(public code: string, message: string) {
    super(message)
    this.name = 'CallError'
  }
}
