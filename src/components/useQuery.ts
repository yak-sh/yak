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
  dropQuery,
  edgeSub,
  ent,
  findEid,
  holdQuery,
  linksVia,
  queryEids,
  querySubscription,
  type References,
  references,
  resultComponent,
  resultSub,
  type SubscriptionRead,
} from '../live.ts'
import { parseQuery, resolveRefs, type ResultComp } from '../query.ts'
import type { Ent } from '../types.ts'

let resolve = (query: string) => resolveRefs(parseQuery(query), findEid)

export type QueryResult = { eids: string[]; subscription?: SubscriptionRead }

// The result and addressed read state of one direct query. Most callers need
// only eids; query-driven UI also consumes a refusal so it never paints a
// local partial set as the server's answer.
export let useQueryResult = (query: string): QueryResult => {
  let preds = useMemo(() => resolve(query), [query])
  useEffect(() => {
    holdQuery(preds)
    return () => dropQuery(preds)
  }, [preds])
  return {
    eids: queryEids(preds).value,
    subscription: querySubscription(preds),
  }
}

// The matching eids, as a live array. Prefer this when the caller only needs
// ids (membership, a count); `useQuery` assembles the Ents.
export let useQueryEids = (query: string): string[] =>
  useQueryResult(query).eids

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

export type Materialized = { text: string; scoped: string[] }

// A transient result component is requested through the ordinary component
// grammar. The server supplies its declared inputs; the browser owns no graph
// walk and the returned value never enters the writable component cache.
export let useResultComponent = (
  eid: string,
  name: ResultComp,
  enabled = true,
): Record<string, unknown> | null | undefined => {
  let value = resultComponent(eid, name).value
  useEffect(
    () => enabled ? resultSub(eid, name) : undefined,
    [eid, name, enabled],
  )
  return enabled
    ? value as Record<string, unknown> | null | undefined
    : undefined
}
