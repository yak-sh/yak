// @yaks/workflow: a step is a rule stored as a row, a workflow is its steps'
// structure, a case is one item moving through, and `made` says which case and
// step wrote a row.

export { fill, type Filled, writes } from './fill.ts'
export { type Feed, feeds, type Mapped, needs } from './map.ts'
export { DEPTH, rerun, type Step, steps, workflows } from './run.ts'
export { outdated } from './outdated.ts'
export { description, docs, workflowDoc } from './vocab.ts'
