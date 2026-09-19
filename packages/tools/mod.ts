/**
 * @yaks/tools — a tool is a function from bundles to bundles, a CALL is an
 * entity, and this package is the runner between them.
 *
 * Nothing here wires a tool to the `call` and `result` components. The work is
 * found by a declared RULE in the ordinary query grammar (./vocab.json), asked
 * after the commit; the tool named by `call.to` is run with the call's bundles
 * and a host carrying the CALLER's actor; and what it answered is landed in
 * one batch beside a `result{call, ms}` entity whose id the rule's own emit
 * derives. See ./runner.ts for how a claim, a crash and a schedule are handled.
 *
 * @module
 */

export { callDoc, toolDoc, toolsDoc } from './vocab.ts'
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
  WAITING,
  worded,
} from './runner.ts'
