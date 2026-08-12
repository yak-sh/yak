// One graph-native Session status for every browser surface. Entry work is a
// lazy partition; wakes stay in the root graph because their timer and outcome
// are ordinary shared facets.
import { useEffect } from 'preact/hooks'
import { ent, entrySub, subEids } from '../live.ts'
import { type Ent, standing } from '../types.ts'
import { type EntryRow, type GraphLog, graphLog } from '../entry_log.ts'
import { useQueryEids } from './useQuery.ts'
import { Dot } from './Dot.tsx'

// A wake still pending for this session: a `wake` entity aimed at it (the
// derived `deliver.to` reverse index) that is neither `delivered` nor `error` —
// the same tri-state pending-wake fact, now expressed as a query rather than a
// bespoke index. The dot re-renders only when ITS wake membership changes; a
// patch to any other entity (another session's wake included) triggers zero
// re-render (T-17036).
export let usePendingWake = (session: string): boolean =>
  useQueryEids(`.wake! .deliver.to=${session} .delivered= .error=`).length > 0

let entryRow = (e: Ent): EntryRow | undefined => {
  if (!e.entry?.seq) return undefined
  let {
    eid,
    num: _num,
    kind: _kind,
    refs: _refs,
    kids: _kids,
    ...comps
  } = e
  return {
    eid,
    seq: e.entry.seq,
    comps: comps as unknown as EntryRow['comps'],
  }
}

export let useEntryLog = (
  eid: string,
  enabled = true,
): GraphLog | undefined => {
  useEffect(() => enabled ? entrySub(eid) : undefined, [eid, enabled])
  if (!enabled) return undefined
  let eids = subEids(`entries:${eid}`)
  if (!eids) return undefined
  let rows = [...eids].flatMap((id) => {
    let row = entryRow(ent(id))
    return row ? [row] : []
  })
  return graphLog(rows)
}

export let graphStanding = (
  e: Ent,
  log?: GraphLog,
  waking = false,
) => {
  let s = e.session!
  let native = s.origin == 'managed' && s.status == null &&
    e.spawn?.provider == 'codex'
  if (!native) return standing(s)
  if (e.error) return 'failed'
  if (!log || log.busy) return 'running'
  if (waking) return 'idle'
  return log?.terminal ? 'completed' : 'idle'
}

export let useSessionStanding = (e: Ent) => {
  let native = e.session?.origin == 'managed' && e.session.status == null &&
    e.spawn?.provider == 'codex'
  let log = useEntryLog(e.eid, native)
  return { log, status: graphStanding(e, log, usePendingWake(e.eid)) }
}

export let SessionDot = ({ e }: { e: Ent }) => (
  <Dot status={useSessionStanding(e).status} />
)
