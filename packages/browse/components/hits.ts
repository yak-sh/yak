// The browser's server search: the rows a query line answers over the whole
// graph, not what happens to be loaded. `rows` is what a picker lists (the
// UX host's `find`, @yaks/ux); `hits` is the palette's ranked form of the
// same answer. A picker's line and its debounced hook are @yaks/ux's
// `pickLine` and `useHits`.
import { applyLocal, base } from '../live.ts'
import { hitOf, rowOf } from '../client.ts'
import { type Hit, vocab } from '../types.ts'
import type { Bundle } from '@yaks/graph'
import { type Clause, parse } from '@yaks/query'

// One server search. A malformed filter answers 400 — the typist's news in
// the palette, but a picker has no error slot, so a bad line simply yields no
// options (the same "no matches yet" a half-typed filter always showed). An
// abort is silent: the caller replaced the query and no longer wants this one.
export let rows = async (
  q: string,
  limit = 20,
  signal?: AbortSignal,
): Promise<Bundle[]> => {
  // Pickers draw domain views, not projections: a filter such as .session
  // must still carry its brief and a .comment must carry what it says.
  let r = await fetch(
    `${base()}/query?q=${encodeURIComponent(`${q}&* .limit=${limit}`)}`,
    { signal },
  )
  if (!r.ok) throw new Error(await r.text())
  return await r.json()
}

/** The graph's people, up to `limit`: none where the vocabulary declares no
 * `person` (a tracker store), whose server would refuse the line. */
export let people = (limit: number, signal?: AbortSignal): Promise<Bundle[]> =>
  vocab.comp('person') ? rows('.person', limit, signal) : Promise.resolve([])

/** Whether a query answers values rather than navigable entity rows. */
export let aggregate = (q: string): boolean => {
  try {
    return parse(q).clauses.some((c) =>
      ['count', 'tally', 'distinct'].includes(c.kind)
    )
  } catch {
    return false
  }
}

/** The same search, each row as the palette ranks and shows it. */
export let hits = async (
  q: string,
  limit = 20,
  signal?: AbortSignal,
): Promise<Hit[]> => {
  // Words are a search, not a newest-first listing. Respect an explicit
  // order, including one written inside a group; pure filters stay listings.
  let kinds = new Set<string>()
  let visit = (c: Clause) => {
    kinds.add(c.kind)
    if (c.kind == 'and' || c.kind == 'or') c.clauses.forEach(visit)
  }
  visit(parse(q))
  let line = kinds.has('text') && !kinds.has('order') ? `${q} .order=search` : q
  // Aggregate answers are values, not entities a picker can navigate to.
  // The addressed query page renders them; the palette still offers that link.
  if (['count', 'tally', 'distinct'].some((kind) => kinds.has(kind))) return []
  let found = await rows(line, limit, signal)
  // Keep the actual bundles: every picker draws the hit through the registry,
  // not from a private title-only search shape.
  applyLocal(
    found.flatMap(({ entity, ...comps }) =>
      Object.entries({ entity, ...comps })
        .filter(([, value]) => value && typeof value == 'object')
        .map(([name, value]) => ({
          eid: entity.eid,
          name,
          comp: value as Record<string, unknown>,
        }))
    ),
  )
  return found.map((r) => hitOf(rowOf(r)))
}
