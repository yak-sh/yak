// View lifecycles for live query subscriptions. The board hook opens the
// shadow set beside the complete cache and closes it with the last view; the
// entity hooks hold ONE row (and its edges) for as long as a view paints it.
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks'
import {
  boardQuery,
  boardSub,
  boardTallyLine,
  boardTallyName,
  dropAgg,
  ent,
  entityRead,
  holdAgg,
  repoTrace,
  routeName,
  routeSub,
  rowsSub,
  type SubscriptionRead,
  subscriptionState,
} from '../live.ts'
import { useQueryResult } from './useQuery.ts'
import { type Ent } from '../types.ts'

export let useBoardSub = (e?: Ent): SubscriptionRead | undefined => {
  let q = String(e?.board?.query ?? '')
  useLayoutEffect(() => e ? boardSub(e) : undefined, [e?.eid])
  useEffect(() => {
    if (e) boardQuery(e)
  }, [e?.eid, q])
  if (!e) return undefined
  let sub = `board:${e.eid}`
  return { sub, state: subscriptionState(sub) }
}

// The tile's half of a board: its status COUNTS, held for the tile's life and
// closed by the last one. The aggregate is keyed by the BOARD, so a query edit
// re-asks under the same name (live.ts aggQuery) rather than churning the hold.
export let useBoardTally = (e?: Ent) => {
  useEffect(() => {
    if (!e) return
    let line = boardTallyLine(e)
    if (!line) return
    let name = boardTallyName(e)
    holdAgg(name, line)
    return () => dropAgg(name)
  }, [e?.eid])
}

// The entity a view PAINTS but no enclosing subscription delivers — held for
// the view's life (T-22371). The working-set boot used to walk one hop from
// every card and preseed whatever it pointed at, which is how a pinned card had
// a row to render; that hop is gone, so whatever paints another entity by eid
// SAYS so, and the row — with the `.edges!` rider's edges and their far
// endpoints — streams in on mount and is evicted with the last view of it.
export let useEntity = (eid?: string | null, fields?: string) => {
  useLayoutEffect(() => eid ? routeSub(eid, fields) : undefined, [eid, fields])
  return eid ? entityRead(eid, fields) : undefined
}

// The rows of a LIST of entities, in one sub (live.ts rowsSub), never their
// edges; the joined key means a re-render that moves nothing re-subscribes
// nothing.
export let useRows = (eids: string[]) => {
  let key = [...new Set(eids)].join(',')
  useLayoutEffect(() => rowsSub(key ? key.split(',') : []), [key])
}

// The canvas List face and the tray's shelf chips paint a pin's target without
// mounting a Card, so they hold it here.
export let usePinTargets = (ps: { target: string }[]) =>
  useRows(ps.map((p) => p.target))

// Ref columns are not edge peers. Ask for the small face, not its document,
// transcript or incident edges; several visible chips share this query.
export let useReference = (eid?: string | null) => {
  let read = useEntity(eid, 'doc.title,client.user_agent,session.id')
  return {
    ...read,
    value: eid && read?.loaded(eid, 'doc', 'title') ? read.value : undefined,
  }
}

// The name of the model a session runs on: `using.model` points at a model
// entity, so its name is one small held row away.
// What a session runs on, in words: its model's name and its effort. An
// adopted session carries its own `using`; a spawned one's is on its first
// entry, where @yaks/spawn writes the ask.
export let useModel = (e: Ent): { name?: string; effort?: string } => {
  let first = useQueryResult(
    `.entry.session=${e.eid}&.entry.seq=1&.fields=using.model,using.effort`,
    !!e.session && !e.using,
    true,
  ).eids[0]
  let using = e.using ?? (first ? ent(first).using : undefined)
  let model = using?.model
  useEntity(model, 'model.name')
  return {
    name: model ? ent(model).model?.name ?? undefined : undefined,
    effort: using?.effort ?? undefined,
  }
}

// Ownership is a changing path, not a cache assumption. Keep common hops
// held while discovering the next ones, and release only hops no longer used.
// Replacing the whole hold on each discovery would repeatedly unload its root.
let repoFields = 'repo.url,filed.project,comment.target,' +
  'session.actor,role.scope,memory.scope,entry.session'
export let useRepoUrl = (e: Ent): string | undefined => {
  let trace = repoTrace(ent(e.eid))
  let held = useRef(new Map<string, () => void>())
  let key = trace.eids.toSorted().join(',')
  for (let eid of trace.eids) {
    subscriptionState(routeName(eid, repoFields))
  }
  useLayoutEffect(() => {
    let want = new Set(key.split(','))
    for (let [eid, off] of held.current) {
      if (want.has(eid)) continue
      off()
      held.current.delete(eid)
    }
    for (let eid of want) {
      if (held.current.has(eid)) continue
      held.current.set(eid, routeSub(eid, repoFields))
    }
  }, [key])
  useEffect(() => () => {
    for (let off of held.current.values()) off()
    held.current.clear()
  }, [])
  return trace.url
}
