// The write check, as a @yaks/graph hook.
//
// It runs at `precondition` — inside the transaction, before a single row has
// moved — for the same reason the `$was` guard does: a check that reads after
// the write is checking its own work. Throwing here rolls the whole transaction
// back, so a list of changes is admitted entirely or not at all, and there is
// no half-written state for the caller to reconcile.
//
// It asks four questions, in this order:
//
//   1. May this principal write this app at all? (`open` mode, or owner/editor)
//   2. Do the changes touch a component that asks a floor of its own? The
//      access rows ask owner, always; the vocabulary declares the rest
//      (`floor`, keywords.ts), and so may the program installing the guard
//      (`floors`).
//   3. Is the principal in only because the app is `open`? Then it adds rows,
//      and changes only the rows it wrote.
//   4. Does a change write a component sooner than its `pace` lets this writer
//      (pace.ts)?
//
// None of them is a new level. They are the rules that an editor writes the
// app's data and does not hand out permissions, that a shop's prices are its
// editors' however open its guest book is, that a chat takes lines only from
// people signed in, that a visitor signs the guest book without erasing it, and
// that nobody fills it faster than the rest can read. They matter most on an
// `open` app, where the first question admits everybody: without them, a
// visitor invited to sign could rewrite the roster and lock the owner out, set
// the price of everything to a cent, delete every entry but their own, or push
// everyone else's out of sight.
//
// A row is the principal's own when its `created.by` names them, or when it is
// them. An anonymous principal owns nothing, so it only adds. A change that
// changes nothing — every property it names already holds that value — is
// nobody's business, which is what lets the same bytes be uploaded twice.
//
// The principal is whatever `$actor` the changes carry. An HTTP layer replaces
// that field with the identity it authenticated before calling `apply()`
// (@yaks/api `signed`). Changes with no `$actor` act as nobody — allowed on an
// `open` app, refused everywhere else — which is what an anonymous visitor
// should get.

import type { Ask, Bundle, Comp, Eid, Hook, Tx } from '@yaks/graph'
import { after } from '@yaks/fp'
import { comps, dead } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { GOVERNED, GRANT, MEMBER } from './comp.ts'
import { levelOn, modeOn, type Viewer, type Where } from './policy.ts'
import { Denied } from './deny.ts'
import { floorsIn } from './keywords.ts'
import { pacesIn, pacing } from './pace.ts'
import { edits, type Floors, type Level, stands, writes } from './words.ts'

/** Which app a guard decides for, and whose roster governs it. */
export type Guard = Where & {
  /** the app this graph holds — its `access` mode decides a write by a
   * principal that holds no level */
  app: Eid
  /** the vocabulary the graph was loaded with, whose components' declared
   * `floor` (registered with `memberKeywords`) and `pace` hold here */
  vocab: Vocab
  /** components that ask a floor of their own besides the ones the vocabulary
   * declares — `{ product: 'editor' }` keeps a shop's prices its editors' on
   * an `open` app, and wins over a declared one. The access rows ask `owner`
   * whatever either says. */
  floors?: Floors
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

let OWNED: Floors = Object.fromEntries(GOVERNED.map((c) => [c, 'owner']))

// Every floor a guard holds: the vocabulary's, the program's over them, and
// the access rows' over both.
let held = (where: Guard): Floors => ({
  ...floorsIn(where.vocab),
  ...where.floors,
  ...OWNED,
})

// The first component these changes touch whose floor this principal, holding
// this level, does not stand on.
let short = (
  floors: Floors,
  who: Viewer,
  level: Level | null,
  bundles: Bundle[],
): string | undefined => {
  for (let b of bundles) {
    for (let [name] of comps(b)) {
      let f = floors[name]
      if (f && !stands(who, level, f)) return name
    }
  }
}

// Theirs: they wrote it, or it is them.
let mine = (row: Bundle, who: Viewer) =>
  !!who &&
  (row.entity.eid == who || (row.created as Comp | undefined)?.by == who)

// Nothing this bundle says differs from the row it names.
let idle = (b: Bundle, row: Bundle) =>
  !dead(b) && comps(b).every(([name, comp]) => {
    let held = row[name] as Comp | null | undefined
    if (!comp) return held == null
    return !!held && Object.entries(comp).every(([prop, v]) => held[prop] == v)
  })

// A principal the mode admits and no level does: new rows, and its own.
let adding = (tx: Tx, who: Viewer, app: Eid, bundles: Bundle[]) =>
  after(tx.get([...new Set(bundles.map((b) => b.entity.eid))]), (rows) => {
    let held = new Map(rows.map((r) => [r.entity.eid, r]))
    for (let b of bundles) {
      let row = held.get(b.entity.eid)
      if (row && !mine(row, who) && !idle(b, row)) {
        throw new Denied(who, app, 'editor')
      }
    }
    return bundles
  })

/**
 * Everything the permission check is about to read, declared before it reads
 * any of it: the app (its mode decides for a principal with no level), the
 * principal's own entity (a share link's bearer is a grant), everything filed
 * about the principal — their membership rows, their grants — and the rows the
 * changes name, whose byline says whose they are. @yaks/graph fetches all of it
 * in one gather, so the steps of the check cost no round trip of their own.
 */
export let wanting = (where: Guard) => (bundles: Bundle[]): Ask[] => {
  if (!bundles.length) return []
  let who = actorOf(bundles)
  let eids = [where.app, ...bundles.map((b) => b.entity.eid)]
  return who
    ? [{ eids: [...eids, who] }, { about: [who], comps: [GRANT, MEMBER] }]
    : [{ eids }]
}

/**
 * The `precondition` hook: refuse changes this principal may not write.
 * Registered by {@link https://jsr.io/@yaks/member/doc/~/members | members};
 * exported on its own for a graph that wants the check without this package's
 * components.
 */
export let guarding = (where: Guard): Hook => {
  let floors = held(where)
  let paces = pacesIn(where.vocab)
  return (bundles, tx) => {
    if (!bundles.length) return bundles
    let who = actorOf(bundles)
    return after(
      modeOn(tx, where.app),
      (m) =>
        after(levelOn(tx, who, where.app, where), (level) => {
          if (!edits(m, level)) throw new Denied(who, where.app, 'editor')
          let comp = short(floors, who, level, bundles)
          if (comp) {
            throw new Denied(who, where.app, floors[comp], 'write', comp)
          }
          return after(
            writes(level) ? bundles : adding(tx, who, where.app, bundles),
            (b) => pacing(paces, tx, who, b),
          )
        }),
    ) as Bundle[] | Promise<Bundle[]>
  }
}
