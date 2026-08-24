// The dispatch sweep (T-21323; D-21287 Phase 1): approved, unblocked open
// tasks spawn their own managed sessions, up to a slot cap. Approval is the
// Court's act — the `decided` mark on the task — so the sweep only spends
// where a human already said yes. Creating the session IS the spawn request
// (the created(session) effect validates and launches; the launcher's
// auto-claim takes the lease), so this module holds no queue and no
// supervision — and no retry: a failed launch is a failed Session on the
// board, and its task is never re-asked until someone clears that session.
// A sweep like the others (scribe.ts is the sibling) — graduates to a
// `system` entity under T-3906.
import { apply, db, depsOf, settingValue } from './db.ts'
import { dispatch, trace } from './effects.ts'
import { type Change, type Dep, sessionActive } from './types.ts'
import { type Row, spawnChanges, spawnPlan } from './client.ts'
import { type Provider } from './providers.ts'
import { evalGraph, rowsFor } from './graph_query.ts'
import { resolve } from './config.ts'

type Cast = (changes: Change[]) => void

// Greenlit for autonomous dispatch: the task wears `decided`.
// TODO(T-21319): when `decided` grows its verdict enum, require
// verdict == 'approved' — until then bare presence is the approval.
export let approved = (r: Row) => !!r.comps.decided

let settled = (status: unknown) => status == 'done' || status == 'cancelled'

// Birth for the age ordering; an unstamped birth sorts last.
let born = (r: Row) => {
  let t = Date.parse(String(r.comps.created?.at ?? ''))
  return Number.isNaN(t) ? Infinity : t
}
let rank = (r: Row) =>
  typeof r.comps.task?.priority == 'number' ? r.comps.task.priority : Infinity

// Ready = open + unclaimed + approved + not externally blocked (D-17094) +
// no open `requires` edge. A blocker the caller didn't fetch counts as
// open — the safe reading for a sweep that spends money on yes. Most
// urgent first: priority, then age, then num.
export let ready = (all: Row[], deps: Dep[]) => {
  let by = new Map(all.map((r) => [r.eid, r]))
  let gated = (eid: string) =>
    deps.some((d) =>
      d.type == 'requires' && d.parent == eid &&
      !settled(by.get(d.child)?.comps.task?.status)
    )
  return all
    .filter((r) =>
      r.comps.task?.status == 'open' && !r.comps.claim && !r.comps.blocked &&
      approved(r) && !gated(r.eid)
    )
    .sort((a, b) => rank(a) - rank(b) || born(a) - born(b) || a.num - b.num)
}

// A session holds its slot until it reaches a terminal status — including
// the moment before the launch effect stamps 'starting', so a burst of
// sweeps can never over-spawn past the cap.
let liveRun = (s: Record<string, unknown>) =>
  !s.status || sessionActive.includes(String(s.status))

// The sessions the dispatcher is paying for: live, and asked to work an
// approved task. Counting rows (not remembering spawns) is what frees a
// slot the moment a session settles.
export let inFlight = (all: Row[]) => {
  let by = new Map(all.map((r) => [r.eid, r]))
  return all.filter((r) => {
    let s = r.comps.session
    if (!s?.requested_task || !liveRun(s)) return false
    let t = by.get(String(s.requested_task))
    return !!t && approved(t)
  })
}

// A task ever asked-for is never asked for again — v1's whole retry
// policy. A failed Session stays on the board saying so; deleting it is
// the human act that reopens dispatch for its task.
export let asked = (all: Row[], task: string) =>
  all.some((r) => r.comps.session?.requested_task == task)

// The cap as a number: the catalog guarantees a value ('2' default), but a
// stored override is free text, so a non-count falls back to the default.
export let slots = (value: string | undefined) => {
  let n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 2
}

// The batch the sweep would mint: one spawn per free slot, most urgent
// first — pure over the rows the sweep read, the testable half. Each
// launch resolves through spawnPlan, so a task's own `spawn` hint wins
// and the provider table fills the rest.
export let dispatchSpawn = (
  all: Row[],
  deps: Dep[],
  ps: Provider[],
  cap: number,
) => {
  let free = cap - inFlight(all).length
  let changes: Change[] = []
  for (let t of ready(all, deps)) {
    if (free <= 0) break
    if (asked(all, t.eid)) continue
    let plan = spawnPlan(all, ps, { task: t.eid })
    if (!plan.provider || !plan.model) break // nothing can launch — say so once
    changes.push(
      ...spawnChanges(all, {
        task: t.eid,
        provider: plan.provider,
        model: plan.model,
        ...(plan.effort ? { effort: plan.effort } : {}),
        ...(plan.persona ? { persona: plan.persona } : {}),
        deps,
      }).changes,
    )
    free--
  }
  return changes
}

// The interval-safe door, mirroring scribe: never two sweeps in flight,
// and a failure is a warning — the next tick tries again. `providers` is
// a thunk so account readiness is read fresh per sweep.
let sweeping = false
export let dispatchSweep = async (
  cast: Cast,
  providers: () => Promise<Provider[]>,
) => {
  if (sweeping) return
  sweeping = true
  try {
    // Scoped read (M-21143): open tasks, every session (the slot ledger and
    // the asked-for record), the tasks those sessions work, the open tasks'
    // blockers, and any persona a task's spawn hint names (plus its edges,
    // for the run's actor) — never the whole graph.
    let tasks = evalGraph(db, '.kind=task&.status=open').hits
    let sessions = evalGraph(db, '.kind=session').hits
    let personas = tasks.map((t) => t.comps.spawn?.persona)
      .filter((p): p is string => typeof p == 'string')
    let deps = depsOf(db, [...tasks.map((t) => t.eid), ...new Set(personas)])
    let extra = [
      ...sessions.map((s) => s.comps.session?.requested_task),
      ...deps.filter((d) => d.type == 'requires').map((d) => d.child),
      ...personas,
      ...deps.filter((d) =>
        personas.includes(d.parent) ||
        personas.includes(d.child)
      ).flatMap((d) => [d.parent, d.child]),
    ].filter((x): x is string => typeof x == 'string')
    let seen = new Set([...tasks, ...sessions].map((r) => r.eid))
    let all = [
      ...tasks,
      ...sessions,
      ...rowsFor(db, [...new Set(extra)].filter((e) => !seen.has(e))),
    ]
    let cap = slots(resolve('DISPATCH_SLOTS', (k) => settingValue(db, k)).value)
    let changes = dispatchSpawn(all, deps, await providers(), cap)
    if (changes.length) {
      let t = trace()
      let out = apply(db, changes, t)
      cast(out)
      dispatch(out, t, (c, e) => console.warn(`dispatch effect ${c} —`, e))
      let n = new Set(
        changes.filter((c) => c.name == 'session').map((c) => c.eid),
      ).size
      console.log(`dispatch sweep: ${n} spawned`)
    }
  } catch (e) {
    console.warn('dispatch sweep —', e)
  } finally {
    sweeping = false
  }
}
