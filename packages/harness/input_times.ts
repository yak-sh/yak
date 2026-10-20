import type { Bundle, Comp } from '@yaks/graph'
import { attemptState, kindOf, seqOf, textOf } from '@yaks/session'

/** Each input of a transcript as it is sent: its sent time beside completion
 * of the reply to the preceding input, even when that input arrived while the
 * reply was streaming. Never use output creation: streaming creates it before
 * the reply is finished. The replies are found once per transcript. */
export let inputText = (transcript: Bundle[]) => {
  let byId = new Map(transcript.map((b) => [b.entity.eid, b]))
  let replies = transcript.flatMap((b) => {
    if (kindOf(b) != 'output' || !b.content || b.notice) return []
    let ask = byId.get(String((b.output as Comp)?.source))
    let through = ask && byId.get(String((ask.ask as Comp)?.through))
    return ask && through ? [{ ask, through: seqOf(through) }] : []
  })
  return (entry: Bundle): string => {
    let sent = (entry.created as Comp | undefined)?.at
    if (entry.notice || typeof sent != 'string') return textOf(entry)
    let previous = replies.findLast((r) => r.through < seqOf(entry))
    let ask = previous?.ask
    let ended = ask && attemptState(ask) == 'completed'
      ? (ask.updated as Comp | undefined)?.at
      : undefined
    return `[Sent ${sent}; previous reply ended ${
      ended ?? (previous ? 'unknown' : 'none')
    }]\n` +
      textOf(entry)
  }
}
