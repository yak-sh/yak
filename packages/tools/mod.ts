/**
 * @yaks/tools — a tool is a function that takes entity patches and returns
 * entity patches; a `call` entity is the stored record of having asked for
 * one. This package runs the function and keeps that record.
 *
 * A caller invokes a tool directly: `call()` writes the `call` entity, runs
 * the function named by `call.to` with the call's bundles and a context
 * carrying the caller's identity, and applies what the function returned
 * together with a `result{call, ms}` entity whose id is derived from the rule
 * that emits it. Nothing polls the graph — a call another process wrote, or
 * one deferred by a `wake` component, is picked up by registering those same
 * rules as effects (@yaks/effects `on`). See ./runner.ts for the claim, crash
 * recovery, and scheduling.
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
export { CallError } from './args.ts'
export {
  answerOf,
  faulted,
  type Opts,
  READY,
  reconcile,
  RULES,
  type Runner,
  runner,
  structured,
  toolEid,
  UnfinishedCall,
  WOKEN,
  worded,
} from './runner.ts'
