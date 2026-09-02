// The dispatch sweep (T-21323; D-21287 Phase 1): approved, unblocked open
// tasks spawn their own managed sessions, up to a slot cap. Approval is the
// Court's act — the `decided` mark on the task — so the sweep only spends
// where a human already said yes. Creating the session IS the spawn request
// (the created(session) effect validates and launches; the launcher's
// auto-claim takes the lease), so this module holds no queue and no
// supervision. A terminal attempt remains durable; a later server-minted
// resume generation may authorize exactly one fresh Session after backoff.
// A sweep like the others (scribe.ts is the sibling) — graduates to a
// `system` entity under T-3906.
import { apply, depsOf, settingValue } from './db.ts'
import { db } from './live_db.ts'
import { commitEffects } from './effects.ts'
import { type Change, type Dep, statusOf } from './types.ts'
import { idOf, type Row, spawnChanges, spawnPlan } from './client.ts'
import { hotRun, isPersona, liveRun } from './spawnrule.ts'
import { type Provider } from './providers.ts'
import { evalDispatchWork, evalGraph, rowsFor } from './graph_query.ts'
import { resolve } from './config.ts'
import { record as telemetry } from './telemetry.ts'
import type { Sql } from './store/sql.ts'
import { approved, authorized, buildReady, workFilters } from './work.ts'

export { approved, authorized } from './work.ts'

type Cast = (changes: Change[]) => void

// Status is DERIVED from the comps (D-24102): open = no completed/cancelled/claim,
// settled = wears completed or cancelled. Reading it off statusOf keeps dispatch
// selecting the same tasks whether or not a row carries the materialized value.
let statusIs = (r: Row) => statusOf(r.comps)
let settled = (r?: Row) => {
  let s = r && statusIs(r)
  return s == 'done' || s == 'cancelled'
}
let born = (r: Row) => {
  let at = Date.parse(String(r.comps.created?.at ?? ''))
  return Number.isNaN(at) ? Infinity : at
}
let rank = (r: Row) =>
  typeof r.comps.task?.priority == 'number' ? r.comps.task.priority : Infinity
let resumeRank = (r: Row) => Number(r.comps.resume?.rank ?? 0)
let order = (a: Row, b: Row) =>
  Number(!!b.comps.resume) - Number(!!a.comps.resume) ||
  resumeRank(b) - resumeRank(a) || rank(a) - rank(b) ||
  born(a) - born(b) || a.num - b.num

// Scheduling stays local; work.ts owns the membership predicate shared with
// external workers, while resume generation and age decide spend order here.
export let backlog = (all: Row[], deps: Dep[], recursive = false) => {
  let by = new Map(all.map((r) => [r.eid, r]))
  let auth = recursive ? authorized(all, deps) : new Set<string>()
  return all
    .filter((r) => buildReady(r, by, deps, auth.has(r.eid)))
    .sort(order)
}

export let ready = (all: Row[], deps: Dep[]) => backlog(all, deps, false)

