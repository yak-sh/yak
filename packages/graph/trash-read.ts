// Saved deletions are read under the same visibility and outgoing policy as
// live entities. Reference predicates may consult live rows, while the saved
// group supplies the entities that were deleted together.
import { filter, type Index } from '@yaks/match'
import type { Bundle, Eid } from './bundle.ts'
import { Refused } from './errors.ts'
import type { Graph } from './graph.ts'
import type { Query, ReadOpts } from './storage.ts'
import type { Trash, TrashPage } from './trash.ts'

class Missing extends Error {
  constructor(readonly eid: Eid) {
    super(eid)
  }
}

let screened = async (
  graph: Graph,
  entry: Trash,
  opts: ReadOpts,
): Promise<Bundle[]> => {
  let held = new Map<Eid, Bundle | undefined>(
    entry.bundles.map((b) => [b.entity.eid, b]),
  )
  let source: Index = {
    get list(): Bundle[] {
      throw new Refused('this trash read scope requires a whole-graph scan')
    },
    of: (eid) => {
      if (!held.has(eid)) throw new Missing(eid)
      return held.get(eid)
    },
  }
  let allows = (q: Query) => {
    let test = filter(q, graph.vocab, { exactIds: true, now: opts.now })
    return async (b: Bundle): Promise<boolean> => {
      for (;;) {
        try {
          return test(b, source)
        } catch (e) {
          if (!(e instanceof Missing)) throw e
          let [row] = await graph.storage.get([e.eid])
          held.set(e.eid, row)
        }
      }
    }
  }
  let entity = opts.visibility?.entity
  let seen = entity ? allows(entity) : () => true
  let aspects = Object.entries(opts.visibility?.components ?? {})
    .map(([name, q]) => [name, allows(q)] as const)
  let out: Bundle[] = []
  for (let b of entry.bundles) {
    if (!await seen(b)) continue
    let row: Bundle = { ...b, entity: { ...b.entity } }
    for (let [name, sees] of aspects) {
      if (row[name] == null || await sees(b)) continue
      delete row[name]
      delete row.entity.archetype
    }
    out.push(row)
  }
  return await graph.answer(out, opts)
}

/** Read saved deletion groups, applying the graph's mandatory read scopes.
 * Omitted ids discovers the newest groups; an empty array reads nothing. */
export let readTrash = async (
  graph: Graph,
  eids?: Eid[],
  opts?: ReadOpts,
  page?: TrashPage,
): Promise<Trash[]> => {
  if (!graph.storage.trash) throw new Refused('this graph keeps no trash')
  let scoped = graph.scope(opts)
  for (;;) {
    let entries = await graph.storage.trash(eids, page)
    let out: Trash[] = []
    for (let entry of entries) {
      let bundles = await screened(graph, entry, scoped)
      if (bundles.length) out.push({ ...entry, bundles })
    }
    if (out.length || page?.id || entries.length < (page?.limit ?? 20)) {
      return out
    }
    let after = entries.at(-1)?.id
    if (!after || after == page?.after) return out
    page = { ...page, before: undefined, after }
  }
}
