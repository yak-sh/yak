// Entity suggestions speak the same human id + title vocabulary wherever a
// picker appears. Candidates are `/query` rows decorated with a transient rank
// component (a picker asks the graph, not the loaded cache — hits.ts), so the
// label reads the result's own fields: the entity may not be resident, and the
// query already ranks it, so no client sort remains.
import { type Hit, idOf } from '../types.ts'

export let label = (h: Hit) => `${idOf(h)} — ${h.title || h.kind}`
