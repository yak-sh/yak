// A transcript's entries, read: what a page or a door showing a session reads,
// apart from the loop that runs one (./react.ts).
import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { ENTRY, FORK } from './native.ts'
import { ordered, seqOf } from './state.ts'
import { UnknownSession } from './unknown.ts'

let comp = (b: Bundle, name: string) => b[name] as Comp | undefined

/** A transcript's entries: a fork's prefix from its parent up to the anchor,
 * then its own, in order. */
export let transcript = async (
  g: Graph,
  session: Eid,
): Promise<Bundle[]> => {
  let [self] = await g.read(
    `.entity.eid=${session}&.session&.fields=entity.eid` +
      (g.vocab.comp(FORK) ? ',fork.from' : ''),
  )
  if (!self) throw new UnknownSession(session)
  let own = await g.read(`.${ENTRY}.session=${session}&*`)
  let from = comp(self, FORK)?.from
  if (!from) return ordered(own)
  let [anchor] = await g.get([String(from)], [ENTRY])
  let parent = anchor && comp(anchor, ENTRY)
  if (!parent) return ordered(own)
  let inherited = await transcript(g, String(parent.session))
  return [
    ...inherited.filter((b) => seqOf(b) <= seqOf(anchor)),
    ...ordered(own),
  ]
}
