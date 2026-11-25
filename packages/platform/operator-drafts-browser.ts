/**
 * A person's drafts in a space's Operator store, kept in the tab's page
 * graph (./operator-drafts.ts): the store a draft desk asks of
 * (@yaks/draft/browser `browserDrafts`), the line it watches, and whether
 * the page graph's socket is open, which says whether a draft has reached
 * the store or is kept on this device.
 *
 * @module
 */
import { draftDoc } from '@yaks/draft/vocab'
import { pageGraph } from './page-graph.ts'
import {
  draftStore,
  operatorDrafts,
  operatorDraftWords,
} from './operator-drafts.ts'

/** `person`'s drafts in the Operator store of the space `space`. */
export let pageDrafts = (space: string, person: string) => {
  let graph = pageGraph([draftDoc, operatorDraftWords], person)
  return {
    store: draftStore(graph, space, person),
    line: () => operatorDrafts(space),
    /** be told whether the page graph's socket is open now, and each time
     * it opens (true) or closes */
    connected: (fn: (open: boolean) => void): () => void => {
      let off = graph.wire?.onConnection(fn) ?? (() => {})
      fn(graph.wire?.connected() ?? false)
      return off
    },
  }
}
