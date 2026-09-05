// The four questions, and the order they are answered in.
//
// Everything here follows from one idea: BELONGING IS NOT ACCESS. A seat on
// the roster does not, on its own, let you touch anything. So the ladder runs
//
//   1. nobody at all              → no level; the app's mode is the whole answer
//   2. the space's owner          → owner on every app in it, never stored
//   3. a grant naming them        → the level it confers
//   4. a member with no grant     → no level; the app's mode again
//
// Steps 1 and 4 land in the same place, which is the point: a member without a
// grant reaches an app exactly as far as a stranger with the link does. That
// is what makes a roster safe to be generous with, and it is why eviction is
// one row — take the seat away and every implicit ownership goes with it.
//
// A SHARE LINK is the fourth way in. A grant may name a `token` instead of a
// person; whoever opens that link acts AS the grant, so the actor a door signs
// the batch with is the grant's own entity. `levelOn` therefore looks at the
// actor itself before it looks for a grant about the actor.
//
// The two rules themselves are `reads` and `edits` in words.ts — pure, over a
// mode and a level — and everything here is the ladder that finds the level to
// ask them about. Said once there, the door, `apply()` and a host that already
// knows both answers cannot drift apart:
//
//   read   the mode is not `private`, OR the asker holds any level
//   write  the mode is `open`, OR the asker holds owner or editor
//
// Every function threads @yaks/graph's sync pass-through: over a synchronous
// storage (a Map, an embedded database) not one of them returns a promise.

import type { Bundle, Comp, Eid, Storage, Tx } from '@yaks/graph'
import { detached, then } from '@yaks/graph'
import { and, eq, or } from '@yaks/query'
import { ACCESS, GRANT, MEMBER } from './comp.ts'
import { edits, type Level, level, type Mode, mode, reads } from './words.ts'

/** Who is asking: the entity a door signed the request with, or `null` for
 * nobody — an anonymous visitor with only the link. */
export type Viewer = Eid | null

/** Where the roster and the grants are read from, and which space's owners
 * count. */
export type Where = {
  /** the space whose owners own every app in it. Omit it and only grants
   * speak — a graph holding one app and no roster needs no space. */
  space?: Eid
}

/** The questions a door and a guard both ask. Each answers synchronously over
 * a synchronous storage. */
export type Policy = {
  /** the app's mode — `public` when it has never said */
  modeOf: (app: Eid) => Mode | Promise<Mode>
  /** what this viewer holds on this app, or `null` for nothing */
  levelOf: (who: Viewer, app: Eid) => Level | null | Promise<Level | null>
  /** may they read it? */
  canRead: (who: Viewer, app: Eid) => boolean | Promise<boolean>
  /** may they write it? */
  canWrite: (who: Viewer, app: Eid) => boolean | Promise<boolean>
}

// One component off a bundle, or undefined.
let of = (b: Bundle | undefined, name: string): Comp | undefined =>
  b?.[name] as Comp | undefined

/** The app's access mode, read through a transaction. */
export let modeOn = (tx: Tx, app: Eid): Mode | Promise<Mode> =>
  then(tx.get([app]), ([b]) => mode(of(b, ACCESS)?.mode))

/**
 * Everything filed ABOUT this person: their seat on a roster, their grants —
 * both are entities whose columns point at them, so the two rungs of the ladder
 * that used to be a read each are one backwards read (@yaks/graph `about`), and
 * none at all when a gather already took it (@yaks/graph `wants`, declared by
 * {@link https://jsr.io/@yaks/member/doc/~/members | members}).
 *
 * It reads a person's WHOLE file rather than the one row the rung is about, and
 * the rungs then pick out what they need. That is the trade the gather makes
 * everywhere: a person holds as many of these as they have seats and grants,
 * which is a handful, and a handful in one answer beats two round trips.
 */
let filed = (tx: Tx, who: Eid): Bundle[] | Promise<Bundle[]> =>
  tx.about ? tx.about([who], [GRANT, MEMBER]) : tx.read(
    and(or(eq(`${GRANT}.person`, who), eq(`${MEMBER}.person`, who))),
  )

/**
 * What `who` holds on `app`, read through a transaction: the ladder above, in
 * order. Returns `null` when they hold nothing — which is not a refusal, only
 * the answer that the app's mode has the last word.
 */
export let levelOn = (
  tx: Tx,
  who: Viewer,
  app: Eid,
  where: Where = {},
): Level | null | Promise<Level | null> => {
  if (!who) return null
  return then(tx.get([who]), ([self]) => {
    // A share link's bearer IS the grant they opened.
    let own = of(self, GRANT)
    if (own && own.app == app) return level(own.access)
    return then(filed(tx, who), (found) => {
      // The space's owner, before any grant. Never stored per app — a space
      // owner owns everything in it, and storing that would be a row to forget
      // to write.
      let owner = where.space && found.some((b) => {
        let m = of(b, MEMBER)
        return m?.space == where.space && m?.person == who && m?.role == 'owner'
      })
      if (owner) return 'owner' as Level
      let g = found.map((b) => of(b, GRANT))
        .find((c) => c?.app == app && c.person == who)
      return g ? level(g.access) : null
    })
  })
}

/** May they read it? The mode is not `private`, or they hold something. */
export let readsOn = (
  tx: Tx,
  who: Viewer,
  app: Eid,
  where: Where = {},
): boolean | Promise<boolean> =>
  then(
    modeOn(tx, app),
    // Nobody's answer first: a mode that admits nobody in particular admits
    // everybody, and the ladder is never climbed.
    (m) =>
      reads(m, null) || then(levelOn(tx, who, app, where), (l) => reads(m, l)),
  ) as boolean | Promise<boolean>

/** May they write it? The mode is `open`, or they hold owner or editor. */
export let writesOn = (
  tx: Tx,
  who: Viewer,
  app: Eid,
  where: Where = {},
): boolean | Promise<boolean> =>
  then(
    modeOn(tx, app),
    (m) =>
      edits(m, null) || then(levelOn(tx, who, app, where), (l) => edits(m, l)),
  ) as boolean | Promise<boolean>

/**
 * The read-side helper, bound to a storage: what a door consults before it
 * answers a query, since a read never reaches `apply()` and so is never seen
 * by the guard.
 *
 * ```ts
 * let may = policy(storage, { space: club })
 * // if (!may.canRead(who, app)) return new Response('', { status: 404 })
 * ```
 */
export let policy = (storage: Storage, where: Where = {}): Policy => {
  let tx = detached(storage)
  return {
    modeOf: (app) => modeOn(tx, app),
    levelOf: (who, app) => levelOn(tx, who, app, where),
    canRead: (who, app) => readsOn(tx, who, app, where),
    canWrite: (who, app) => writesOn(tx, who, app, where),
  }
}
