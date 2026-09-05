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
// The read rules are the write rules' mirror and they are stated once, here,
// so the door and `apply()` cannot drift apart:
//
//   read   the mode is not `private`, OR the asker holds any level
//   write  the mode is `open`, OR the asker holds owner or editor
//
// Every function threads @yaks/graph's sync pass-through: over a synchronous
// storage (a Map, an embedded database) not one of them returns a promise.

import type { Bundle, Comp, Eid, Storage, Tx } from '@yaks/graph'
import { detached, then } from '@yaks/graph'
import { ACCESS, GRANT, MEMBER } from './comp.ts'
import { type Level, level, type Mode, mode, writes } from './words.ts'

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
    return then(owns(tx, who, where.space), (owner) => {
      if (owner) return 'owner' as Level
      return then(
        tx.read(`.${GRANT}.app=${app}&.${GRANT}.person=${who}`),
        (found) => {
          let g = of(found[0], GRANT)
          return g ? level(g.access) : null
        },
      )
    })
  })
}

// Is this person the space's owner? Never stored per app — a space owner owns
// everything in it, and storing that would be a row to forget to write.
let owns = (
  tx: Tx,
  who: Eid,
  space?: Eid,
): boolean | Promise<boolean> => {
  if (!space) return false
  return then(
    tx.read(`.${MEMBER}.space=${space}&.${MEMBER}.person=${who}`),
    (rows) => rows.some((b) => of(b, MEMBER)?.role == 'owner'),
  )
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
    (m) =>
      m != 'private' || then(levelOn(tx, who, app, where), (l) => l != null),
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
    (m) => m == 'open' || then(levelOn(tx, who, app, where), writes),
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