// The parked-parent frontier (D-21448): individually-APPROVED, open, unclaimed,
// unblocked, never-attempted GATED tasks — the umbrellas an operator spawns an agent
// onto. The sweep spawns a WARM agent that holds the claim and PARKS, to be
// resumed by the dep-completion knock (unblock.ts) when a blocker lands, rather
// than cold-redispatched. The gated COMPLEMENT of backlog: backlog spawns the
// ungated frontier that does the work; this spawns the gated umbrellas that wait
// on it. Only INDIVIDUALLY-approved (not merely authorized-by-ancestor) gated
// tasks park: a purely-gated intermediate does no setup before it would park, so
// warm-park buys it nothing over the cold re-dispatch it gets when it ungates —
// warm-park is reserved for the task the owner actually pointed an agent at.
// Spawned AFTER the workers (dispatchSpawn), so real work never waits behind a
// parker for a slot; and a parked session frees its slot the moment it settles
// (liveRun is false for a settled-with-wake run), so parkers don't hold the cap.
export let parkable = (all: Row[], deps: Dep[]) => {
  let by = new Map(all.map((r) => [r.eid, r]))
  let gated = (eid: string) =>
    deps.some((d) =>
      d.type == 'requires' && d.parent == eid &&
      !settled(by.get(d.child))
    )
  return all
    .filter((r) =>
      !!r.comps.task && statusIs(r) == 'open' && !r.comps.claim &&
      !r.comps.blocked && !r.comps.quarantined &&
      approved(r) && gated(r.eid) &&
      !all.some((s) => s.comps.session?.requested_task == r.eid)
    )
    .sort(order)
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

// Retry delay in milliseconds. Zero/invalid disables retry: a terminal attempt
// is never retried without an explicitly nonzero safety window.
export let retryBackoff = (value: string | undefined) => {
  let n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

// Attempt identity is the Session birth, not its mutable outcome. The first
// attempt has no history. A retry requires a terminal history, a fresh resume
// generation, and its elapsed backoff. A birth at/after resume.at consumes that
// generation forever; a later release mints a later timestamp and can authorize
// one more attempt. Any pending/starting/running Session always suppresses.
export let attemptEligible = (
  all: Row[],
  task: string,
  now = Date.now(),
  backoff?: number,
) => {
  let attempts = all.filter((r) => r.comps.session?.requested_task == task)
  if (attempts.some((r) => liveRun(r.comps.session!))) return false
  if (!attempts.length) return true
  let t = all.find((r) => r.eid == task)
  let at = Date.parse(String(t?.comps.resume?.at ?? ''))
  if (!backoff || Number.isNaN(at) || now < at + backoff) return false
  return !attempts.some((r) => born(r) >= at)
}

// Compatibility name for callers that ask the inverse question. Unlike v1 it
// is generation-aware; callers that need elapsed time should use
// attemptEligible directly.
export let asked = (
  all: Row[],
  task: string,
  now = Date.now(),
  backoff?: number,
) => !attemptEligible(all, task, now, backoff)

// The cap as a number: the catalog guarantees a value ('2' default), but a
// stored override is free text, so a non-count falls back to the default.
export let slots = (value: string | undefined) => {
  let n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 2
}

// A flag setting read as a boolean: any of 1/true/on/yes (case-insensitive)
// enables it; anything else — including the empty default — is off.
export let on = (value: string | undefined) =>
  ['1', 'true', 'on', 'yes'].includes((value ?? '').trim().toLowerCase())

// The provider denylist (config DISPATCH_EXCLUDE) as a name set: comma- or
// space-separated. Dropped from the sweep's provider view so the rotation
// never draws a provider that can't launch here (T-24115); the empty default
// bars nothing.
export let excluded = (value: string | undefined) =>
  new Set((value ?? '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))

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
      return order(x, y)
    })
}

export type DispatchCandidate = {
  target: Row
  // A planning refusal occupies its ordered position, but has no mutation.
  changes?: Change[]
  error?: unknown
  spends: boolean
}

// Commit candidates independently. Planning and apply refusals are addressed
// to their target and never charge a slot; cleanup-only candidates never charge
// one either. The caller supplies commitEffects as the commit door, keeping the
// process-configured split-effects policy central.
export let commitCandidates = (
  candidates: DispatchCandidate[],
  free: number,
  commit: (changes: Change[]) => void,
  refuse: (target: Row, error: unknown) => void,
) => {
  let spawned = 0
  for (let candidate of candidates) {
    if (candidate.spends && free <= 0) break
    if (candidate.error || !candidate.changes) {
      refuse(
        candidate.target,
        candidate.error ?? new Error('no candidate batch'),
      )
      continue
    }
    try {
      commit(candidate.changes)
      if (candidate.spends) {
        free--
        spawned++
      }
    } catch (e) {
      refuse(candidate.target, e)
    }
  }
  return spawned
}

// Stable, durable address for every refused candidate. telemetry.record owns
// sanitization; detail stays the human graph id rather than an opaque UUID.
export let candidateRefusal = (
  database: Sql,
  target: Row,
  e: unknown,
) =>
  telemetry(database, {
    source: 'srv',
    name: 'dispatch candidate',
    ok: false,
    error: String(e),
    detail: idOf(target),
  })

// The batch the sweep would mint: one spawn per free slot, marks first (an
// event is an attention ask; the ready backlog waits behind it), then the
// greenlit backlog — approved roots, plus (when `recursive`) the unblocked
// blockers an approved umbrella authorizes — pure over the rows the sweep read,
// the testable half.
// A mark spawns its persona onto its target (the watcher outranks the
// task's own spawn hint) and clears its edge in the same batch; a mark
// whose target a live run of the persona already attends, or that settled
// meanwhile, clears unspent — the event reached the hot run's transcript,
// or nobody's. Marks skip asked(): events re-instantiate by design, and
// the (persona, target) debounce is what bounds them. Each backlog launch
// resolves through spawnPlan, so a task's own `spawn` hint wins and the
// provider table fills the rest.
export let dispatchCandidates = (
  all: Row[],
  deps: Dep[],
  ps: Provider[],
  recursive = false,
  now = Date.now(),
  backoff?: number,
  readyRows?: Row[],
) => {
  let by = new Map(all.map((r) => [r.eid, r]))
  let candidates: DispatchCandidate[] = []
  let spawned = new Set<string>()
  // A resolved plan whose provider isn't in `ps` — a task pinned to a provider
  // the sweep excludes (ps is already filtered). Skip it, don't stop: other
  // tasks may still land on a provider that launches (T-24115).
  let barred = (provider?: string) => !ps.some((p) => p.name == provider)
  let missingPlan = (t: Row) => {
    candidates.push({
      target: t,
      error: new Error('no dispatch provider/model plan'),
      spends: true,
    })
  }
  let drop = (d: Dep) => ({
    eid: d.parent,
    name: 'dependency',
    comp: { type: 'wants', child: d.child, gone: true },
  })
  for (let d of wanted(all, deps)) {
    let t = by.get(d.child)!
    if (settled(t) || hotRun(all, d.parent, t)) {
      candidates.push({ target: t, changes: [drop(d)], spends: false })
      continue
    }
    // A different active persona may be attending the task. Keep this mark
    // pending rather than violating one-active-attempt-per-task.
    if (
      all.some((r) =>
        r.comps.session?.requested_task == t.eid && liveRun(r.comps.session)
      )
    ) continue
    try {
      let plan = spawnPlan(all, ps, { task: t.eid, ask: { persona: d.parent } })
      if (!plan.provider || !plan.model) {
        if (!ps.length) break
        missingPlan(t)
        continue
      }
      if (barred(plan.provider)) continue
      let made = spawnChanges(all, {
        task: t.eid,
        provider: plan.provider,
        model: plan.model,
        ...(plan.effort ? { effort: plan.effort } : {}),
        persona: d.parent,
        deps,
      }).changes
      candidates.push({ target: t, changes: [...made, drop(d)], spends: true })
      spawned.add(t.eid)
    } catch (error) {
      candidates.push({ target: t, error, spends: true })
    }
  }
  for (let t of readyRows ?? backlog(all, deps, recursive)) {
    if (spawned.has(t.eid) || !attemptEligible(all, t.eid, now, backoff)) {
      continue
    }
    try {
      let plan = spawnPlan(all, ps, { task: t.eid })
      if (!plan.provider || !plan.model) {
        if (!ps.length) break
        missingPlan(t)
        continue
      }
      if (barred(plan.provider)) continue
      let changes = spawnChanges(all, {
        task: t.eid,
        provider: plan.provider,
        model: plan.model,
        ...(plan.effort ? { effort: plan.effort } : {}),
        ...(plan.persona ? { persona: plan.persona } : {}),
        deps,
      }).changes
      candidates.push({ target: t, changes, spends: true })
      spawned.add(t.eid)
    } catch (error) {
      candidates.push({ target: t, error, spends: true })
    }
  }
  // The parked parents (D-21448), after the workers: a gated umbrella spawns a
  // warm agent that holds T's claim and parks (spawned() folds the park
  // directive into a gated task's prompt), resumed by the dep-completion knock
  // when its blockers land. Recursive-only — the same approval gate that
  // authorizes the frontier. Lower priority than real work; if slots are
  // contended it simply doesn't spawn this sweep and degrades to cold
  // re-dispatch once ungated — correct either way.
  if (recursive) {
    for (let t of parkable(all, deps)) {
      if (spawned.has(t.eid)) continue
      try {
        let plan = spawnPlan(all, ps, { task: t.eid })
        if (!plan.provider || !plan.model) {
          if (!ps.length) break
          missingPlan(t)
          continue
        }
        if (barred(plan.provider)) continue
        let changes = spawnChanges(all, {
          task: t.eid,
          provider: plan.provider,
          model: plan.model,
          ...(plan.effort ? { effort: plan.effort } : {}),
          ...(plan.persona ? { persona: plan.persona } : {}),
          deps,
        }).changes
        candidates.push({ target: t, changes, spends: true })
        spawned.add(t.eid)
      } catch (error) {
        candidates.push({ target: t, error, spends: true })
      }
    }
  }
  return candidates
}

// Legacy pure facade: flatten the independently planned batches as if every
// commit succeeded. Production uses dispatchCandidates + commitCandidates so a
// refused batch can be replaced by the next candidate without spending a slot.
export let dispatchSpawn = (
  all: Row[],
  deps: Dep[],
  ps: Provider[],
  cap: number,
  recursive = false,
  now = Date.now(),
  backoff?: number,
  readyRows?: Row[],
) => {
  let free = cap - inFlight(all).length
  let out: Change[] = []
  commitCandidates(
    dispatchCandidates(all, deps, ps, recursive, now, backoff, readyRows),
    free,
    (changes) => out.push(...changes),
    () => {},
  )
  return out
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
    // Validate endpoints before expanding a neighborhood. In particular, a
    // project wearing a stale wants edge must not make its unrelated reads
    // memories visible to backlog construction (P-22 → M-4585).
    let hinted = tasks.map((t) => t.comps.spawn?.persona)
      .filter((p): p is string => typeof p == 'string')
    let endpoints = rowsFor(db, [
      ...hinted,
      ...wants.flatMap((w) => [w.parent, w.child]),
    ])
    let endpointBy = new Map(endpoints.map((r) => [r.eid, r]))
    let validWants = wants.filter((w) =>
      isPersona(endpointBy.get(w.parent)) &&
      !!endpointBy.get(w.child)?.comps.task
    )
    let personas = [
      ...hinted.filter((p) => isPersona(endpointBy.get(p))),
      ...validWants.map((w) => w.parent),
    ]
    // depsOf over the personas re-reads every mark, so `wants` never dupes
    // into deps here.
    let deps = depsOf(db, [...tasks.map((t) => t.eid), ...new Set(personas)])
    let extra = [
      ...sessions.map((s) => s.comps.session?.requested_task),
      ...deps.filter((d) => d.type == 'requires').map((d) => d.child),
      ...validWants.map((w) => w.child),
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
    let recursive = on(
      resolve('DISPATCH_RECURSIVE', (k) => settingValue(db, k)).value,
    )
    let backoff = retryBackoff(
      resolve('DISPATCH_RETRY_BACKOFF', (k) => settingValue(db, k)).value,
    )
    // Recursive readiness must see every intermediary, including entities
    // that are not tasks and therefore are absent from the dispatch context
    // below. The shared DB selector owns that complete closure; `all` remains
    // the bounded policy/spawn context for slots, prior asks, and plans.
    let readyRows = evalDispatchWork(
      db,
      workFilters('build', recursive).join('&'),
      recursive,
    )
    // Drop the denied providers before the sweep picks, so the default model
    // never routes to a provider that can't launch here (T-24115). Excluding a
    // graph-native provider without its CLI fallback would leave the fallback
    // to carry the same model, so the operator lists both.
    let bar = excluded(
      resolve('DISPATCH_EXCLUDE', (k) => settingValue(db, k)).value,
    )
    let ps = (await providers()).filter((p) => !bar.has(p.name))
    let candidates = dispatchCandidates(
      all,
      deps,
      ps,
      recursive,
      Date.now(),
      backoff,
      readyRows,
    )
    let n = commitCandidates(
      candidates,
      cap - inFlight(all).length,
      (changes) => {
        commitEffects((t) => apply(db, changes, t), cast)
      },
      (target, e) => candidateRefusal(db, target, e),
    )
    if (n) console.log(`dispatch sweep: ${n} spawned`)
  } catch (e) {
    console.warn('dispatch sweep —', e)
  } finally {
    sweeping = false
  }
}
