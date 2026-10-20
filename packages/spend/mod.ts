/**
 * Where model tokens go. A duty tallies each UTC day's requests into its
 * `spend` row (./service.ts, ./day.ts); a page and `yak spend show` read the
 * rows. This module is the pure part both sides share: the tally, plan limits
 * and their pace, and the words numbers are said in.
 *
 * @module
 */
export {
  empty,
  ENTRIES,
  type Known,
  merged,
  ranked,
  type Spend,
  spendOf,
  tally,
} from './tally.ts'
export { current, type Limit, limitsOf, paceOf, span } from './window.ts'
export { dollars, label, tokens } from './words.ts'
