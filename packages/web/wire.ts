// The wire to the host (@yaks/api): its bundles, and the Change rows the views
// speak, each read as the other; and the query line a subscription sends.
import type { Bundle } from '@yaks/graph'
import type { Change } from './types.ts'

/** A batch of changes as the bundles /apply takes, one per entity. The spine
 * is the host's to write, so only a death rides on it, and the `eid` a
 * component row carries in the cache is the bundle's, not the component's. */
export let bundlesOf = (changes: Change[]): Bundle[] => {
  let rows = new Map<string, Bundle>()
  for (let { eid, name, comp } of changes) {
    let row = rows.get(eid)
    if (!row) rows.set(eid, row = { entity: { eid } })
    if (name == 'entity') {
      if (comp === null) rows.set(eid, { entity: { eid }, tombstone: {} })
      continue
    }
    if (row.tombstone) continue
    let { eid: _, ...cols } = comp ?? {}
    row[name] = comp === null
      ? null
      : { ...(row[name] as Record<string, unknown> | null), ...cols }
  }
  return [...rows.values()]
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

// What a view asks for beside its rows that this host answers some other way:
// incident edges are subscriptions of their own (live.ts routeSub), and every
// row arrives whole.
let aside = /^(?:\.edges(?:\.[a-z]+=.*|\[[^\]]*\])?$|\.fields=)/

/** A view's query line as the host reads it: an id list is `.eid=`, and the
 * edge riders and projections are left out. */
export let yakLine = (q: string): string =>
  q.split('&')
    .filter((term) => !aside.test(term))
    .map((term) => term.startsWith('id=') ? `.eid=${term.slice(3)}` : term)
    .join('&')
