// Sources materialize entities on READ that were never written to sqlite —
// pass-through (ephemeral) entities. A source answers reads ONLY; apply() stays
// the sole writer (db.ts), so a source-materialized entity is structurally
// unpersistable until a real write graduates it. The read doors in db.ts
// (resolveId, eager, rowsOf, matching, entriesOf) consult these AFTER SQL
// misses, so a source costs nothing on the hot path — only an unresolved id or
// an eid with no rows ever reaches one.
//
// This is one aspect (M-14942): "where an entity's components come from on
// read." The file-backed legacy-session source is the first (source_session.ts);
// memories, pages, other file-backed corpora could follow. snapshot() never
// enumerates sources — nothing is bulk-loaded; an entity materializes only when
// it is resolved, queried, or opened.

import type { Change } from './types.ts'

// A pass-through entity's log tail, shaped exactly as db.ts entryRows() shapes a
// persisted one, so the existing entriesOf/`/logs` path serves it unchanged.
export type EntryRow = {
  eid: string
  seq: number
  comps: Record<string, Record<string, unknown>>
}

export type SqlFilter = { sql: string; params: (string | number)[] }

export type Source = {
  // A handle (id / eid / slug) → this entity's components as a batch, or
  // undefined if this source does not own it. Every Change carries the same eid.
  resolve?: (id: string) => Change[] | undefined
  // Ephemeral entities matching a compiled query — each as its own batch. The
  // filter is the same {sql,params} db.ts `matching` runs into `hit`; a source
  // decides for itself which of its entities satisfy it.
  list?: (filter: SqlFilter) => Iterable<Change[]>
  // A pass-through entity's log tail, read from its file on demand.
  entries?: (eid: string, after: number, limit: number) => EntryRow[]
}

// The registry is a plain module-level list — the same shape as the effect and
// renderer registries. Registration returns its own remover (tests, hot reload).
let sources: Source[] = []

export let addSource = (s: Source): () => void => {
  sources.push(s)
  return () => {
    sources = sources.filter((x) => x !== s)
  }
}

// Tests and probes reset the registry so one run never sees another's sources.
export let clearSources = () => {
  sources = []
}

// The hot-path guard: read doors skip every source consult when none exist, so
// a graph with no sources pays exactly nothing.
export let hasSources = () => sources.length > 0

// First source to own the handle wins. Returns the whole batch (the caller reads
// its eid for resolveId, or folds it to comps for a keyed read).
export let sourceResolve = (id: string): Change[] | undefined => {
  for (let s of sources) {
    let hit = s.resolve?.(id)
    if (hit && hit.length) return hit
  }
  return undefined
}

// Every source's query matches, unioned. A generator so a large corpus streams
// rather than materializing all at once.
export let sourceList = function* (filter: SqlFilter): Iterable<Change[]> {
  for (let s of sources) if (s.list) yield* s.list(filter)
}

// First source with a tail for this eid wins. Empty when none owns it.
export let sourceEntries = (
  eid: string,
  after: number,
  limit: number,
): EntryRow[] => {
  for (let s of sources) {
    let e = s.entries?.(eid, after, limit)
    if (e && e.length) return e
  }
  return []
}

// A source batch → the comps shape the keyed reads speak (component name → row,
// each row carrying its eid, exactly as `staged`/`eager` build it). The `entity`
// spine is ensured so a pass-through entity always has an identity row even if
// the source only listed doc/session comps.
export let compsOf = (
  batch: Change[],
): Record<string, Record<string, unknown>> => {
  let out: Record<string, Record<string, unknown>> = {}
  for (let c of batch) if (c.comp) out[c.name] = { eid: c.eid, ...c.comp }
  if (!out.entity && batch.length) out.entity = { eid: batch[0].eid, num: null }
  return out
}
