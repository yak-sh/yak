/**
 * A person's conversation with a space's Operator, watched in the tab's page
 * graph (./operator-talk.ts) while the chat page shows it. The page graph
 * says where its tab is, and its door says it on to that Operator, so the
 * person watching is told there and not elsewhere.
 *
 * @module
 */
import { pageGraph } from './page-graph.ts'
import { operatorTalk, operatorTalkWords } from './operator-talk.ts'

/** `person`'s conversation `task` (none for a new chat) with the Operator of
 * the space `space`, watched until it is closed. */
export let pageTalk = (space: string, person: string, task?: string) => {
  let graph = pageGraph([operatorTalkWords], person)
  let watch = graph.watch(operatorTalk(space, task))
  return { close: () => watch.close() }
}
