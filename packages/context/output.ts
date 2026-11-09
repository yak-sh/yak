/** Model-facing views of complete tool results. Programs keep their full answers. */
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { snapshot } from './mod.ts'
import { derivedEid } from '@yaks/graph/identity'
import { resultBytes, resultSummary } from './result.ts'

export const OUTPUT_LIMIT = 16_384
export type KeepOutput = (value: unknown, source: Bundle) => Promise<unknown>

/** JSON answers retain their structure; ordinary tool prose remains text. */
export let outputValue = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** The source entry remains unchanged. Hosts may supply a scoped snapshot store. */
export const outputView = async (
  g: Graph,
  entry: Bundle,
  limit = OUTPUT_LIMIT,
  keep?: KeepOutput,
): Promise<string> => {
  if (!Number.isSafeInteger(limit) || limit < 512) {
    throw new Error('output limit must be an integer >= 512')
  }
  let text = String((entry.content as Comp | undefined)?.body ?? '')
  let value = (entry.output as Comp | undefined)?.value ?? outputValue(text)
  if (
    resultBytes(value) <= limit &&
    new TextEncoder().encode(text).length <= limit
  ) return text
  if (keep) return JSON.stringify(await keep(value, entry))
  let body = (entry.output as Comp | undefined)?.value == null
    ? text
    : JSON.stringify(value)
  let revision = (await snapshot(body, entry.entity.eid)).revision
  let handle = derivedEid('output:' + entry.entity.eid + ':' + revision)
  let [existing] = await g.get([handle], ['context_output'])
  if (!existing?.context_output) {
    await g.apply([{
      entity: { eid: handle },
      context_output: { source: entry.entity.eid, revision, body },
    }], { trusted: true })
  } else if ((existing.context_output as Comp).body !== body) {
    throw new Error('Stored output snapshot does not match its revision')
  }
  let summary = resultSummary(handle, value)
  summary.message =
    'The complete result is kept in the graph. Use result_query({id, query}) with jq syntax, or graph_value_read and graph_value_search with entity=id, component=context_output, property=body. The preview is abbreviated.'
  return JSON.stringify({ ...summary, revision })
}
