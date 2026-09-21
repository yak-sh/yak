// The four questions, and the order they are answered in.
//
// Everything here follows from one idea: MEMBERSHIP IS NOT PERMISSION. A row on
// the roster does not, on its own, let you touch anything. So permission
// resolves in this order:
//
//   1. nobody at all           → no level; the app's mode is the whole answer
//   2. the space's owner       → owner on every app in it, never stored
//   3. a grant naming them     → the level it confers
//   4. a member with no grant  → no level; the app's mode again
//
// Steps 1 and 4 land in the same place, which is the point: a member without a
// grant reaches an app exactly as far as a stranger with the link does. That is
// what makes a roster safe to be generous with, and it is why removing someone
// is one row — delete the membership and every permission implied by it goes
// too.
//
// A SHARE LINK is the fourth way in. A grant may name a `token` instead of a
// person; whoever opens that link acts AS the grant, so the HTTP layer signs
// the changes with the grant's own entity id. `levelOn` therefore checks the
// principal's own entity for a `grant` component before it looks for grants
// filed about the principal.
//
// The two rules themselves are `reads` and `edits` in words.ts — pure functions
// of a mode and a level — and everything here resolves the level to call them
// with. Stated once there, the read check at the HTTP layer, the write check in
// `apply()`, and a service that already knows both values cannot drift apart:
//
//   read   the mode is not `private`, OR the principal holds any level
//   write  the mode is `open`, OR the principal holds owner or editor
//
// Every function here threads @yaks/graph's synchronous pass-through: over a
// synchronous storage (a Map, an embedded database) none of them returns a
// promise.

import type { Bundle, Comp, Eid, Storage, Tx } from '@yaks/graph'
import { detached, then } from '@yaks/graph'
import { and, eq, or } from '@yaks/query'
import { ACCESS, GRANT, MEMBER } from './comp.ts'
import { edits, type Level, level, type Mode, mode, reads } from './words.ts'

/** Who is acting: the entity the HTTP layer signed the request with, or `null`
 * for nobody — an anonymous visitor with only the link. */
export type Viewer = Eid | null

/** Where the roster and the grants are read from, and which space's owners
 * count. */
export type Where = {
  /** the space whose owners own every app in it. Omit it and only grants
   * count — a graph holding one app and no roster needs no space. */
  space?: Eid
}

/** The checks the HTTP layer and the write guard both call. Each returns a
 * value rather than a promise over a synchronous storage. */
export type Policy = {
  /** the app's mode — `public` when it has no `access` component */
  modeOf: (app: Eid) => Mode | Promise<Mode>
  /** what this principal holds on this app, or `null` for nothing */
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
 * Everything filed ABOUT this principal: their membership rows, their grants.
 * Both are entities with a column pointing at the principal, so the two steps
 * that would each have been a read are one backwards read (@yaks/graph
 * `about`), and none at all when the gather already fetched them (@yaks/graph
 * `wants`, declared by
 * {@link https://jsr.io/@yaks/member/doc/~/members | members}).
 *
 * It reads a principal's whole file rather than the one row a given step needs,
 * and the steps then pick out what they want. That is the trade the gather
 * makes everywhere: a principal has as many of these rows as they have
 * memberships and grants, which is a handful, and a handful in one response
 * beats two round trips.
 */
let filed = (tx: Tx, who: Eid): Bundle[] | Promise<Bundle[]> =>
  tx.about ? tx.about([who], [GRANT, MEMBER]) : tx.read(
    and(or(eq(`${GRANT}.person`, who), eq(`${MEMBER}.person`, who))),
  )

/**
 * What `who` holds on `app`, read through a transaction, following the
 * resolution order above step by step. Returns `null` when they hold nothing —
 * which is not a refusal, only the answer that the app's mode decides.
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
    // Check the anonymous case first: a mode that admits nobody in particular
    // admits everybody, and the permission lookup never runs.
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
 * The read-side helper, bound to a storage: what the HTTP layer calls before it
 * answers a query, since a read never reaches `apply()` and so is never seen by
 * the write guard.
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
