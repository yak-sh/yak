// The persona a transcript wears, said afresh for each ask (agent.ts `wear`):
// read through @yaks/persona alone, so a host that runs no machine (the
// yaks.app Worker) loads nothing of the instruction files beside it.
import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { type Reads, voice, wear } from '@yaks/persona'

// How far up its starters a transcript's persona is looked for: a fork of a
// helper of a conversation is three.
let STARTERS = 16

/** The persona a transcript wears: its own `session.persona`, else that of
 * the session that started it, since a fork or a helper works as the one that
 * started it does. */
export let personaOf = async (
  g: Graph,
  session: Eid,
): Promise<Eid | undefined> => {
  let at: Eid | undefined = session
  for (let i = 0; at && i < STARTERS; i++) {
    let [row]: Bundle[] = await g.get([at], ['session', 'spawned'])
    let persona = (row?.session as Comp | undefined)?.persona
    if (persona) return String(persona)
    let parent = (row?.spawned as Comp | undefined)?.parent
    at = parent ? String(parent) : undefined
  }
}

/** The text of the persona a transcript wears ({@link personaOf}), its bases
 * read from `bases` (@yaks/persona `wear`), or undefined where it wears none.
 * Read on each call, so an edit to the persona or a base reaches a transcript
 * on its next ask. */
export let wornBy = async (
  g: Graph,
  session: Eid,
  bases?: Reads,
): Promise<string | undefined> => {
  let persona = await personaOf(g, session)
  let worn = persona && await wear(g.storage, g.vocab, bases)(persona)
  return worn ? voice(g.vocab)(worn) : undefined
}
