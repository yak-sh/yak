// Archive marks change what a model may read, while the transcript stays intact.
import type { Bundle, Comp } from '@yaks/graph'
import { sha256 } from '@yaks/graph/sha256'
import { groupBy } from '@yaks/fp'
import { kindOf, ordered, seqOf, sourceOf } from './state.ts'

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

let callOf = (b: Bundle): string | undefined => {
  let call = ((b.result ?? b.tool_progress) as Comp | undefined)?.call
  return call == null ? undefined : String(call)
}

/** The seq of the request a session's newest reply answered: what came before
 * it is what that reply was written with in view. None before it has said
 * anything of its own; reasoning and notices are not replies. */
export let replied = (
  entries: Bundle[],
  session: string,
): number | undefined => {
  let reply = ordered(entries).findLast((b) =>
    kindOf(b) == 'output' && !b.notice && !b.reasoning &&
    (b.entry as Comp | undefined)?.session == session
  )
  let ask = reply && entries.find((b) => b.entity.eid == sourceOf(reply))
  return ask && seqOf(ask)
}

/** A worker's report: the end of a child session as its parent was told it
 * (`delivery`), or what a session it started wrote to it through the bus
 * (`attention{worker}`). Never words a person wrote. */
let report = (b: Bundle): boolean =>
  !!b.delivery || (b.attention as Comp | undefined)?.worker != null

/** What a session that drops leaves out of its next request, among `lines`
 * (its calls, their answers and its workers' reports): those that came before
 * the request its newest reply answered (`before`, {@link replied}). That
 * reply is what keeps what the session took from them. A call goes with its
 * result and every other answer to it, so one still running, or answered
 * since, stays whole. */
export let answered = (lines: Bundle[], before: number): Bundle[] => {
  let early = (b: Bundle) => seqOf(b) < before
  let answers = groupBy(lines.filter(callOf), callOf)
  let done = new Set(
    lines.filter((b) => {
      let to = answers.get(b.entity.eid) ?? []
      return b.call && early(b) && to.some((a) => a.result) && to.every(early)
    }).map((b) => b.entity.eid),
  )
  return lines.filter((b) =>
    !b.archived &&
    (b.call
      ? done.has(b.entity.eid)
      : callOf(b)
      ? done.has(callOf(b)!)
      : report(b) && early(b))
  )
}

/** The last elision boundary this conversation sent, including on retries.
 * A fork that has asked nothing yet inherits the boundary its parent's last
 * ask sent: what the parent stopped sending, the fork does not send either. */
export let elidedBefore = (
  entries: Bundle[],
  session: string,
): number => {
  let asks = entries.filter((b) => kindOf(b) == 'ask')
  let ask =
    asks.findLast((b) => (b.entry as Comp | undefined)?.session == session) ??
      asks.at(-1)
  return Number((ask?.ask as Comp | undefined)?.elided_before ?? 0)
}

/** A prompt note admitted for one turn, such as an opened Read. */
export let turnNote = (b: Bundle): boolean =>
  (b.prompt as Comp | undefined)?.scope == 'turn'

/** Advance the boundary past what the Operator has answered, stopping at
 * the current input and any turn notes admitted immediately before it. */
export let nextElision = (entries: Bundle[], session: string): number => {
  let own = entries.filter((b) =>
    (b.entry as Comp | undefined)?.session == session
  )
  let from = own.findLastIndex((b) =>
    kindOf(b) == 'input' && !b.prompt && !b.notice && !report(b)
  )
  while (from > 0 && turnNote(own[from - 1])) from--
  return Math.max(
    elidedBefore(entries, session),
    from < 0 ? 0 : Math.min(seqOf(own[from]), replied(entries, session) ?? 0),
  )
}

/** The prompt's view of the conversation after a cold turn. Omit old turn
 * notes and use the same protocol-pair and report selection as a drop, over
 * the whole transcript: a fork's inherited history too. */
export let elide = (entries: Bundle[], before: number): Bundle[] => {
  if (!before) return entries
  let gone = new Set(answered(entries, before))
  return entries.filter((b) =>
    !gone.has(b) && !(seqOf(b) < before && turnNote(b))
  )
}
