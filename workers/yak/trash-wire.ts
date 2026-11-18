// The retained-trash request and response wire shared by Store clients.
import type { Bundle } from '@yaks/graph'
import { trashLimit, type TrashPage } from '@yaks/graph/trash'
import { Refused } from '@yaks/graph/errors'

/** Applied restoration patches and names changed to avoid collisions. */
export type Restored = { bundles: Bundle[]; notices: string[] }

export let trashSearch = (
  eids?: string[],
  page: TrashPage = {},
): URLSearchParams => {
  let q = new URLSearchParams((eids ?? []).map((eid) => ['eid', eid]))
  for (let field of ['id', 'after', 'limit'] as const) {
    if (page[field] != null) q.set(field, String(page[field]))
  }
  if (page.before) {
    q.set('beforeAt', page.before.at)
    q.set('beforeId', page.before.id)
  }
  return q
}

export let trashPage = (url: URL): TrashPage => {
  let q = url.searchParams
  let limit = q.has('limit') ? Number(q.get('limit')) : undefined
  if (limit != null) trashLimit({ limit })
  let at = q.get('beforeAt'), id = q.get('beforeId')
  if ((at || id) && (!at || !id)) {
    throw new Refused('a trash cursor needs its id and time')
  }
  return {
    ...q.has('after') ? { after: q.get('after')! } : {},
    ...q.has('id') ? { id: q.get('id')! } : {},
    ...limit != null ? { limit } : {},
    ...at && id ? { before: { at, id } } : {},
  }
}
