// Who hears a text that arrived (@yaks/phone's `text`, read by name). A text
// back from a number a session texted is that session's, while it can hear,
// and its project's operator's once it cannot (./watch.ts `targets`), the
// way a reply to a session's letter is. A text from a number no session
// texted, or that nobody here wrote to, belongs to the project the number it
// reached is filed under (@yaks/project's `filed.project` on the entity
// wearing that `phone{number}`), as a letter to an address filed under a
// project does. `session_texted` knocks that one target once, named for the
// text.

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { human } from '@yaks/id'
import { targets } from './watch.ts'

type G = Pick<Graph, 'vocab' | 'read' | 'get' | 'apply'>

let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp
let str = (v: unknown): string => typeof v == 'string' ? v : ''
let q = JSON.stringify

/** The knock a text that arrived owes: none where `eid` is no arrival, it
 * was knocked for already, or nobody here is its reader. */
export let texted = async (g: G, eid: Eid): Promise<Bundle[]> => {
  if (!g.vocab.comp('knock') || !g.vocab.comp('text')) return []
  let [row] = await g.get([eid])
  let text = comp(row, 'text')
  let from = str(text.from)
  if (!row || row.deliver || !from) return []
  let knock = derivedEid(`session texted ${eid}`)
  if ((await g.get([knock], ['knock']))[0]?.knock) return []
  let [last] = await g.read(
    `.text.to=${q(from)}&.delivered&.order=-delivered.at&.limit=1` +
      `&.fields=created.via`,
  )
  let writer = str(comp(last, 'created').via)
  let [line] = writer || !g.vocab.prop('filed', 'project') ? [] : await g.read(
    `.phone.number=${q(str(text.to))}&.filed.project&.fields=filed.project`,
  )
  let reader = writer || str(comp(line, 'filed').project)
  let [to] = reader ? await targets(g, [reader], new Set()) : []
  if (!to) return []
  let [person] = await g.read(
    `.phone.number=${q(from)}&.doc&.limit=1&.fields=doc.title`,
  )
  let known = person?.entity.eid
  let who = str(comp(person, 'doc').title)
  return [{
    entity: { eid: knock },
    knock: { target: to, ...known ? { from: known } : {} },
    doc: {
      body:
        `text ${human(g.vocab)(row)} from ${
          who ? `${who} (${from})` : from
        }: ` +
        str(comp(row, 'doc').body),
    },
  }]
}

/** The code behind `session_texted`. */
export let text = async (g: G, eid: Eid): Promise<void> => {
  let owed = await texted(g, eid)
  if (owed.length) await g.apply(owed, { trusted: true })
}
