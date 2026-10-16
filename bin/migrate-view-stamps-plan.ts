// Pure recovery policy. Journal timestamps are evidence of commit time, NOT
// bit-exact historical stamp times (the journal clock runs after stamping).
export type Stamp = { at: string | null; by: string | null; via: string | null }
export type Event = {
  tx: number
  at: string
  by: string | null
  via: string | null
  changes: { component: string; operation: string }[]
}
export type Candidate = {
  eid: string
  created: Stamp | null
  updated: Stamp | null
  opened: Stamp | null
  events: Event[]
}
export type Decision = {
  eid: string
  status: 'repair' | 'ambiguous' | 'preserve'
  reason: string
  before: Stamp | null
  after?: Stamp | null
  pollutedTx?: number
  sourceTx?: number
}
let metadata = new Set(['created', 'updated'])
export let openedOnly = (e: Event): boolean => {
  let changes = e.changes.filter((c) => !metadata.has(c.component))
  return changes.length > 0 && changes.every((c) => c.component == 'opened') &&
    changes.some((c) => c.operation == 'upsert')
}
// Only a narrow, same-writer match establishes that the current stamp was
// produced by this transaction. Later unjournaled writes must not be reset.
export let matches = (stamp: Stamp | null, e: Event): boolean => {
  if (!stamp?.at || stamp.by !== e.by || stamp.via !== e.via) return false
  let lag = Date.parse(e.at) - Date.parse(stamp.at)
  return lag >= 0 && lag <= 1000
}
export let decide = (c: Candidate): Decision => {
  let base = { eid: c.eid, before: c.updated }
  let events = [...c.events].sort((a, b) => a.tx - b.tx)
  let latest = events.at(-1)
  if (!latest) {
    return { ...base, status: 'ambiguous', reason: 'no entity journal history' }
  }
  if (!openedOnly(latest)) {
    return {
      ...base,
      status: 'preserve',
      reason: 'latest entity transaction is substantive',
    }
  }
  if (!matches(c.updated, latest)) {
    return {
      ...base,
      status: 'ambiguous',
      reason: 'current updated does not match latest opened-only transaction',
    }
  }
  let source = events.slice(0, -1).reverse().find((e) =>
    !openedOnly(e) &&
    e.changes.some((x) => !metadata.has(x.component))
  )
  if (!source) {
    return {
      ...base,
      status: 'ambiguous',
      reason: 'no substantive journal predecessor',
    }
  }
  // Do not resurrect a previous incarnation or infer provenance across deletion.
  if (
    source.changes.some((x) =>
      x.component == 'entity' && x.operation == 'delete'
    )
  ) {
    return {
      ...base,
      status: 'ambiguous',
      reason: 'predecessor is entity deletion',
    }
  }
  // Creation is absent from the journal. Require its writer and narrow clock
  // match before treating the predecessor as a birth, with no updated stamp.
  let birth = source.tx == events[0].tx && matches(c.created, source)
  let after = birth ? null : { at: source.at, by: source.by, via: source.via }
  return {
    ...base,
    status: 'repair',
    reason: birth
      ? 'opened-only after journaled birth'
      : 'journal-derived last substantive provenance (timestamp approximation)',
    after,
    pollutedTx: latest.tx,
    sourceTx: source.tx,
  }
}
