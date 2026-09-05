// The write half of the policy, as a hook.
//
// It runs at `precondition` — inside the transaction, before a single row has
// moved — for the same reason the `$was` guard does: a check that reads after
// the batch wrote is checking the batch's own work. Throwing here rolls the
// whole batch back, so a batch is admitted entirely or not at all; there is no
// half-written write for the caller to reconcile.
//
// It asks two questions, in this order:
//
//   1. May this actor write this app at all? (`open` mode, or owner/editor)
//   2. Does the batch touch the MEMBERSHIP itself? Then owner, and only owner.
//
// The second is not a new tier — it is the same rule the platform already
// keeps, that an editor writes the data and does not hand out keys. It matters
// most on an `open` app, where the first question admits everybody: without it,
// a visitor invited to sign the guestbook could rewrite the roster and lock
// the owner out of their own club.
//
// The actor is whatever `$actor` the batch carries, which a door has already
// replaced with the identity it authenticated (@yaks/api `signed`). A batch
// with no actor is nobody — permitted on an `open` app, refused everywhere
// else — which is exactly what an anonymous visitor is.

import type { Bundle, Eid, Hook } from '@yaks/graph'
import { comps, then } from '@yaks/graph'
import { GOVERNED } from './comp.ts'
import { levelOn, type Viewer, type Where, writesOn } from './policy.ts'
import { Denied } from './deny.ts'

/** Which app a guard speaks for, and whose roster governs it. */
export type Guard = Where & {
  /** the app this graph holds — its `access` mode is the last word on a write
   * by someone with no level */
  app: Eid
}

/** The actor a signed batch carries: every bundle in it was signed by the same
 * door, so the first one that says anything speaks for the batch. */
export let actorOf = (bundles: Bundle[]): Viewer => {
  for (let b of bundles) {
    let by = b.$actor?.by
    if (by) return by
  }
  return null
}

/** Does this batch touch the roster, a grant, or an app's mode? */
export let governs = (bundles: Bundle[]): boolean =>
  bundles.some((b) => comps(b).some(([name]) => GOVERNED.includes(name)))

/**
 * The `precondition` hook: refuse a batch this actor may not write. Registered
 * by {@link https://jsr.io/@yaks/member/doc/~/members | members}; exported on
 * its own for a graph that wants the check without the vocabulary.
 */
export let guarding = (where: Guard): Hook => (bundles, tx) => {
  if (!bundles.length) return bundles
  let who = actorOf(bundles)
  return then(writesOn(tx, who, where.app, where), (may) => {
    if (!may) throw new Denied(who, where.app, 'editor')
    if (!governs(bundles)) return bundles
    return then(levelOn(tx, who, where.app, where), (level) => {
      if (level != 'owner') throw new Denied(who, where.app, 'owner')
      return bundles
    })
  }) as Bundle[] | Promise<Bundle[]>
}
