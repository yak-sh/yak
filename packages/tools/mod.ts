/**
 * @yaks/tools — a tool is a function from bundles to bundles, a CALL is the
 * record of having asked one, and this package is what keeps that record.
 *
 * A host invokes a tool DIRECTLY: `call()` writes the `call` entity, runs the
 * function named by `call.to` with the call's bundles and a host carrying the
 * CALLER's actor, and lands what it answered beside a `result{call, ms}`
 * entity whose id a declared rule's own emit derives. Nothing watches the
 * graph — a call somebody else wrote, or one wearing a wake, is found by
 * registering those same rules as effects (@yaks/effects `on`). See
 * ./runner.ts for the claim, the crash and the schedule.
 *
 * @module
 */

export { callDoc, toolDoc, toolsDoc } from './vocab.ts'
export {
  ailing,
  CHECK,
  checked,
  checks,
  type Finding,
  type Level,
} from './check.ts'
export {
  answerOf,
  CallError,
  faulted,
  type Opts,
  READY,
  reconcile,
  RULES,
  type Runner,
  runner,
  toolEid,
  UnfinishedCall,
  WOKEN,
  worded,
} from './runner.ts'
