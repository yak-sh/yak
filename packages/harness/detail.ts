/** Explicit SOURCE inspection, independent of transcript rendering and search. */
import { valueTools } from '@yaks/blob'
import type { Comp, Graph } from '@yaks/graph'
import { transcriptSegments } from '@yaks/session'

export const SOURCE_LIMIT = 4096
export type SourceRequest = { start?: number; revision?: string }
export type EntrySource = {
  eid: string
  component: string
  property: string
  revision: string
  start: number
  end: number
  total: number
  next: number | null
  text: string
}

/** Authorize against only ancestry and entry positions before loading any body.
 * A fork can inspect its inherited prefix, never its ancestor's later entries.
 * Reuse the graph value tool so revisions and Unicode offsets have one meaning.
 */
export async function entrySource(
  g: Graph,
  session: string,
  eid: string,
  request: SourceRequest = {},
): Promise<EntrySource> {
  if (
    typeof session != 'string' || typeof eid != 'string' || !session || !eid
  ) {
    throw new Error('SOURCE requires a session and entry')
  }
  let [position] = await g.read(
    '.entity.eid=' + JSON.stringify(eid) +
      '&.fields=entry.session,entry.seq&.limit=1',
  )
  let entry = position?.entry as Comp | undefined
  let segments = await transcriptSegments(g, session)
  if (
    !entry ||
    !segments.some((s) =>
      s.session == entry.session && Number(entry.seq) <= s.through
    )
  ) throw new Error('Entry is not in this transcript')
  let [row] = await g.read('.entity.eid=' + JSON.stringify(eid) + '&.limit=1')
  // Stored tool receipts can carry the unabridged output alongside a preview.
  let component = ['context_output', 'content', 'call'].find((name) =>
    typeof (row?.[name] as Comp | undefined)
      ?.[name == 'call' ? 'args' : 'body'] == 'string'
  )
  if (!component) throw new Error('Entry has no text source')
  let property = component == 'call' ? 'args' : 'body'
  let tool = valueTools((id) => Promise.resolve(id == eid ? row : undefined))[0]
  let page = JSON.parse(
    await tool.run({
      entity: eid,
      component,
      property,
      start: request.start,
      revision: request.revision,
      count: SOURCE_LIMIT,
    }),
  )
  return { eid, component, property, ...page }
}
