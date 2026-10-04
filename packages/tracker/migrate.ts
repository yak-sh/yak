// The box transition reads the retired title only while moving it to doc.
// Guards preserve a concurrent edit; a conflicting human title stops, never
// discards either value. This module is not imported by the running tracker.
import { type Graph, token } from '@yaks/graph'
import { comp, str, title } from './model.ts'

export let migrateTitles = async (g: Graph): Promise<number> => {
  let rows = await g.read('.bug *')
  let patches = []
  for (let row of rows) {
    let old = comp(row, 'bug').title
    let held = comp(row, 'doc').title
    if (old != null && held && old != held) {
      throw new Error(`conflicting titles on ${row.entity.eid}; neither moved`)
    }
    if (old == null && held) continue
    let occurrences = !old && !held
      ? await g.read(`.error.bug=${row.entity.eid} * .order=error.at .limit=1`)
      : []
    patches.push({
      entity: row.entity,
      $was: { bug: { title: token(old) }, doc: { title: token(held) } },
      doc: {
        title: str(held || old) || (occurrences[0] && title(occurrences[0])) ||
          str(comp(row, 'bug').fault),
      },
      bug: { title: null },
    })
  }
  if (patches.length) await g.apply(patches, { trusted: true })
  return patches.length
}
