/**
 * A person's conversation with a space's Operator, heard in the tab's page
 * graph (./operator-talk.ts) while the chat page shows it: the row the
 * Operator answers its line with, each time it moves, its reply as written
 * on `typing`. The page graph says where its tab is, and its door says it on
 * to that Operator, so the person watching is told there and not elsewhere.
 *
 * @module
 */
import { pageGraph } from './page-graph.ts'
import {
  operatorTalk,
  operatorTalkWords,
  type Talk,
  type Told,
} from './operator-talk.ts'

/** What the conversation's row says. */
export type Heard = Talk & Told & { typing: string }

/** `person`'s conversation `task` (none for a new chat) with the Operator of
 * the space `space`, watched until it is closed. */
export let pageTalk = (space: string, person: string, task?: string) => {
  let graph = pageGraph([operatorTalkWords], person)
  let watch = graph.watch(operatorTalk(space, task))
  return {
    /** be told the row each time it moves, from now on */
    hear: (fn: (told: Heard) => void): () => void =>
      watch.subscribe(([row]) => {
        if (row?.operatorTalk) fn(row.operatorTalk as Heard)
      }),
    /** be told whether the page graph's socket is open now, and each time
     * it opens (true) or closes */
    connected: (fn: (open: boolean) => void): () => void => {
      let off = graph.wire?.onConnection(fn) ?? (() => {})
      fn(graph.wire?.connected() ?? false)
      return off
    },
    close: () => watch.close(),
  }
}
