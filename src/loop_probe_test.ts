// End-to-end probe for the D-21448 park → fan-out → wake → finish loop
// (Piece 4, T-21453; arming closed by T-21496). It proves all four pieces
// COMPOSE with NO manual intervention: the sweep spawns the gated parent
// (parkable), the parent arms its park through the REAL `task park` door
// (runCommand), Piece 1 retains that claim across the boot heal, and Piece 2
// knocks the parent when its blocker lands. The earlier version armed the wake
// manually to stand in for the unbuilt arming — that gap is now closed, so the
// probe drives the production door instead.
//
// Slow tier: exercises the real in-memory db + the real Piece 1–4 functions
// (parkable, runCommand :park, reapLeases, unblocking, backlog) against one
// scenario. Runs under TASKS_SLOW.
import { type Change } from './types.ts'
import { link } from './edge.ts'
Deno.env.set('DB_PATH', ':memory:')
let { apply, depsOf, eager } = await import('./db.ts')
let { open } = await import('./store/sqlite.ts')
let { db } = await import('./live_db.ts')
let { reapLeases } = await import('./sessions.ts')
let { unblocking } = await import('./unblock.ts')
let { backlog, parkable } = await import('./dispatch.ts')
let { run: runCommand } = await import('./commands.ts')
let { rowed } = await import('./graph_query.ts')
let { slow } = await import('./testing.ts')
let { assertEquals } = await import('@std/assert')

open()
let uid = () => crypto.randomUUID()

let mkTask = (extra: Record<string, Change['comp']> = {}) => {
  let eid = uid()
  apply(db, [
    { eid, name: 'doc', comp: { title: 'task' } },
    { eid, name: 'task', comp: { priority: 0 } },
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
  apply(db, link(parent, 'requires', child))
let claim = (task: string, session: string) =>
  apply(db, [{ eid: task, name: 'claim', comp: { session } }])
let row = (eid: string) => rowed({ eid, comps: eager(db, eid) })
let claimOf = (task: string) => eager(db, task).claim?.session

slow(
  'D-21448 loop closes end to end through the real park door (arming = T-21496)',
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

    // The sweep spawns the gated umbrella parent too (parkable), so a warm agent
    // exists to hold T's claim and park — the piece the leaves-only frontier left
    // out. T is approved, open, unclaimed, and gated, so it is parkable.
    assertEquals(
      parkable(all(), deps()).map((r) => r.eid).includes(T),
      true,
      'the sweep spawns the gated umbrella parent to park',
    )

    // Piece 1 — the park survives a restart. Parent P claims T (→wip), then P
    // arms its park through the REAL `task park` door (runCommand), not a manual
    // stand-in. The boot heal runs: P's parked-waiting claim on still-gated T is
    // RETAINED (no orphan); Q's ordinary lease on ungated D is reaped, exactly as
    // an abnormal-exit lease should be.
    claim(T, P)
    let pid = String(eager(db, P).session!.id)
    let parked = runCommand('park in 1h', {
      session: pid,
      rows: [row(P), row(T)],
    })
    let armed = (parked.changes ?? []).find((c) =>
      c.name === 'deliver' && (c.comp as { to?: string })?.to === P
    )
    assertEquals(!!armed, true, 'task park arms a wake on the parking session')
    assertEquals(
      ((parked.changes ?? []).find((c) => c.name === 'wake')
        ?.comp as { target?: string })?.target,
      T,
      'the park wake points back at the held task',
    )
    apply(db, parked.changes ?? [])
    reapLeases((cs) => cs)
    assertEquals(
      claimOf(T),
      P,
      'parked-waiting claim survives the boot heal — no orphan',
    )
    assertEquals(claimOf(D), undefined, 'an ordinary lease is reaped at boot')

    // Piece 2 — the wake. D completes; the dep-completion effect finds T now
    // ungated with P still its claimant, and knocks P — closing the loop.
    apply(db, [{ eid: D, name: 'completed', comp: {} }])
    let knocks: Change[] = []
    unblocking((cs) => knocks.push(...cs))(D, {})

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
