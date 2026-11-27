// Platform-specific advice for refused queries from app pages and agents.
import { tokens } from '@yaks/query/core'
import { PLATFORM_STORE } from './names.ts'

let trashList = (space?: string) =>
  `${space ? `app_list(space: '${space}')` : 'app_list()'} lists ` +
  "retained apps and their eids in the Trash section. To restore one, call app_restore(app: '<eid>')."

let trashQuery = '.app .trashed ?doc ?former'

/** How to list app trash from the connector or the platform directory. */
export let TRASH_QUERY: string =
  `${trashList('<space slug>')} Platform admins can query the directory ` +
  `with '${trashQuery} .in=${PLATFORM_STORE}'. Apps in the trash carry ` +
  'trashed{at, by} alongside app.'

/** Add platform-specific guidance to an unknown-name refusal. The Operator
 * store and platform directory are outside the app's query scope. */
export let queryRefusal = async (
  error: unknown,
  line: string,
  at?: string,
  page = false,
): Promise<string | undefined> => {
  if (!(error instanceof Error)) return
  let message = error.message
  let word = /(?:^|: )unknown prop: \.(\w+)(?= |$)/.exec(message)?.[1]
  let space = at?.split('/')[0]
  if (word == 'in' && !page) {
    return '.in= chooses which app to query. Include a filter for its rows, ' +
      `for example q: ".doc&.in=${at ?? 'recipes'}".`
  }
  let sessionProp = /^\.session is a property, not a component/.test(message)
  let operator = sessionProp ? 'session' : word
  if (
    operator == 'session' || !page && operator &&
      (await import('./operator-vocab.ts')).operatorDoc.$defs
        ?.[operator]?.component
  ) {
    let here = at == PLATFORM_STORE ? '<space>' : space ?? '<space>'
    let hint = `.${operator} is a component in the space's Operator store. ` +
      `In that space’s Operator, add self: true to graph_query with q: '.${operator}'. ` +
      `Platform admins can use yak admin query ${here} '.${operator}' --operator.`
    return sessionProp ? `${message}\n${hint}` : hint
  }
  let tombstone = word == 'tombstone'
  let property = /unknown property: app\.trashed\b/.test(message)
  let trash = word == 'trashed' || property || word == 'app' &&
      tokens(line).some((part) =>
        /^\.app\.trashed\b|^\.(?:trashed|tombstone)$/.test(part)
      )
  if (at == PLATFORM_STORE && (tombstone || trash)) {
    return (property ? `${message}. ` : '') +
      `Apps in the trash carry trashed{at, by} alongside app. In ${PLATFORM_STORE} ` +
      `send q: '${trashQuery}'. To list trash in your own spaces, ${trashList()}`
  }
  if (trash) return trashList(space)
  if (tombstone) {
    return `App queries read live entities. ${trashList(space)} ` +
      'For a deleted data row, send ' +
      "store_inspect(space: '<space slug>', app: '<app slug>', " +
      "eid: '<row eid>'). Use since and until to count deletions in a time window. " +
      'store_restore puts the store back to a moment before the deletion.'
  }
}
