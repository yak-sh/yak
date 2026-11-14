// Merging a branch into main (D-404): what the branch changed since its fork,
// as its store reads it (@yaks/graph `Branches.changes`), written to main as
// one batch. Each property merges three ways, against its value at the fork:
//
//   only the branch changed it   main takes the branch's value
//   only main changed it         main keeps its own
//   both changed it, the same    nothing to write
//   both changed it, apart       a conflict: the fork's, the branch's and
//                                main's values side by side, and a person
//                                picks one
//
// Nothing merges by itself: while any conflict has no pick, nothing is
// written, and the merge answers the conflicts instead. A component one side
// removed counts as every property of it changed on that side, so a removal
// against the other side's edit is a conflict too, and so is an entity one
// side deleted and the other changed, since a deletion removes every
// component.
//
// Only what a client may write is merged: a stamped property is main's to
// stamp on the merge's own write, and a computed one is nobody's. A component
// stamped whole merges only where it is a mark, whose presence is its say. Each
// property written carries main's value as its `$was`, so a main that moved
// after the merge was read refuses it whole rather than losing that change.

import { groupBy } from '@yaks/fp'
import type { Actor, Bundle, Comp, Eid, Graph, Was } from '@yaks/graph'
import { signed } from '@yaks/graph/provenance'
import type { Change } from '@yaks/graph/storage'
import { TOMBSTONE } from '@yaks/graph/bundle'
import { token } from '@yaks/graph/sha256'
import type { Vocab } from '@yaks/vocab'
import { same } from '@yaks/fp'

/** A property both the branch and main changed since the fork, to different
 * values: each side's value, null where it holds none. */
export type Conflict = {
  eid: Eid
  comp: string
  prop: string
  fork: unknown
  branch: unknown
  main: unknown
}

/** Which side's value a conflict takes. */
export type Choice = {
  eid: Eid
  comp: string
  prop: string
  take: 'branch' | 'main'
}

/** A merge, worked out: the conflicts no pick settles, and the bundles that
 * write it to main, which are empty while any conflict stands. */
export type Merged = { conflicts: Conflict[]; bundles: Bundle[] }

let key = (eid: Eid, comp: string, prop: string) =>
  JSON.stringify([eid, comp, prop])

// Whether a component merges: not one the server stamps whole, as `created`
// and `updated` are, which main stamps on the merge's own write. A mark is
// stamped whole too, but its presence is what it says, so it merges.
let merges = (vocab: Vocab, comp: string): boolean => {
  let info = vocab.comp(comp)
  return !info || !!info.writable.length || info.mark ||
    !vocab.props(comp).length
}

// What a client may write of a component: its stamped and computed
// properties left out.
let writable = (vocab: Vocab, comp: string, c: Comp | null): Comp | null => {
  if (!c) return null
  let mine = new Set(vocab.comp(comp)?.writable ?? [])
  return Object.fromEntries(Object.entries(c).filter(([p]) => mine.has(p)))
}

// A value as a side holds it: absent and null are the same.
let held = (c: Comp | null, prop: string): unknown => c?.[prop] ?? null

// One entity's part of the merge, its components' changes given.
type Part = {
  bundle: Bundle
  conflicts: Conflict[]
  // whether a pick kept main's value against a branch's removal, which keeps
  // the entity the branch deleted
  kept: boolean
}

let part = (
  vocab: Vocab,
  eid: Eid,
  changes: Change[],
  picks: Map<string, Choice['take']>,
): Part => {
  let bundle: Bundle = { entity: { eid } }
  let conflicts: Conflict[] = []
  let was: Was = {}
  let kept = false
  for (let c of changes) {
    if (c.comp == TOMBSTONE || !merges(vocab, c.comp)) continue
    let fork = writable(vocab, c.comp, c.fork)
    let branch = writable(vocab, c.comp, c.branch)
    let main = writable(vocab, c.comp, c.main)
    if (same(branch, fork)) continue
    let cut = { branch: !branch && !!fork, main: !main && !!fork }
    let write: Comp = {}
    let guard: Record<string, string | null> = {}
    let keptHere = false
    let props = new Set(
      [fork, branch, main].flatMap((x) => Object.keys(x ?? {})),
    )
    for (let prop of props) {
      let f = held(fork, prop), b = held(branch, prop), m = held(main, prop)
      let byBranch = cut.branch || !same(b, f)
      let byMain = cut.main || !same(m, f)
      if (!byBranch || same(b, m)) continue
      let take = !byMain ? 'branch' : picks.get(key(eid, c.comp, prop))
      if (!take) {
        conflicts.push({ eid, comp: c.comp, prop, fork: f, branch: b, main: m })
      } else if (take == 'main') keptHere = true
      else {
        write[prop] = b
        guard[prop] = token(m)
      }
    }
    kept ||= keptHere && cut.branch
    if (!branch && !keptHere) {
      if (main) bundle[c.comp] = null
    } else if (Object.keys(write).length || !main && branch && !keptHere) {
      bundle[c.comp] = write
      if (main) was[c.comp] = guard
    }
  }
  let doomed = changes.find((c) => c.comp == TOMBSTONE)
  if (doomed?.branch && !doomed.main && !kept) {
    return { bundle: { entity: { eid }, $delete: true }, conflicts, kept }
  }
  if (Object.keys(was).length) bundle.$was = was
  return { bundle, conflicts, kept }
}

/**
 * A branch's changes merged onto main, three ways per property, with `picks`
 * settling conflicts: the conflicts left, and the bundles that write the merge
 * as one batch once none is.
 */
export let merged = (
  vocab: Vocab,
  changes: Change[],
  picks: Choice[] = [],
): Merged => {
  let taken = new Map(picks.map((p) => [key(p.eid, p.comp, p.prop), p.take]))
  let byEntity = groupBy(changes, (c) => c.eid)
  let parts = [...byEntity].map(([eid, cs]) => part(vocab, eid, cs, taken))
  let conflicts = parts.flatMap((p) => p.conflicts)
  let bundles = conflicts.length ? [] : parts.map((p) => p.bundle)
    .filter((b) => b.$delete || Object.keys(b).length > 1)
  return { conflicts, bundles }
}

/**
 * Merge a branch into main: `merge(g)(id, picks, actor)` reads branch `id`'s
 * changes, merges them with `picks`, and, where no conflict is left, writes
 * them to main through `g` as one batch, as `actor`. Answers what was worked
 * out; its bundles are what was written, none while a conflict stands. The
 * branch itself is left as it is.
 */
export let merge =
  (g: Graph) =>
  async (id: number, picks: Choice[] = [], actor?: Actor): Promise<Merged> => {
    if (!g.branches) throw new Error('this graph keeps no branches')
    let m = merged(g.vocab, await g.branches.changes(id), picks)
    if (m.bundles.length) {
      await g.apply(actor ? signed(m.bundles, actor) : m.bundles)
    }
    return m
  }
