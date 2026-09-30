// The browser's server search: the rows a query line answers over the whole
// graph, not what happens to be loaded. `rows` is what a picker lists (the
// UX host's `find`, @yaks/ux); `hits` is the palette's ranked form of the
// same answer. A picker's line and its debounced hook are @yaks/ux's
// `pickLine` and `useHits`.
import { base } from '../live.ts'
import { hitOf, rowOf } from '../client.ts'
import type { Hit } from '../types.ts'
import type { Bundle } from '@yaks/graph'

// One server search. A malformed filter answers 400 — the typist's news in
// the palette, but a picker has no error slot, so a bad line simply yields no
// options (the same "no matches yet" a half-typed filter always showed). An
// abort is silent: the caller replaced the query and no longer wants this one.
export let rows = async (
  q: string,
  limit = 20,
  signal?: AbortSignal,
): Promise<Bundle[]> => {
  let r = await fetch(
    `${base()}/query?q=${encodeURIComponent(`${q}&.limit=${limit}`)}`,
    { signal },
  )
  if (!r.ok) throw new Error(await r.text())
  return await r.json()
}

/** The same search, each row as the palette ranks and shows it. */
export let hits = async (
  q: string,
  limit = 20,
  signal?: AbortSignal,
): Promise<Hit[]> => (await rows(q, limit, signal)).map((r) => hitOf(rowOf(r)))
