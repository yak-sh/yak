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
import { type Change, type Dep } from './types.ts'
import { type Row, spawnChanges, spawnPlan } from './client.ts'
import { hotRun, isPersona, liveRun } from './spawnrule.ts'
import { type Provider } from './providers.ts'
import { evalGraph, rowsFor } from './graph_query.ts'
import { resolve } from './config.ts'

type Cast = (changes: Change[]) => void

// Greenlit for autonomous dispatch: the task wears `decided` and was not
// decided AGAINST. Absent verdict reads as approved — what every row
// stamped before the column meant (D-21212).
export let approved = (r: Row) =>
  !!r.comps.decided && r.comps.decided.verdict != 'declined'

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

// The sessions the dispatcher is paying for: live (a session holds its slot
// until a terminal status — including the moment before the launch effect
// stamps 'starting', so a burst of sweeps can never over-spawn past the cap),
// and asked to work either an approved task or a persona's spawn-rule match.
// A persona run counts by its `persona` column: the mark that asked for it is
// cleared at spawn, so the row is the only record of the spend — and a
// hand-spawned persona run holding a slot errs on the cheap side. Counting
// rows (not remembering spawns) is what frees a slot the moment a session
// settles.
export let inFlight = (all: Row[]) => {
  let by = new Map(all.map((r) => [r.eid, r]))
  return all.filter((r) => {
    let s = r.comps.session
    if (!s?.requested_task || !liveRun(s)) return false
    let t = by.get(String(s.requested_task))
    return !!t && (approved(t) || !!s.persona)
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

// The pending spawn marks, most urgent target first: `wants` edges a
// persona's watch match minted (spawnrule.ts). Only a persona parent and a
// task child count — anything else is a stale mark the sweep leaves alone
// (a dead endpoint cascades the edge away on its own).
export let wanted = (all: Row[], deps: Dep[]) => {
  let by = new Map(all.map((r) => [r.eid, r]))
  return deps
    .filter((d) =>
      d.type == 'wants' && isPersona(by.get(d.parent)) &&
      !!by.get(d.child)?.comps.task
    )
    .sort((a, b) => {
      let x = by.get(a.child)!, y = by.get(b.child)!
      return rank(x) - rank(y) || born(x) - born(y) || x.num - y.num
    })
}

// The batch the sweep would mint: one spawn per free slot, marks first (an
// event is an attention ask; the ready backlog waits behind it), then the
// approved backlog — pure over the rows the sweep read, the testable half.
// A mark spawns its persona onto its target (the watcher outranks the
// task's own spawn hint) and clears its edge in the same batch; a mark
// whose target a live run of the persona already attends, or that settled
// meanwhile, clears unspent — the event reached the hot run's transcript,
// or nobody's. Marks skip asked(): events re-instantiate by design, and
// the (persona, target) debounce is what bounds them. Each backlog launch
// resolves through spawnPlan, so a task's own `spawn` hint wins and the
// provider table fills the rest.
export let dispatchSpawn = (
  all: Row[],
  deps: Dep[],
  ps: Provider[],
  cap: number,
) => {
  let by = new Map(all.map((r) => [r.eid, r]))
  let free = cap - inFlight(all).length
  let changes: Change[] = []
  let spawned = new Set<string>()
  let drop = (d: Dep) =>
    changes.push({
      eid: d.parent,
      name: 'dependency',
      comp: { type: 'wants', child: d.child, gone: true },
    })
  for (let d of wanted(all, deps)) {
    let t = by.get(d.child)!
    if (settled(t.comps.task?.status) || hotRun(all, d.parent, t)) {
      drop(d)
      continue
    }
    if (free <= 0) break // the mark waits for the next sweep's free slot
    let plan = spawnPlan(all, ps, { task: t.eid, ask: { persona: d.parent } })
    if (!plan.provider || !plan.model) break // nothing can launch — say so once
    changes.push(
      ...spawnChanges(all, {
        task: t.eid,
        provider: plan.provider,
        model: plan.model,
        ...(plan.effort ? { effort: plan.effort } : {}),
        persona: d.parent,
        deps,
      }).changes,
    )
    drop(d)
    spawned.add(t.eid)
    free--
  }
  for (let t of ready(all, deps)) {
    if (free <= 0) break
    if (spawned.has(t.eid) || asked(all, t.eid)) continue
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
    // blockers, the pending spawn marks (`wants` edges) with both endpoints,
    // and any persona a task's spawn hint or a mark names (plus its edges,
    // for the run's actor) — never the whole graph.
    let tasks = evalGraph(db, '.kind=task&.status=open').hits
    let sessions = evalGraph(db, '.kind=session').hits
    let wants = db.prepare(
      `select p.eid as parent, d.type as type, c.eid as child
       from dependency d
       join entity p on p.id = d.parent
       join entity c on c.id = d.child
       where d.type = 'wants'`,
    ).all() as Dep[]
    let personas = [
      ...tasks.map((t) => t.comps.spawn?.persona)
        .filter((p): p is string => typeof p == 'string'),
      ...wants.map((w) => w.parent),
    ]
    // depsOf over the personas re-reads every mark, so `wants` never dupes
    // into deps here.
    let deps = depsOf(db, [...tasks.map((t) => t.eid), ...new Set(personas)])
    let extra = [
      ...sessions.map((s) => s.comps.session?.requested_task),
      ...deps.filter((d) => d.type == 'requires').map((d) => d.child),
      ...wants.map((w) => w.child),
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
