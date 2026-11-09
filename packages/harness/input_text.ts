// Input prose, sender identities and timing, kept separate until prompt assembly.
import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { human } from '@yaks/id'
import {
  attemptState,
  type InputText,
  kindOf,
  seqOf,
  source,
  textOf,
} from '@yaks/session'

let made = (b: Bundle) => (b.created ?? {}) as Comp
let selfOf = (b: Bundle) => (b.entry as Comp | undefined)?.session

/** Each input of a transcript as it is sent: who sent it, where `names`
 * ({@link senders}) knows them, and its sent time beside completion of the
 * reply to the preceding input, even when that input arrived while the reply
 * was streaming. Never use output creation: streaming creates it before the
 * reply is finished. The replies are found once per transcript. */
export let inputText = (
  transcript: Bundle[],
  names = new Map<Eid, string>(),
  inputSource?: (entry: Bundle) => string | undefined,
) => {
  let byId = new Map(transcript.map((b) => [b.entity.eid, b]))
  let replies = transcript.flatMap((b) => {
    if (kindOf(b) != 'output' || !b.content || b.notice) return []
    let ask = byId.get(String((b.output as Comp)?.source))
    let through = ask && byId.get(String((ask.ask as Comp)?.through))
    return ask && through ? [{ ask, through: seqOf(through) }] : []
  })
  return (entry: Bundle): Exclude<InputText, string> => {
    let explicit = (entry.entry as Comp | undefined)?.from
    let from = typeof explicit == 'string' && explicit.trim()
      ? explicit
      : inputSource?.(entry) ?? source(entry, names)
    let sent = made(entry).at
    if (entry.notice || typeof sent != 'string') {
      return { text: textOf(entry), from }
    }
    let previous = replies.findLast((r) => r.through < seqOf(entry))
    let ask = previous?.ask
    let ended = ask && attemptState(ask) == 'completed'
      ? (ask.updated as Comp | undefined)?.at
      : undefined
    return {
      from,
      text:
        `[Sent ${sent}; previous reply ended ${
          ended ?? (previous ? 'unknown' : 'none')
        }]\n` + textOf(entry),
    }
  }
}

/** The names of who sent a transcript's inputs: a person or a persona by its
 * title and id, another session by its id and the persona it wears. Only the
 * writers and instruments of its inputs are read. */
export let senders = async (
  g: Graph,
  transcript: Bundle[],
): Promise<Map<Eid, string>> => {
  let ids = new Set<Eid>()
  for (let b of transcript) {
    if (kindOf(b) != 'input') continue
    let { by, via } = made(b)
    if (typeof by == 'string') ids.add(by)
    if (typeof via == 'string' && via != selfOf(b)) ids.add(via)
  }
  // Read, not got: a read answers each row's number, which its id shows.
  let named = (eids: Iterable<Eid>) =>
    g.read(
      `.entity.eid=${
        [...eids].map((e) => JSON.stringify(e)).join(',')
      } ?person ?persona ?session ?doc`,
    )
  if (!ids.size) return new Map()
  let rows = await named(ids)
  let worn = new Set(rows.flatMap((b) => {
    let p = (b.session as Comp | undefined)?.persona
    return typeof p == 'string' ? [p] : []
  }))
  let personas = new Map(
    (worn.size ? await named(worn) : []).map((b) => [b.entity.eid, b]),
  )
  let id = human(g.vocab)
  let label = (b: Bundle) => {
    let title = (b.doc as Comp | undefined)?.title
    return title ? `${title} (${id(b)})` : id(b)
  }
  return new Map(rows.map((b): [Eid, string] => {
    if (!b.session) return [b.entity.eid, label(b)]
    let p = personas.get(String((b.session as Comp).persona))
    return [b.entity.eid, p ? `${id(b)} wearing ${label(p)}` : id(b)]
  }))
}
