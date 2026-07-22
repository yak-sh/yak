// The scribe's TRIGGER (T-4001): wrap leaves stub session docs, and
// the stub marker line IS the queue — rewriting the doc removes it, so
// done-ness lives in the doc and nowhere else. This module only decides
// WHEN to spawn the desk; the judgment (narrative, memories) is a
// session wearing the scribe persona, journal-attributed like anyone.
// The desk is a standing task (alias scribe-desk) because a spawn's
// workspace derives task → project → repo; the persona (alias scribe)
// carries the runbook, editable in the graph. A sweep like the others —
// graduates to a `system` entity under T-3906.
import { apply, db, snapshot } from './db.ts'
import { dispatch, trace } from './effects.ts'
import { type Change, type Dep } from './types.ts'
import { find, type Row, rows, spawnChanges, STUB } from './client.ts'

type Cast = (changes: Change[]) => void

// Freshly-wrapped stubs get a quiet quarter hour (a resumed session may
// still enrich its own doc); one desk an hour is the cost throttle.
let QUIET = 15 * 60_000
let THROTTLE = 60 * 60_000

let age = (r: Row, now: number, col: string) => {
  let t = Date.parse(String(r.comps.entity?.[col] ?? ''))
  return Number.isNaN(t) ? Infinity : now - t
}

// The queue: session docs still wearing the wrap marker, dust settled.
// The desk's own sessions are exempt — a scribe's wrap leaves a stub
// too, and scribing the scribe would spawn a desk an hour forever.
export let stubs = (all: Row[], now: number, deskEid?: string) =>
  all.filter((r) =>
    r.comps.session && String(r.comps.doc?.body ?? '').startsWith(STUB) &&
    !(deskEid && r.comps.session.requested_task_eid == deskEid) &&
    age(r, now, 'modified_at') > QUIET
  )

// One scribe at a time, and not more than hourly — a desk session still
// unsettled blocks regardless of age (never two writers on the queue).
export let deskFree = (all: Row[], desk: Row, now: number) =>
  !all.some((r) =>
    r.comps.session?.requested_task_eid == desk.eid &&
    (['starting', 'running'].includes(String(r.comps.session.status)) ||
      age(r, now, 'created_at') < THROTTLE)
  )

// The spawn, or the reason there isn't one (null = nothing to do; the
// missing-desk case logs once at the sweep so a half-seeded graph says
// so instead of silently never scribing).
export let scribeSpawn = (all: Row[], deps: Dep[], now: number) => {
  let desk = find(all, 'scribe-desk')
  if (!stubs(all, now, desk?.eid).length) return null
  if (!desk?.comps.task) throw new Error('no scribe-desk task in the graph')
  if (!find(all, 'scribe')?.comps.persona) {
    throw new Error('no scribe persona in the graph')
  }
  if (!deskFree(all, desk, now)) return null
  return spawnChanges(all, {
    task: 'scribe-desk',
    provider: 'claude',
    model: 'claude-haiku-4-5',
    persona: 'scribe',
    deps,
  }).changes
}

// The interval-safe door, mirroring inbound: never two sweeps in
// flight, and a failure is a warning — the next tick tries again.
let sweeping = false
export let scribeSweep = (cast: Cast) => {
  if (sweeping) return
  sweeping = true
  try {
    let snap = snapshot(db)
    let changes = scribeSpawn(rows(snap), snap.deps, Date.now())
    if (changes) {
      let t = trace()
      let out = apply(db, changes, t)
      cast(out)
      dispatch(out, t, (c, e) => console.warn(`scribe effect ${c} —`, e))
    }
  } catch (e) {
    console.warn('scribe sweep —', e)
  } finally {
    sweeping = false
  }
}
