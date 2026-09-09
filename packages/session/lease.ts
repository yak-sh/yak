// The lock rule, as one hook on the `precondition` phase.
//
// WHY THAT PHASE. `precondition` runs inside the batch's own transaction and
// before a single row has moved. Both facts are load-bearing. Inside the
// transaction, so the holder this hook reads is the holder the batch is about
// to write against — a check outside it is a check against a graph somebody
// else may have moved in between. Before any write, so the holder is read
// BEFORE the cascade phase can remove it: a batch that deletes a session and
// takes its lock in the same breath must still bounce, and a check that ran
// after the cascade would find an empty lock and admit the take.
//
// THE LOCK. A claim is a LEASE, not a patch. Writing one over another session's
// fails the whole batch loudly — release, then claim. The same session
// re-claiming is a no-op refresh, so a worker replaying its own take is
// idempotent. A RELEASE (`claim: null`) is deliberately unguarded: letting go
// is how a lock is handed over, and the boot reap frees a dead session's locks
// without pretending to be that session.
//
// The batch is read as a whole, because a batch may take two locks, and the
// answer has to be about the batch rather than about each bundle in turn.

import type { Bundle, Comp, Eid, Hook } from '@yaks/graph'
import { then } from '@yaks/graph'
import { CLAIM } from './comp.ts'
import { Bounced } from './bounce.ts'

/** What the hook needs from its host: a clock, so a test can stamp a fixed
 * moment and a graph can stamp the moment it committed. */
export type LeaseOpts = {
  /** the moment a new lock is stamped with (default: now, ISO-8601) */
  now?: () => string
}

// One component off a bundle, or undefined. `null` means "drop it", which is
// not a value the check is about.
let of = (b: Bundle | undefined, name: string): Comp | undefined =>
  (b?.[name] ?? undefined) as Comp | undefined

/** The locks a batch takes: the entity, and the session it hands the lock to.
 * A bundle that DROPS a lock states no take and is not here. */
export let takes = (bundles: Bundle[]): [Eid, Eid][] =>
  bundles.flatMap((b) => {
    let s = of(b, CLAIM)?.session
    return s ? [[b.entity.eid, String(s)] as [Eid, Eid]] : []
  })

/**
 * The `precondition` hook: refuse a take of a held lock ({@link Bounced}) and
 * stamp `claimed_at` on every lock the batch newly takes.
 *
 * Registered by {@link https://jsr.io/@yaks/session/doc/~/sessions | sessions};
 * exported on its own for a graph that wants the rule without the vocabulary.
 */
export let leasing = (opts: LeaseOpts = {}): Hook => (bundles, tx) => {
  let taken = takes(bundles)
  if (!taken.length) return bundles
  let now = opts.now ?? (() => new Date().toISOString())
  let want = [...new Set(taken.map(([on]) => on))]
  return then(tx.get(want), (found) => {
    let at = new Map(found.map((b) => [b.entity.eid, b]))
    // The holder of each contested entity, as the batch FOUND it — then as the
    // batch itself leaves it, so two bundles taking one lock for two sessions
    // collide with each other and not only with the graph.
    let held = new Map<Eid, Eid>()
    for (let [on, b] of at) {
      let s = of(b, CLAIM)?.session
      if (s) held.set(on, String(s))
    }
    let fresh = new Set<Eid>()
    for (let [on, session] of taken) {
      let holder = held.get(on)
      if (holder && holder != session) throw new Bounced(on, session, holder)
      if (!holder) fresh.add(on)
      held.set(on, session)
    }
    if (!fresh.size) return bundles
    // A new lock is stamped with the moment it was taken. `claimed_at` is
    // server-owned, so admission already dropped whatever a client sent; this
    // phase runs after admission, which is what lets a hook stamp at all.
    let stamp = now()
    return bundles.map((b) => {
      let c = of(b, CLAIM)
      if (!c?.session || !fresh.has(b.entity.eid)) return b
      fresh.delete(b.entity.eid) // one stamp per lock, however it was stated
      return { ...b, [CLAIM]: { ...c, claimed_at: stamp } }
    })
  })
}
