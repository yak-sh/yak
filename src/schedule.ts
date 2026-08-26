// The scheduler as DATA (T-18725, D-18722 part B). The scheduler owns NO
// clock — per D-16403 "a scheduler effect only wakes the reconciler": it
// maintains a wake ROW and wake.ts's one timer fires it. The invariant this
// module reconciles, post-commit and at boot: a running role with
// wake_policy=scheduled and a readable schedule holds EXACTLY ONE pending
// self-wake at its next scheduled instant; every other role holds none. The
// wake is UNTARGETED with deliver.to = the role, so apply()'s replaceWakes
// swaps predecessors atomically (one cadence clock per actor) and the fired
// knock lands on the role itself — roleAttention then runs the reconciler,
// which owns the spawn. "One pending row", never one-per-missed-tick, is
// what turns downtime into a single boot fire instead of a storm.
//
// Re-arm triggers are deliberately redundant — each is idempotent against
// the invariant, so whichever lands first mints and the rest no-op:
//   - the role's own schedule/policy/state changing (and boot, via sweep)
//   - a role session reaching a terminal status (the design's settle re-arm)
//   - the self-wake itself firing (delivered) — so a run that never reaches
//     a terminal stamp (T-20075) cannot stall the cadence.
// SERVER-ONLY (imports db).
import { apply, human } from './db.ts'
import { db } from './live_db.ts'
import { errored } from './deliver.ts'
import { dispatch, trace } from './effects.ts'
import { type Change, sessionActive } from './types.ts'
import { next } from './time.ts'

type Cast = (changes: Change[]) => void

let iso = (t: number) => new Date(t).toISOString()
let idOf = `(select id from entity where eid = ?)`

type RoleRow = { state: string; wake_policy: string; schedule: string | null }
let roleOf = (eid: string) =>
  db.prepare(
    `select state, wake_policy, schedule from role where entity = ${idOf}`,
  ).get(eid) as RoleRow | undefined

// The role's pending self-wakes: untargeted, addressed to it, unacted.
let selfWakes = (eid: string) =>
  db.prepare(
    `select o.eid as eid, w.at from wake w
     join entity o on o.id = w.entity
     join deliver dl on dl.entity = w.entity
     where dl."to" = ${idOf} and w.target is null
       and not exists (select 1 from delivered d where d.entity = w.entity)
       and not exists (select 1 from error x where x.entity = w.entity)`,
  ).all(eid) as { eid: string; at: string }[]

// Reconcile one role against the invariant. Safe to call from any trigger,
// any number of times — it converges.
export let scheduleArm = (eid: string, cast: Cast) => {
  let role = roleOf(eid)
  let pending = selfWakes(eid)
  let wants = !!role && role.state == 'running' &&
    role.wake_policy == 'scheduled' && !!role.schedule?.trim()
  if (!wants) {
    // A role that stopped being scheduled sheds its clock — a stale wake
    // would knock a role the reconciler will refuse.
    if (pending.length) {
      let out = apply(
        db,
        pending.map(({ eid }) => ({ eid, name: 'entity', comp: null })),
      )
      cast(out)
    }
    return
  }
  let at = next(role!.schedule!, Date.now())
  if (at == null) {
    // Unreadable stays LOUD on the role (M-16612) — and sheds any clock a
    // previously-readable schedule left armed.
    errored(eid, `unreadable schedule: ${role!.schedule}`, cast)
    if (pending.length) {
      cast(apply(
        db,
        pending.map(({ eid }) => ({ eid, name: 'entity', comp: null })),
      ))
    }
    return
  }
  if (pending.length == 1 && pending[0].at == iso(at)) return
  // A due row is wake.ts's to fire — never swap it out from underneath: the
  // mint's replaceWakes would tombstone a wake mid-flight. The fired knock
  // re-arms us right after (scheduleKnocked).
  if (pending.some((p) => p.at <= iso(Date.now()))) return
  // Mint the one true clock. replaceWakes (apply) drops every pending
  // untargeted predecessor addressed to this role in the same transaction;
  // `by` = the role itself, so the fired knock is born archived — an alarm
  // clock, not correspondence. dispatch() lets wake.ts re-arm its timer.
  let t = trace()
  let we = crypto.randomUUID()
  let out = apply(
    db,
    [
      { eid: we, name: 'wake', comp: { at: iso(at) } },
      { eid: we, name: 'deliver', comp: { to: eid } },
    ],
    t,
    eid,
  )
  cast(out)
  dispatch(out, t, (c, e) => console.warn(`schedule ${c} —`, e))
}

// Settle trigger: a role session reaching a terminal status re-arms its role.
export let scheduleSettled =
  (cast: Cast) => (eid: string, comp: Record<string, unknown>) => {
    let status = String(comp.status ?? '')
    if (sessionActive.includes(status)) return
    let role = db.prepare(
      `select (select eid from entity where id = role) as role
       from session where entity = ${idOf} and role is not null`,
    ).get(eid) as { role: string } | undefined
    if (role) scheduleArm(role.role, cast)
  }

// Fired trigger: the cadence knock (deliver.to = a scheduled role) re-arms
// the next instant, so continuity never depends on the run reaching a
// terminal stamp (T-20075). Deferred one macrotask: the firing wake settles
// its own delivered stamp right after minting this knock, and the re-arm
// must see it settled — a pending due row is deliberately left alone (above).
export let scheduleKnocked = (cast: Cast) => (eid: string) => {
  let to = db.prepare(
    `select (select eid from entity where id = dl."to") as "to"
     from knock k join deliver dl on dl.entity = k.entity
     where k.entity = ${idOf}`,
  ).get(eid) as { to: string } | undefined
  if (!to?.to) return
  if (roleOf(to.to)?.wake_policy != 'scheduled') return
  setTimeout(() => {
    try {
      scheduleArm(to!.to, cast)
    } catch (e) {
      console.warn('schedule re-arm —', e)
    }
  }, 0)
}

// Every role, once — the boot sweep, and cheap enough to be the catch-all.
export let scheduleSweep = (cast: Cast) => {
  let roles = db.prepare(
    `select o.eid as eid from role join entity o on o.id = role.entity`,
  ).all() as { eid: string }[]
  for (let r of roles) {
    try {
      scheduleArm(r.eid, cast)
    } catch (e) {
      console.warn(`schedule sweep ${human(db, r.eid)} —`, e)
    }
  }
}
