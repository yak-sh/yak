// The wire to the host (@yaks/api): its bundles, and the Change rows the views
// speak, each read as the other; and the query line a subscription sends.
import type { Bundle } from '@yaks/graph'
import type { Change } from './types.ts'

/** Changes as /apply bundles. Plain patches coalesce; removing then adding
 * a component stays ordered, because it replaces the held component. */
export let bundlesOf = (changes: Change[]): Bundle[] => {
  let rows = new Map<string, Bundle[]>()
  for (let { eid, name, comp, was } of changes) {
    let parts = rows.get(eid)
    if (!parts) rows.set(eid, parts = [{ entity: { eid } }])
    let row = parts.at(-1)!
    if (name == 'entity') {
      if (was) row.$was = { ...row.$was, entity: was }
      if (comp === null) {
        rows.set(eid, [{
          entity: { eid },
          tombstone: {},
          ...row.$was ? { $was: row.$was } : {},
        }])
      }
      continue
    }
    if (row.tombstone) continue
    if (row[name] === null && comp !== null) {
      parts.push(row = { entity: { eid } })
    }
    if (was) row.$was = { ...row.$was, [name]: { ...row.$was?.[name], ...was } }
    let { eid: _, ...cols } = comp ?? {}
    row[name] = comp === null
      ? null
      : { ...(row[name] as Record<string, unknown> | null), ...cols }
  }
  return [...rows.values()].flat()
}

/** Bundles as changes: the spine as the `entity` row, each component as its
 * own, a removed one as null, and a tombstone as the entity's death. */
export let changesOf = (rows: Bundle[]): Change[] =>
  rows.flatMap((b): Change[] => {
    let eid = b.entity.eid
    if (b.tombstone) return [{ eid, name: 'entity', comp: null }]
    let { eid: _, ...spine } = b.entity
    return [
      { eid, name: 'entity', comp: spine },
      ...Object.entries(b)
        .filter(([name]) => name != 'entity' && !name.startsWith('$'))
        .map(([name, comp]) => ({
          eid,
          name,
          comp: comp as Record<string, unknown> | null,
        })),
    ]
  })

/** A view's query line as the host reads it: an id list is `.entity.eid=`. */
export let yakLine = (q: string): string =>
  q.split('&')
    .map((term) =>
      term.startsWith('id=') ? `.entity.eid=${term.slice(3)}` : term
    )
    .join('&')
