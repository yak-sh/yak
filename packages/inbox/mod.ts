/** Pure person and thread attention policy. No I/O or sends. */
import { type Reader, type Row } from './reader.ts'
import { threadOf } from '@yaks/notify'
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

// Single-row views read the person's subscription too; no root mark is personal.
export let isUnread = (r: Row, who: Reader): boolean => {
  let opened = who.attention?.get(threadOf(r, who))?.comps.opened
  return activityAt(r) > String(opened?.at ?? '')
}
