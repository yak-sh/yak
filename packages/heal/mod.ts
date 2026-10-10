/**
 * Reports actionable exceptions through the host and starts fixers for bug
 * tasks already in the graph. The root exports the vocabulary and pure
 * actionable filter; handlers live at `@yaks/heal/effects`.
 */

export { healDoc } from './vocab.ts'
export * from './fault.ts'
