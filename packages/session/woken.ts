// A persona's standing duty is a wake aimed at it (@yaks/wake's
// `wake{every, target, note}`, read by name): TaskMaster's morning standup is
// `0 7 * * * America/Detroit`, the owner's morning in his time zone. Each time
// the box's clock fires it, `session_woken` knocks the persona's operator once
// with the wake's note, the way a text that arrived does (./texted.ts): the
// session a person opened wearing it, else its project, where the knock waits
// for the next session at work (./listen.ts). Nothing starts a session, and
// what the duty asks for (the standup's letter) is the operator's to write.

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { targets } from './watch.ts'

type G = Pick<Graph, 'vocab' | 'read' | 'get' | 'apply'>

let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp
let str = (v: unknown): string => typeof v == 'string' ? v : ''

/** The knock a wake aimed at a persona owes for its latest firing: none
 * where `eid` is no such wake, it has not fired, or that firing was knocked
 * for already. */
export let woken = async (g: G, eid: Eid): Promise<Bundle[]> => {
  if (!g.vocab.comp('knock') || !g.vocab.comp('wake')) return []
  let [row] = await g.get([eid], ['wake', 'fired'])
  let persona = str(comp(row, 'wake').target)
  let at = str(comp(row, 'fired').at)
  if (!persona || !at) return []
  if (!(await g.get([persona], ['persona']))[0]?.persona) return []
  let knock = derivedEid(`session woken ${eid} ${at}`)
  if ((await g.get([knock], ['knock']))[0]?.knock) return []
  let [to] = await targets(g, [persona], new Set())
  if (!to) return []
  return [{
    entity: { eid: knock },
    knock: { target: to },
    doc: { body: str(comp(row, 'wake').note) || `a wake fired at ${at}` },
  }]
}

/** The code behind `session_woken`. */
export let knock = async (g: G, eid: Eid): Promise<void> => {
  let owed = await woken(g, eid)
  if (owed.length) await g.apply(owed, { trusted: true })
}
