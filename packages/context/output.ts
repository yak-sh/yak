/** Bounded model-facing views of stored tool results. No filesystem access. */
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { snapshot } from './mod.ts'

export const OUTPUT_LIMIT = 16_384
const bodyOf = (b: Bundle) =>
  String((b.content as Comp | undefined)?.body ?? '')
const chars = (text: string) => Array.from(text)

/** The source entry remains unchanged; snapshot text uses the blob storage layer. */
export const outputView = async (
  g: Graph,
  entry: Bundle,
  limit = OUTPUT_LIMIT,
): Promise<string> => {
  if (!Number.isSafeInteger(limit) || limit < 512) {
    throw new Error('output limit must be an integer >= 512')
  }
  const text = bodyOf(entry)
  if (text.length <= limit) return text
  const points = chars(text)
  if (points.length <= limit) return text
  const revision = (await snapshot(text, entry.entity.eid)).revision
  const handle = 'output:' + entry.entity.eid + ':' + revision
  const existing = (await g.read('.entity.eid=' + JSON.stringify(handle)))[0]
  if (!existing?.context_output) {
    await g.apply([{
      entity: { eid: handle },
      context_output: { source: entry.entity.eid, revision, body: text },
    }], { trusted: true })
  } else if ((existing.context_output as Comp).body !== text) {
    throw new Error('Stored output snapshot does not match its revision')
  }
  return [
    '[Large tool result; full text retained in storage, not included here.]',
    'Handle: ' + handle,
    'Expected revision: ' + revision +
    ' (pass as revision to inspection tools).',
    'Size: ' + points.length + ' Unicode code points; ' +
    new TextEncoder().encode(text).length + ' UTF-8 bytes.',
    'Use graph_value_read or graph_value_search with entity=' + handle +
    ', component=context_output, property=body. Offsets are zero-based Unicode code points.',
    'Preview (first 512 code points):',
    points.slice(0, 512).join(''),
  ].join('\n')
}
