/** Pure person and thread attention policy. No I/O or sends. */
import { type Row } from './reader.ts'
import { activityAt } from './threads.ts'
export * from './reader.ts'
export { inboxDoc } from './vocab.ts'

export {
  activityAt,
  attention,
  lanes,
  messageAt,
  saidBy,
  stateAt,
  threadOf,
  threads,
} from './threads.ts'
export type { Direction, Lane, Search, Thread } from './threads.ts'

// Single-row views compare their own activity; inbox doors use threads().
export let isUnread = (r: Row): boolean =>
  !r.comps.opened ||
  (!!r.comps.opened.at && activityAt(r) > String(r.comps.opened.at))
