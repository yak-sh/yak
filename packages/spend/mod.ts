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
  type Plan,
  ranked,
  type Rows,
  type Spend,
  spendOf,
  tally,
} from './tally.ts'
export {
  after,
  current,
  dayOf,
  type Limit,
  limitsOf,
  paceOf,
  rates,
  span,
} from './window.ts'
export { dollars, label, percent, tokens } from './words.ts'
