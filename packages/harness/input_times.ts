import type { Bundle, Comp } from '@yaks/graph'
import { attemptState, kindOf, seqOf, textOf } from '@yaks/session'

/** Sent time beside completion of the reply to the preceding input, even when
 * that input arrived while the reply was streaming. Never use output creation:
 * streaming creates it before the reply is finished. */
export let inputText = (entry: Bundle, transcript: Bundle[]): string => {
  let sent = (entry.created as Comp | undefined)?.at
  if (entry.notice || typeof sent != 'string') return textOf(entry)
  let byId = new Map(transcript.map((b) => [b.entity.eid, b]))
  let previous = transcript.findLast((b) => {
    if (kindOf(b) != 'output' || !b.content || b.notice) return false
    let ask = byId.get(String((b.output as Comp)?.source))
    let through = ask && byId.get(String((ask.ask as Comp)?.through))
    return through && seqOf(through) < seqOf(entry)
  })
  let ask = previous && byId.get(String((previous.output as Comp)?.source))
  let ended = ask && attemptState(ask) == 'completed'
    ? (ask.updated as Comp | undefined)?.at
    : undefined
  return `[Sent ${sent}; previous reply ended ${
    ended ?? (previous ? 'unknown' : 'none')
  }]\n` +
    textOf(entry)
}
