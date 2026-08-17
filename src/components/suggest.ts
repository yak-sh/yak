// Entity suggestions speak the same human id + title vocabulary wherever a
// picker appears. The candidates are server `/search` Hits now (a picker asks
// the graph, not the loaded cache — hits.ts), so the label reads a Hit's own
// fields: the entity it names may not be resident to look up, and the server
// already ranks (id-address first, then relevance) so no client sort remains.
import { type Hit, idOf } from '../types.ts'

export let label = (h: Hit) => `${idOf(h)} — ${h.title || h.kind}`
