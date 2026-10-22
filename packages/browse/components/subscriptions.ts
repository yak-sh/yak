// View lifecycles for live query subscriptions, each a live.ts `useHold`: the
// board hook holds a board's members while a view draws them; the entity hooks
// hold ONE row (and its edges) for as long as a view paints it.
import {
  boardTallyLine,
  boardTallyName,
  ent,
  entityRead,
  jobOf,
  jobQuery,
  pinned,
  pinsOn,
  repoTrace,
  routeName,
  type SubscriptionRead,
  subscriptionState,
  useHold,
} from '../live.ts'
import { useQueryResult } from './useQuery.ts'
import { type Ent, type Pinned, vocab } from '../types.ts'

export let useBoardSub = (e?: Ent): SubscriptionRead | undefined => {
  useHold(e && { board: e })
  if (!e) return undefined
  let sub = `board:${e.eid}`
  return { sub, state: subscriptionState(sub) }
}

// The tile's half of a board: its status COUNTS, held for the tile's life and
// closed by the last one. A query edit asks the new line.
export let useBoardTally = (e?: Ent) => {
  let line = e && boardTallyLine(e)
  useHold(e && line && { agg: boardTallyName(e), line })
}

// The entity a view PAINTS but no enclosing subscription delivers — held for
// the view's life (T-22371). The working-set boot used to walk one hop from
// every card and preseed whatever it pointed at, which is how a pinned card had
// a row to render; that hop is gone, so whatever paints another entity by eid
// SAYS so, and the row — with the `.edges` rider's edges and their far
// endpoints — streams in on mount and is evicted with the last view of it.
export let useEntity = (eid?: string | null, fields?: string) => {
  useHold(eid && { entity: eid, fields })
  return eid ? entityRead(eid, fields) : undefined
}

// The cards on a canvas, held while a view draws them.
export let usePinned = (canvas: string): Pinned[] => {
  useHold(!!canvas && { query: pinsOn(canvas) })
  return pinned(canvas)
}

// The task a session is on, held while a view draws it.
export let useJob = (e: Ent): string | null => {
  useHold(!!e.session && { query: jobQuery(e.eid) })
  return jobOf(e)
}

// The rows of a LIST of entities, in one sub (live.ts rowsSub), never their
// edges; the joined key means a re-render that moves nothing re-subscribes
// nothing.
export let useRows = (eids: string[]) =>
  useHold(eids.length > 0 && { rows: eids })

// The canvas List face and the tray's shelf chips paint a pin's target without
// mounting a Card, so they hold it here.
export let usePinTargets = (ps: { target: string }[]) =>
  useRows(ps.map((p) => p.target))

// Ref columns are not edge peers. Ask for the small face, not its document,
// transcript or incident edges; several visible chips share this query.
export let useReference = (eid?: string | null) => {
  let fields = ['doc.title', 'client.user_agent', 'session.id'].filter(
    (field) => {
      let [comp, prop] = field.split('.')
      return vocab.prop(comp, prop)
    },
  ).join(',')
  let read = useEntity(eid, fields || 'entity.eid')
  return {
    ...read,
    value: eid && read?.loaded(eid, 'doc', 'title') ? read.value : undefined,
  }
}

// The newest input chooses the next model. An adopted session may hold its
// starting choice itself; a spawned one's is on its first entry.
// The model a session asks now, by name, and the using{provider, model,
// effort} in force: the newest line that asked for a turn. A line sent with
// no choice of its own carries that using, as `yak session send` does, since
// a line asks for a turn by carrying one (@yaks/session `session_run`).
export let useModel = (e: Ent): {
  name?: string
  effort?: string
  using?: { provider: string; model?: string; effort?: string }
} => {
  let latest = useQueryResult(
    e.session && vocab.prop('entry', 'session') && vocab.comp('using') &&
      vocab.comp('ask')
      ? `.entry.session=${e.eid}&.using&!ask&.order=-entry.seq&.limit=1&.fields=using.provider,using.model,using.effort`
      : '',
    !!e.session,
    true,
  ).eids[0]
  let using = (latest ? ent(latest).using : undefined) ?? e.using
  let model = using?.model
  useEntity(model, 'model.name')
  return {
    name: model ? ent(model).model?.name ?? undefined : undefined,
    effort: using?.effort ?? undefined,
    using: using?.provider
      ? {
        provider: using.provider,
        ...(model ? { model } : {}),
        ...(using.effort ? { effort: using.effort } : {}),
      }
      : undefined,
  }
}

// Ownership is a changing path, not a cache assumption. useHold keeps common
// hops held while discovering the next ones, and releases only hops no longer
// used.
let repoFields = 'repo.url,filed.project,comment.target,' +
  'session.actor,memory.scope,entry.session'
export let useRepoUrl = (e: Ent): string | undefined => {
  let fields = repoFields.split(',').filter((field) => {
    let [comp, prop] = field.split('.')
    return vocab.prop(comp, prop)
  }).join(',')
  let trace = vocab.prop('repo', 'url')
    ? repoTrace(ent(e.eid))
    : { eids: [], url: undefined }
  let holds = trace.eids.map((eid) => ({
    entity: eid,
    fields: fields || 'entity.eid',
  }))
  for (let h of holds) subscriptionState(routeName(h.entity, h.fields))
  useHold(...holds)
  return trace.url
}
