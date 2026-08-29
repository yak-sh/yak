// The scribe's TRIGGER (T-4001): wrap leaves stub session docs, and
// the stub marker line IS the queue — rewriting the doc removes it, so
// done-ness lives in the doc and nowhere else. This module only decides
// WHEN to spawn the desk; the judgment (narrative, memories) is a
// session wearing the scribe persona, journal-attributed like anyone.
// The desk is a standing task (alias scribe-desk) because a spawn's
// workspace derives task → project → repo; the persona (alias scribe)
// carries the runbook, editable in the graph. A SYSTEM ROLE (T-18728):
// the predicate and work live here, registered with roles.ts — a `role`
// comp on the scribe-desk entity carries on/off and the throttle values
// (quiet/cooldown, seconds) as graph data, and each pass stamps its
// decision there; absent that row, the code defaults below apply.
import { apply, depsOf, locate } from './db.ts'
import { db } from './live_db.ts'
import { commitEffects } from './effects.ts'
import { type Change, type Dep } from './types.ts'
import { DESK, find, type Row, spawnChanges, STUB } from './client.ts'
import { evalGraph, rowsFor } from './graph_query.ts'
import { type SystemSpec, type SystemTuning } from './roles.ts'

type Cast = (changes: Change[]) => void

// Freshly-wrapped stubs get a quiet quarter hour (a resumed session may
// still enrich its own doc); one desk an hour is the cost throttle.
// Seconds, the wake vocabulary — role.quiet / role.cooldown override them.
export let TUNING: SystemTuning = { quiet: 15 * 60, cooldown: 60 * 60 }

// Milliseconds since an entity's birth ('created') or its last touch
// ('updated', which falls back to birth) — off the provenance components
// (T-6670).
let age = (r: Row, now: number, comp: 'created' | 'updated') => {
  let at = comp == 'updated'
    ? r.comps.updated?.at ?? r.comps.created?.at
    : r.comps.created?.at
  let t = Date.parse(String(at ?? ''))
  return Number.isNaN(t) ? Infinity : now - t
}

// The queue: session docs still wearing the wrap marker, dust settled.
// The desk's own sessions are exempt — a scribe's wrap leaves a stub
// too, and scribing the scribe would spawn a desk an hour forever.
export let stubs = (
  all: Row[],
  now: number,
  deskEid?: string,
  quietMs = TUNING.quiet * 1000,
) =>
  all.filter((r) =>
    r.comps.session && String(r.comps.doc?.body ?? '').startsWith(STUB) &&
    !(deskEid && r.comps.session.requested_task == deskEid) &&
    age(r, now, 'updated') > quietMs
  )

// One scribe at a time, and not more than hourly — a desk session still
// unsettled blocks regardless of age (never two writers on the queue).
export let deskFree = (
  all: Row[],
  desk: Row,
  now: number,
  cooldownMs = TUNING.cooldown * 1000,
) =>
  !all.some((r) =>
    r.comps.session?.requested_task == desk.eid &&
    (['starting', 'running'].includes(String(r.comps.session.status)) ||
      age(r, now, 'created') < cooldownMs)
  )

// The pass's decision: the spawn plus the run record's words, or just the
// words (the missing-desk case throws so a half-seeded graph says so
// instead of silently never scribing).
export let scribeSpawn = (
  all: Row[],
  deps: Dep[],
  now: number,
  t: SystemTuning = TUNING,
): { changes?: Change[]; observed?: string; reason: string } => {
  let desk = find(all, DESK.task)
  let queue = stubs(all, now, desk?.eid, t.quiet * 1000)
  if (!queue.length) return { reason: 'no stubs waiting' }
  if (!desk?.comps.task) throw new Error('no scribe-desk task in the graph')
  if (!find(all, DESK.persona)?.comps.persona) {
    throw new Error('no scribe persona in the graph')
  }
  if (!deskFree(all, desk, now, t.cooldown * 1000)) {
    return { reason: `${queue.length} waiting — desk busy or cooling down` }
  }
  let { eid, changes } = spawnChanges(all, { ...DESK, deps })
  return { changes, observed: eid, reason: `${queue.length} waiting` }
}

// The pass itself — interval-safe (never two in flight); a throw is the
// caller's: reconcileSystem stamps it on the role, the bare sweep warns.
export let scribeRun = (
  t: SystemTuning,
  cast: Cast,
): { reason: string; observed?: string } => {
  if (sweeping) return { reason: 'a pass is already in flight' }
  sweeping = true
  try {
    // Scoped read (M-21143): scribeSpawn needs the sessions (the stub queue and
    // the desk's own runs), the desk task and scribe persona, and the persona's
    // edges (spawnChanges reads them for the run's actor). Read those — every
    // session by kind, the three named entities plus the persona's neighbours —
    // never the whole graph.
    let persona = locate(db, DESK.persona)
    let deps = persona ? depsOf(db, [persona]) : []
    let neighbours = deps.flatMap((d) => [d.parent, d.child])
    let all = [
      ...evalGraph(db, '.kind=session').hits,
      ...rowsFor(db, [DESK.task, DESK.persona, ...neighbours]),
    ]
    let out = scribeSpawn(all, deps, Date.now(), t)
    if (out.changes) {
      commitEffects((tr) => apply(db, out.changes!, tr), cast)
    }
    return { reason: out.reason, observed: out.observed }
  } finally {
    sweeping = false
  }
}
let sweeping = false

// The registration server.ts hands roles.ts: the scribe IS the system role
// bound to the scribe-desk entity, throttle defaults above.
export let SCRIBE: SystemSpec = {
  alias: DESK.task,
  defaults: TUNING,
  run: scribeRun,
}
