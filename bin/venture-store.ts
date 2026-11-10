// Copy an imported source into a yaks.app store through its door, then read
// the store again: the copy succeeds only when every projected row stands as
// it was sent. A repeated load writes only rows whose projection changed.
import type { Bundle } from '@yaks/graph'
import { storeApply, storeQuery } from '../packages/admin/api.ts'
import { copy, type Imported, type Inventory } from './venture-import.ts'

let canonical = (value: unknown): string =>
  JSON.stringify(
    value,
    (_, v) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a < b ? -1 : 1),
        )
        : v,
  )
let same = (stored: Bundle, value: Bundle) =>
  Object.keys(value).filter((c) => c !== 'entity').every((c) =>
    canonical(stored[c]) === canonical(value[c])
  )

/** `held` is the query naming every row this installation owns in the store. */
export let storeCopy = async (
  bearer: string,
  at: string,
  held: string[],
  imported: Inventory,
  project: (row: Imported) => Bundle | undefined,
) => {
  let read = async () =>
    new Map(
      (await storeQuery(bearer, at, held) as Bundle[]).map((row) => [
        row.entity.eid,
        row,
      ]),
    )
  let rows = await read(), pending: Bundle[] = []
  let written = await copy(imported, {
    project,
    get: (eid) => rows.get(eid),
    put: (eid, value) => {
      pending.push(value)
      rows.set(eid, { ...value, entity: { eid } })
    },
    same,
  })
  for (let i = 0; i < pending.length; i += 20) {
    await storeApply(bearer, at, pending.slice(i, i + 20))
  }
  let stored = await read()
  let reread = await copy(imported, {
    project,
    get: (eid) => stored.get(eid),
    put: () => {
      throw new Error('The store does not hold what was written')
    },
    same,
  })
  return { written, reread }
}
