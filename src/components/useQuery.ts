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
import {
  type Backlink,
  derivedResult,
  deriveSub,
  dropQuery,
  edgeSub,
  ent,
  findEid,
  holdQuery,
  linksVia,
  queryEids,
  type References,
  references,
} from '../live.ts'
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

// The open card's reverse lists (T-21489), held for the view's life. Each is an
// EID-KEYED server sub — "comments aimed at X", "entities referencing X" — so
// the set is complete even when the cache is partial (a referrer outside the
// working set still counts, T-18094), opened on mount and torn down with the
// last unmount: cards accumulate no subs as they open and close. The plain
// live.ts doors (commentsOn/backlinks) resolve the same queries for tests and
// for imperative reads that reuse a set a mounted view already holds.
export let useCommentsOn = (target: string): Ent[] =>
  useQueryEids(`.comment.target=${target}`)
    .map(ent)
    .sort((a, b) => a.num - b.num)

// `via` — WHICH column points here — reads off each referrer's own row signal
// (linksVia), so a retarget wakes the face without a membership change.
export let useBacklinks = (target: string): Backlink[] =>
  useQueryEids(`.refs=${target}`).flatMap((from) => linksVia(from, target))

let REFERENCED = '.edges[referenced,entry.session]!'

// Citations are a typed edge rider over one addressed entity. The server
// projects entry endpoints to their Session through the indexed entry.session
// column; this hook only owns the subscription and reads its scoped edge set.
export let useReferences = (eid: string): References => {
  useEffect(() => edgeSub(eid, REFERENCED), [eid])
  return references(eid)
}

export type PersonaProjection = { text: string; scoped: string[] }

// A persona's prompt bytes and scoped-memory ids are one registered derived
// projection over ordinary addressed membership. The server computes it from
// the spawn path's bounded personaGraph closure; the browser holds no tier walk.
export let usePersonaProjection = (
  eid: string,
  enabled = true,
): PersonaProjection | null | undefined => {
  let value = derivedResult(eid, 'persona').value
  useEffect(
    () => enabled ? deriveSub(eid, 'persona') : undefined,
    [eid, enabled],
  )
  return enabled ? value as PersonaProjection | null | undefined : undefined
}
