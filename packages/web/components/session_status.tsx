// One Session status for every browser surface: the host's, from the session
// row. Entry work is a lazy partition.
import { useLayoutEffect } from 'preact/hooks'
import { ent, entrySub, subscriptionState } from '../live.ts'
import { type Ent, standing } from '../types.ts'
import { type EntryRow, type GraphLog, graphLog } from '../entry_log.ts'
import { Dot } from './Dot.tsx'
import { useRows } from './subscriptions.ts'

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

export type EntryReadState =
  | { status: 'loading' }
  | { status: 'ready'; log: GraphLog }
  | { status: 'failed'; reason: string; reference: string }

// A transcript names its model on each ask and its tool on each call; those
// entities are held so the log can say them in words.
let named = (rows: EntryRow[]) =>
  rows.flatMap((r) =>
    [r.comps.ask?.to, r.comps.call?.to].flatMap((x) => x ? [String(x)] : [])
  )
let nameOf = (eid: string) => {
  let e = ent(eid)
  return e.model?.name ?? e.tool?.name ?? undefined
}

export let useEntryLog = (
  eid: string,
  enabled = true,
): EntryReadState => {
  useLayoutEffect(() => enabled ? entrySub(eid) : undefined, [eid, enabled])
  let state = subscriptionState(`entries:${eid}`)
  let rows = enabled && state.status == 'ready'
    ? [...state.eids].flatMap((id) => {
      let row = entryRow(ent(id))
      return row ? [row] : []
    })
    : []
  useRows(named(rows))
  if (!enabled) return { status: 'loading' }
  if (state.status != 'ready') return state
  return { status: 'ready', log: graphLog(rows, nameOf) }
}

// The dot's word, read O(1) — it never scans the log. The host derives a
// session's status from its transcript (pending, running, settled, stopped,
// failed); a failure facet on the session itself is authoritative over it.
export let graphStanding = (e: Ent) =>
  e.failed || e.exception ? 'failed' : standing(e)

// The dot reads the session row alone: no useEntryLog subscription, so a busy
// agent's growing log costs the dot nothing (was 157ms/render).
export let SessionDot = ({ e }: { e: Ent }) => (
  <Dot status={graphStanding(e)} />
)

// The Session VIEW still loads the full log — it renders the transcript — but
// its STATUS reads the same O(1) session.status as the dot, which the host
// derives with @yaks/session's statusOf, the rule the log reads too.
export let useSessionStanding = (e: Ent) => {
  // Every substrate reads its transcript from the same entry-partition
  // subscription (T-16824): a process-backed run's JSONL is ingested into these
  // entries, so there is one live read path, not a per-substrate branch.
  let entries = useEntryLog(e.eid)
  return { entries, status: graphStanding(e) }
}
