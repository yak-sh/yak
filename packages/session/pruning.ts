// Archive marks change what a model may read, while the transcript stays intact.
import type { Bundle, Comp } from '@yaks/graph'
import { sha256 } from '@yaks/graph/sha256'

/** A snapshot of the archive marks in a model context. */
export let pruning = (entries: Bundle[]): string | undefined => {
  let ids = entries.filter((b) => b.archived)
    .map((b) => b.entity.eid).sort()
  return ids.length ? sha256(JSON.stringify(ids)) : undefined
}

/** A summary is usable only with the same omissions it summarized. This also
 * invalidates summaries of earlier summaries after an archive or restore. */
export let checkpointOf = (entries: Bundle[]): Bundle | undefined => {
  let fingerprint = pruning(entries)
  return entries.findLast((b) => {
    let mark = b.checkpoint as Comp | undefined
    return mark && !b.archived &&
      mark.pruning === fingerprint
  })
}

/** A call and its answers travel together, even when an archive cuts the pair. */
export let unarchived = (entries: Bundle[]): Bundle[] => {
  let calls = new Set(
    entries.filter((b) => b.archived).flatMap((b) => [
      ...b.call ? [b.entity.eid] : [],
      ...b.result || b.tool_progress
        ? [String(((b.result ?? b.tool_progress) as Comp).call)]
        : [],
    ]),
  )
  let fingerprint = pruning(entries)
  let invalid = new Set(
    entries.filter((b) =>
      b.checkpoint && (
        b.archived || (b.checkpoint as Comp).pruning !==
          fingerprint
      )
    ).map((b) => b.entity.eid),
  )
  return entries.filter((b) =>
    !b.archived && !invalid.has(b.entity.eid) && !calls.has(b.entity.eid) &&
    !calls.has(
      String(((b.result ?? b.tool_progress) as Comp | undefined)?.call),
    ) &&
    !invalid.has(String((b.task_context as Comp | undefined)?.checkpoint))
  )
}
