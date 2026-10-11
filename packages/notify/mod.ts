/**
 * Being notified. A `knock` is a nudge aimed at an entity, with the message
 * that came with it; a `subscription` records whether somebody watches or mutes
 * that entity, with their archived/opened attention marks on the same row;
 * and a `chat` is an open conversation between an actor and an
 * entity.
 *
 * Pure thread subjects and the notification vocabulary. Graph writes live
 * behind the ./attention boundary.
 */

export { notifyDoc } from './vocab.ts'

/** A thread's subject, following mail reply ancestry before its target. */
export let threadOf = (
  r: ThreadRow,
  who?: ThreadReader,
  byId?: Map<string, ThreadRow>,
  seen: Set<string> = new Set<string>(),
): string => {
  let reply = str(r.comps.mail?.reply_to)
  if (reply && byId?.has(reply) && !seen.has(r.eid)) {
    seen.add(r.eid)
    return threadOf(byId.get(reply)!, who, byId, seen)
  }
  let target = r.comps.mail && who &&
      [who.actor, who.session, who.scope].includes(str(r.comps.mail.target))
    ? ''
    : String(
      r.comps.comment?.target ?? r.comps.signal?.target ??
        r.comps.mail?.target ?? r.comps.knock?.target ?? '',
    )
  return target || str(r.comps.entry?.session ?? r.comps.commit?.target) ||
    r.eid
}

type ThreadRow = { eid: string; comps: Record<string, Record<string, unknown>> }
type ThreadReader = { actor?: string; session?: string; scope?: string }
let str = (v: unknown): string => String(v ?? '')

/** Atomic replacement gives repeated marks a fresh server timestamp. */
export let attention = (eid: string, mark: 'archived' | 'opened') => [
  { entity: { eid }, [mark]: null },
  { entity: { eid }, [mark]: {} },
]
