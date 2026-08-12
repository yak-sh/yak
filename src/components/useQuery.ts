// The reactive query hook — the door a component uses to ask "which entities
// match this query", in place of `Object.values(cache.value).filter` (T-17036,
// the 16ms frame budget). It parses the query once, holds a NARROW result
// signal for the component's life (releasing it on unmount), and reads it — so
// the component re-renders only when its RESULT changes, never on an unrelated
// patch. The query is the query.ts filter grammar boards and graph_query speak
// (`.status=open`, `.deliver.to=S-31`, …); references resolve to eids at parse.
//
// The signal's backing is the store-agnostic seam (live.ts queryEids): today an
// in-memory index, tomorrow an IDB indexed cursor — the call site never
// changes (T-17046).
import { useEffect, useMemo } from 'preact/hooks'
import { dropQuery, ent, findEid, holdQuery, queryEids } from '../live.ts'
import { parseQuery, resolveRefs } from '../query.ts'
import type { Ent } from '../types.ts'

let resolve = (query: string) => resolveRefs(parseQuery(query), findEid)

// The matching eids, as a live array. Prefer this when the caller only needs
// ids (membership, a count); `useQuery` assembles the Ents.
export let useQueryEids = (query: string): string[] => {
  let preds = useMemo(() => resolve(query), [query])
  useEffect(() => {
    holdQuery(preds)
    return () => dropQuery(preds)
  }, [preds])
  return queryEids(preds).value
}

// The matching entities, assembled. Each rides its own `row` signal, so the
// list re-renders on membership change and each row on its own edits.
export let useQuery = (query: string): Ent[] => useQueryEids(query).map(ent)
