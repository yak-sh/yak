// The write check, as a @yaks/graph hook.
//
// It runs at `precondition` — inside the transaction, before a single row has
// moved — for the same reason the `$was` guard does: a check that reads after
// the write is checking its own work. Throwing here rolls the whole transaction
// back, so a list of changes is admitted entirely or not at all, and there is
// no half-written state for the caller to reconcile.
//
// It asks two questions, in this order:
//
//   1. May this principal write this app at all? (`open` mode, or owner/editor)
//   2. Do the changes touch the ACCESS ROWS themselves? Then owner, and only
//      owner.
//
// The second is not a new level — it is the rule that an editor writes the
// app's data and does not hand out permissions. It matters most on an `open`
// app, where the first question admits everybody: without it, a visitor invited
// to sign the guest book could rewrite the roster and lock the owner out.
//
// The principal is whatever `$actor` the changes carry. An HTTP layer replaces
// that field with the identity it authenticated before calling `apply()`
// (@yaks/api `signed`). Changes with no `$actor` act as nobody — allowed on an
// `open` app, refused everywhere else — which is what an anonymous visitor
// should get.

import type { Ask, Bundle, Eid, Hook } from '@yaks/graph'
import { comps, then } from '@yaks/graph'
import { GOVERNED, GRANT, MEMBER } from './comp.ts'
import { levelOn, type Viewer, type Where, writesOn } from './policy.ts'
import { Denied } from './deny.ts'

/** Which app a guard decides for, and whose roster governs it. */
export type Guard = Where & {
  /** the app this graph holds — its `access` mode decides a write by a
   * principal that holds no level */
  app: Eid
}

/** The principal a signed transaction acts as: every bundle in it was signed by
 * the same HTTP layer, so the first one carrying an `$actor` settles it for all
 * of them. */
export let actorOf = (bundles: Bundle[]): Viewer => {
  for (let b of bundles) {
    let by = b.$actor?.by
    if (by) return by
  }
  return null
}

/** Do these changes touch the roster, a grant, or an app's mode? */
export let governs = (bundles: Bundle[]): boolean =>
  bundles.some((b) => comps(b).some(([name]) => GOVERNED.includes(name)))

/**
 * Everything the permission check is about to read, declared before it reads
 * any of it: the app (its mode decides for a principal with no level),
 * the principal's own entity (a share link's bearer IS a grant), and everything
 * filed about the principal — their membership rows, their grants. @yaks/graph
 * fetches all of it in one gather, so the four steps of the check cost no round
 * trip of their own.
 */
export let wanting = (where: Guard) => (bundles: Bundle[]): Ask[] => {
  if (!bundles.length) return []
  let who = actorOf(bundles)
  return who
    ? [
      { eids: [where.app, who] },
      { about: [who], comps: [GRANT, MEMBER] },
    ]
    : [{ eids: [where.app] }]
}

/**
 * The `precondition` hook: refuse changes this principal may not write.
 * Registered by {@link https://jsr.io/@yaks/member/doc/~/members | members};
 * exported on its own for a graph that wants the check without the vocabulary.
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
