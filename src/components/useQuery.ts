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
import { useEffect, useLayoutEffect, useMemo } from 'preact/hooks'
import {
  type Backlink,
  dropQuery,
  edgeSub,
  ent,
  findEid,
  holdQuery,
  linksVia,
  loaded,
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

export type QueryResult = {
  eids: string[]
  subscription?: SubscriptionRead
  ready: boolean
  loaded: typeof loaded
}

// Windowed/server-owned callers opt into the authored line: re-serializing
// bound predicates can decline valid grammar (edge riders, time comparisons,
// reverse hops) into a local cache scan. Legacy local callers keep that path.
// The result and addressed read state of one direct query. Most callers need
// only eids; query-driven UI also consumes a refusal so it never paints a
// local partial set as the server's answer.
export let useQueryResult = (
  query: string,
  enabled = true,
  direct = false,
): QueryResult => {
  let preds = useMemo(() => resolve(query), [query])
  let source = direct ? query : undefined
  useLayoutEffect(() => {
    if (!enabled) return
    holdQuery(preds, source)
    return () => dropQuery(preds)
  }, [preds, enabled, source])
  let subscription = enabled ? querySubscription(preds, source) : undefined
  return {
    eids: enabled ? queryEids(preds, source).value : [],
    subscription,
    ready: !subscription || subscription.state.status == 'ready',
    loaded,
  }
}

// The matching eids, as a live array. Prefer this when the caller only needs
// ids (membership, a count); `useQuery` assembles the Ents.
export let useQueryEids = (query: string, direct = false): string[] =>
  useQueryResult(query, true, direct).eids

// The matching entities, assembled. Each rides its own `row` signal, so the
// list re-renders on membership change and each row on its own edits.
export let useQuery = (query: string): Ent[] => useQueryEids(query).map(ent)

// The open card's reverse lists (T-21489), held for the view's life. Each is an
// EID-KEYED server sub — "comments aimed at X", "entities referencing X" — so
// the set is complete even when the cache is partial (a referrer outside the
// working set still counts, T-18094), opened on mount and torn down with the
// last unmount: cards accumulate no subs as they open and close. The plain
// live.ts backlinks door reads locally from the rows a mounted view holds;
// it never opens an unowned server subscription.
export let useCommentsOn = (target: string): Ent[] =>
  useQueryEids(`.comment.target=${target}`)
    .map(ent)
    .sort((a, b) => a.num - b.num)

// The commits landed for an entity — the structured rows that sit in the
// same rail as its comments (M-31946 §7).
export let useCommitsOn = (target: string): Ent[] =>
  useQueryEids(`.commit.target=${target}`)
    .map(ent)
    .sort((a, b) => a.num - b.num)

// `via` — WHICH column points here — reads off each referrer's own row signal
// (linksVia), so a retarget wakes the face without a membership change.
export let useBacklinks = (target: string): Backlink[] =>
  useQueryEids(`.refs=${target}`).flatMap((from) => linksVia(from, target))

// EID-keyed lookups belong to the mounted view, never an unheld render read.
export let useBoardsOver = (target: string): string[] =>
  useQueryEids(`.board.query~=${target}`)

export let useChatFor = (
  actor: string | undefined,
  target: string,
): Ent | undefined =>
  useQueryResult(`.chat.actor=${actor ?? ''}&.chat.target=${target}`, !!actor)
    .eids.map(ent)[0]

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
