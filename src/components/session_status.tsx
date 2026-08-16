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

// The native session's standing for the dot, read O(1) — never scans the log.
// A failure facet is authoritative: the session reads `failed`, NEVER idle,
// whatever its lifecycle or log-derived facet says. finished_at likewise wins
// over the log facet for a clean ending. A killed session, or one whose log
// ended without a clean final answer, or one the boot backfill hasn't stamped
// yet, can carry a null/idle `standing` while being long done. Only for a
// STILL-RUNNING session does the server-maintained `standing` facet speak:
// busy → running (over a pending wake), terminal → completed, else idle.
// Non-native keeps its word unless it carries the same shared failure fact.
export let graphStanding = (
  e: Ent,
  waking = false,
) => {
  let s = e.session!
  if (e.error || e.exception) return 'failed'
  let native = s.origin == 'managed' && s.status == null &&
    e.spawn?.provider == 'codex'
  if (!native) return standing(s)
  if (s.finished_at) return 'completed'
  if (s.standing == 'busy') return 'running'
  if (waking) return 'idle'
  return s.standing == 'terminal' ? 'completed' : 'idle'
}

// The dot reads the facet O(1): no useEntryLog subscription, so a busy agent's
// growing log costs the dot nothing (was 157ms/render). Only the cheap pending-
// wake query re-renders it.
export let SessionDot = ({ e }: { e: Ent }) => (
  <Dot status={graphStanding(e, usePendingWake(e.eid))} />
)

// The Session VIEW still loads the full log — it renders the transcript — but
// its STATUS reads the same O(1) facet as the dot, so the two can never
// disagree (the facet is stamped from the same standingOf the log derives).
export let useSessionStanding = (e: Ent) => {
  // Every substrate reads its transcript from the same entry-partition
  // subscription (T-16824): a process-backed run's JSONL is ingested into these
  // entries, so there is one live read path, not a per-substrate branch.
  let log = useEntryLog(e.eid)
  return { log, status: graphStanding(e, usePendingWake(e.eid)) }
}
