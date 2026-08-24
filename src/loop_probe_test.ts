// End-to-end probe for the D-21448 park → fan-out → wake → finish loop
// (Piece 4, T-21453). It proves Pieces 1–3 COMPOSE — GIVEN the park wake is
// armed. The arming itself is NOT built (T-21496): no production path arms a
// dep-waiting session's wake, so this probe arms it MANUALLY (mints wake +
// deliver for the parent) to stand in for that gap and isolate the hole to
// arming alone. A probe that silently papered over the gap would be worse than
// none, so the manual arming is explicit and named here.
//
// Slow tier: exercises the real in-memory db + the real Piece 1–3 functions
// (reapLeases, unblocking, backlog) against one scenario. Runs under TASKS_SLOW.
import { type Change } from './types.ts'
Deno.env.set('DB_PATH', ':memory:')
let { apply, db, open, depsOf, eager } = await import('./db.ts')
let { reapLeases } = await import('./sessions.ts')
let { unblocking } = await import('./unblock.ts')
let { backlog } = await import('./dispatch.ts')
let { rowed } = await import('./graph_query.ts')
let { slow } = await import('./testing.ts')
let { assertEquals } = await import('@std/assert')

open()
let uid = () => crypto.randomUUID()

let mkTask = (extra: Record<string, Change['comp']> = {}) => {
  let eid = uid()
  apply(db, [
    { eid, name: 'doc', comp: { title: 'task' } },
    { eid, name: 'task', comp: { status: 'open', priority: 0 } },
    ...Object.entries(extra).map(([name, comp]) => ({ eid, name, comp })),
  ])
  return eid
}
let session = () => {
  let eid = uid()
  apply(db, [{ eid, name: 'session', comp: { id: uid() } }])
  return eid
}
let requires = (parent: string, child: string) =>
  apply(db, [{
    eid: parent,
    name: 'dependency',
    comp: { type: 'requires', child },
  }])
let claim = (task: string, session: string) =>
  apply(db, [{ eid: task, name: 'claim', comp: { session } }])
// Arm a return wake for a session — the stand-in for the unbuilt park-arming
// (T-21496): a `wake` + `deliver{to:session}` with no delivered/error is exactly
// what pendingWake() reads as the parked standing.
let armWake = (session: string) => {
  let k = uid()
  apply(db, [
    {
      eid: k,
      name: 'wake',
      comp: { at: new Date(Date.now() + 3.6e6).toISOString() },
    },
    { eid: k, name: 'deliver', comp: { to: session } },
  ])
}
let row = (eid: string) => rowed({ eid, comps: eager(db, eid) })
let claimOf = (task: string) => eager(db, task).claim?.session

slow(
  'D-21448 loop closes end to end when the park wake is armed (arming = T-21496)',
  () => {
    // Approved umbrella T, gated by an unblocked blocker D. P will be the parent
    // parked on T; Q the worker on D. Claims happen inline, in loop order.
    let T = mkTask({ decided: { at: new Date().toISOString() } })
    let D = mkTask()
    requires(T, D)
    let P = session()
    let Q = session()

    let all = () => [row(T), row(D)]
    let deps = () => depsOf(db, [T, D])

    // Piece 3 — recursive fan-out. Root-only never surfaces D (it is neither an
    // approved root nor a runnable root — D is only reachable through T); the
    // gated umbrella T is not itself runnable. The recursive descent DOES surface
    // D, because approval inherits down the requires edge from the approved T.
    let rootOnly = backlog(all(), deps(), false).map((r) => r.eid)
    assertEquals(
      rootOnly.includes(D),
      false,
      'root-only backlog must not surface a blocker',
    )
    assertEquals(
      rootOnly.includes(T),
      false,
      'a gated umbrella is not itself runnable',
    )
    let frontier = backlog(all(), deps(), true).map((r) => r.eid)
    assertEquals(
      frontier.includes(D),
      true,
      'recursive descent surfaces the unblocked blocker',
    )

    // No double-spawn: worker Q claims D (claiming flips it to `wip`), so the
    // recursive frontier now leaves it alone — a dep being worked is never
    // re-spawned.
    claim(D, Q)
    let frontierWorked = backlog(all(), deps(), true).map((r) => r.eid)
    assertEquals(
      frontierWorked.includes(D),
      false,
      'a claimed/in-flight blocker is left alone (no double-spawn)',
    )

    // Piece 1 — the park survives a restart. Parent P claims T (→wip), then P's
    // wake is armed (the T-21496 stand-in for the missing production arming) and
    // the boot heal runs. P's parked-waiting claim on still-gated T is RETAINED
    // (no orphan); Q's ordinary lease on ungated D is reaped, exactly as an
    // abnormal-exit lease should be.
    claim(T, P)
    armWake(P)
    reapLeases((cs) => cs)
    assertEquals(
      claimOf(T),
      P,
      'parked-waiting claim survives the boot heal — no orphan',
    )
    assertEquals(claimOf(D), undefined, 'an ordinary lease is reaped at boot')

    // Piece 2 — the wake. D completes; the dep-completion effect finds T now
    // ungated with P still its claimant, and knocks P — closing the loop.
    apply(db, [{ eid: D, name: 'task', comp: { status: 'done' } }])
    let knocks: Change[] = []
    unblocking((cs) => knocks.push(...cs))(D, { status: 'done' })

    let delivered = knocks.find((c) =>
      c.name === 'deliver' && (c.comp as { to?: string })?.to === P
    )
    assertEquals(
      !!delivered,
      true,
      'the parked parent is knocked when its last blocker completes',
    )
    let knock = knocks.find((c) =>
      c.eid === delivered!.eid && c.name === 'knock'
    )
    assertEquals(
      (knock?.comp as { target?: string })?.target,
      T,
      'the knock targets the now-ungated task',
    )
  },
)
