// Which revision of its store each held row came from, and which each
// subscription's last frame said: how a copy tells it is about to be handed
// an older row than it holds, or that a frame went missing.
//
// A store's frames each say the revision their rows were read at, and the one
// their subscription's frame before said (@yaks/api `Frame`). One socket's
// frames land in order, but a door over several stores (@yaks/reach) hears
// each store on its own socket, so a frame about a row can arrive after a
// newer one about it from another subscription. Such a frame, or one whose
// subscription said a revision this copy never heard, does not land: that
// subscription is asked again, whole, and the frames still on their way from
// before the asking are let go until its first answer arrives.
//
// A revision is one number, or, from a door, a number per store; two are
// compared on the stores both name, since a revision orders one store's
// frames and no other's.
import type { Eid } from '@yaks/graph'

/** A store's revision: one number, or each store's under its name. */
export type Revision = number | Record<string, number>

/** What a frame says of its revision, as {@link revisions} reads it. */
export type Stamped = {
  id: string
  revision?: Revision
  since?: Revision
  bundles?: { entity: { eid: Eid } }[]
  peers?: { entity: { eid: Eid } }[]
  gone?: Eid[]
  peerGone?: Eid[]
}

/** Why a frame does not land: `skipped`, its subscription's frame before it
 * never arrived; `stale`, a row in it is older than the one held; `asked`,
 * it was on its way before its subscription was asked again. */
export type Verdict = 'skipped' | 'stale' | 'asked'

/** How many rows' revisions are kept, the least recently landed let go
 * first: more than a client keeps rows (@yaks/client `RETENTION_ROWS`), so a
 * row's revision outlives the row in memory. */
export const REVISIONS = 50_000

type Keyed = Record<string, number>

let keyed = (r: Revision): Keyed => typeof r == 'number' ? { '': r } : r

/** Whether `a` is older than `b` on a store both name.
 *
 * ```ts
 * import { older } from '@yaks/sync'
 * import { equal } from '@yaks/testing'
 *
 * equal(older(4, 5), true)
 * equal(older({ books: 9, loans: 1 }, { loans: 2 }), true)
 * equal(older({ books: 1 }, { loans: 2 }), false)
 * ```
 */
export let older = (a: Revision, b: Revision): boolean => {
  let x = keyed(a), y = keyed(b)
  return Object.entries(x).some(([at, n]) => at in y && n < y[at])
}

let same = (a: Revision, b: Revision): boolean => {
  let x = keyed(a), y = keyed(b)
  let names = Object.keys(x)
  return names.length == Object.keys(y).length &&
    names.every((at) => x[at] === y[at])
}

let newest = (a: Keyed | undefined, b: Keyed): Keyed => {
  let out = { ...a }
  for (let [at, n] of Object.entries(b)) out[at] = Math.max(out[at] ?? n, n)
  return out
}

let touched = (f: Stamped): Eid[] => [
  ...(f.bundles ?? []).map((b) => b.entity.eid),
  ...(f.peers ?? []).map((b) => b.entity.eid),
  ...f.gone ?? [],
  ...f.peerGone ?? [],
]

/** The revisions a copy holds, of rows and of subscriptions. */
export type Revisions = {
  /** why this frame must not land, or nothing when it may */
  check: (frame: Stamped) => Verdict | undefined
  /** this frame landed: its rows and its subscription are at its revision */
  landed: (frame: Stamped) => void
  /** this subscription was asked, again or for the first time */
  asked: (id: string) => void
  /** this subscription is closed */
  closed: (id: string) => void
}

/**
 * A copy's revisions. A frame without a revision, from a store that says
 * none, is never held back.
 *
 * ```ts
 * import { revisions } from '@yaks/sync'
 * import { equal } from '@yaks/testing'
 *
 * let held = revisions()
 * let row = { entity: { eid: 'dal' } }
 * held.asked('a')
 * held.landed({ id: 'a', revision: 5, bundles: [row] })
 * equal(held.check({ id: 'b', revision: 4, bundles: [row] }), 'stale')
 * equal(held.check({ id: 'a', revision: 7, since: 6 }), 'skipped')
 * equal(held.check({ id: 'a', revision: 6, since: 5 }), undefined)
 * ```
 */
export let revisions = (limit = REVISIONS): Revisions => {
  let rows = new Map<Eid, Keyed>()
  // A subscription's last revision, or `asked` until its first answer.
  let chains = new Map<string, Keyed | 'asked'>()
  return {
    check: (f) => {
      if (f.revision === undefined) return
      let chain = chains.get(f.id)
      if (f.since !== undefined) {
        if (chain == 'asked') return 'asked'
        if (!chain || !same(f.since, chain)) return 'skipped'
      }
      let rev = f.revision
      return touched(f).some((eid) => {
          let held = rows.get(eid)
          return held && older(rev, held)
        })
        ? 'stale'
        : undefined
    },
    landed: (f) => {
      if (f.revision === undefined) return
      let rev = keyed(f.revision)
      chains.set(f.id, rev)
      for (let eid of touched(f)) {
        let was = rows.get(eid)
        rows.delete(eid)
        rows.set(eid, newest(was, rev))
      }
      while (rows.size > limit) rows.delete(rows.keys().next().value!)
    },
    asked: (id) => void chains.set(id, 'asked'),
    closed: (id) => void chains.delete(id),
  }
}
