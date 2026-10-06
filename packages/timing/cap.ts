/** Bound a captured tree without losing inclusive measurements. An omitted
 * subtree's rows, statements and time remain in its nearest retained parent;
 * adding them again would double count measurements already propagated there. */
import type { Event } from '@yaks/trace'

export let TRACE_MAX_SPANS = 200

/** Keep the root, then expensive spans (rows read plus written, then duration)
 * and their ancestors. A candidate is admitted only with its entire path.
 * Output keeps capture order and identities; events and counts are unchanged.
 * A retained parent's inclusive count minus its retained children's counts is
 * its own work plus folded work, so the tree still sums to the request total. */
export let cap = (spans: readonly Event[]): readonly Event[] => {
  if (spans.length <= TRACE_MAX_SPANS) return spans
  let events = new Map(spans.map((event) => [event.id, event]))
  let kept = new Set([spans[0].id])
  let rows = (event: Event) =>
    (event.counts?.rowsRead ?? 0) + (event.counts?.rowsWritten ?? 0)
  let ranked = spans.slice(1).sort((a, b) =>
    rows(b) - rows(a) || (b.duration ?? 0) - (a.duration ?? 0)
  )
  for (let event of ranked) {
    if (kept.size == TRACE_MAX_SPANS) break
    let path: string[] = [], seen = new Set<string>()
    let ancestor: Event | undefined = event
    while (
      ancestor && !kept.has(ancestor.id) && !seen.has(ancestor.id) &&
      path.length <= TRACE_MAX_SPANS - kept.size
    ) {
      seen.add(ancestor.id)
      path.push(ancestor.id)
      ancestor = events.get(ancestor.parent ?? '')
    }
    // Root-first recordings have one connected tree. Never retain a cycle or
    // an unrelated event as another root when closing a candidate's path.
    if (!ancestor || !kept.has(ancestor.id)) continue
    if (kept.size + path.length > TRACE_MAX_SPANS) continue
    for (let id of path) kept.add(id)
  }
  return spans.filter((event) => kept.has(event.id))
}
