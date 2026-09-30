// Entity suggestions speak the same human id + title vocabulary wherever a
// picker appears. Candidates are the server's rows, a ranked one carrying a
// transient `rank` component (a picker asks the graph, not what the page
// holds: ./hits.ts), so the label reads the row's own fields: the entity may
// not be held here, and the query already ranked it, so no sort remains.
import { type Bundle, host } from './host.ts'

// A row's title: the ranked one a search gives, else its document's.
let titleOf = (b: Bundle): string => {
  let rank = b.rank as { title?: unknown } | undefined
  let doc = b.doc as { title?: unknown } | undefined
  return String(rank?.title ?? doc?.title ?? '')
}

/** A candidate as a picker lists it: `T-9 — Draw the map`. */
export let label = (b: Bundle): string =>
  `${host().id(b)} — ${titleOf(b) || host().kind(b)}`
