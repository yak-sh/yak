// Whether a session's run is over, read from the graph alone. It touches no
// disk and no process, so a Worker (a trial on yaks.app) imports it without
// the launcher behind @yaks/spawn/tools.
import type { Bundle, Graph } from '@yaks/graph'
import { EXIT, PROCESS } from '@yaks/process/vocab'
import { latestRequest, receiptOf, seqOf } from '@yaks/session'

/** The statuses that end a transcript-only run's current turn. A managed run
 * is instead judged by its process exit (see {@link over}). */
export let ENDED: ReadonlySet<string> = new Set([
  'settled',
  'stopped',
  'failed',
])

/** Whether a session's run is over, given the status its entries leave
 * (@yaks/session `entryStatus`): whatever is behind it is over. A provider
 * that prints its final event and then lingers has a `stop` entry and is
 * still running, so a managed request also waits for the final import
 * receipt; a transcript with no process is over once its turn settles, stops
 * or fails. */
export let over = async (
  graph: Graph,
  row: Bundle,
  status: string,
): Promise<boolean> => {
  if (!row[PROCESS]) return ENDED.has(status)
  if (row[EXIT] == null) return false
  let request = await latestRequest(graph, row.entity.eid)
  if (!request) return true
  let receipt = await receiptOf(graph, row.entity.eid, request.entity.eid)
  return !!receipt && seqOf(receipt) > seqOf(request)
}
