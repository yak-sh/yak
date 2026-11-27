// What an agent's refused query line is taught (agent.ts), apart from
// query-line.ts so the gateway's page doors load none of the Operator's
// vocabulary with it.
import { operatorDoc } from '@yaks/platform/operator-vocab'

// Teach after an unknown-name refusal so an app that declares one of these
// names keeps its own meaning. The Operator store is outside app reach.
export let queryRefusal = (error: unknown, at?: string): string | undefined => {
  if (!(error instanceof Error)) return
  let word = /(?:^|: )unknown prop: \.(\w+)(?= |$)/.exec(error.message)?.[1]
  if (word == 'in') {
    return '.in= chooses which app to query. Include a filter for its rows, ' +
      `for example q: ".doc&.in=${at ?? 'recipes'}".`
  }
  if (word && operatorDoc.$defs?.[word]?.component) {
    return `.${word} is a component in the space's Operator store. ` +
      'In that space’s Operator, add self: true to graph_query. ' +
      `Platform admins can use yak admin query ${
        at?.split('/')[0] ?? '<space>'
      } ` +
      `'.${word}' --operator.`
  }
  let tombstone = /unknown prop(?:erty)?: \.?tombstone\b/.test(error.message)
  let trashed = /unknown prop(?:erty)?: \.?app\.trashed\b/.test(error.message)
  if (!tombstone && !trashed) return
  if (at == 'yak/platform' || trashed) {
    return (trashed ? `${error.message}. ` : '') +
      'Apps in the trash carry trashed{at, by}, a separate component. ' +
      "In yak/platform send q: '.app .trashed ?doc ?former'. " +
      "For your own spaces, app_list(space: '<space slug>') lists the " +
      'trash with ids for app_restore.'
  }
  return 'graph_query reads live entities; .tombstone is not a queryable ' +
    "component here. For app trash, app_list(space: '<space slug>') " +
    'lists ids for app_restore. For a deleted data row, send ' +
    "store_inspect(space: '<space slug>', app: '<app slug>', " +
    "eid: '<row eid>'); since and until count deletions in a time window. " +
    'store_restore puts the store back to a moment before the deletion.'
}
