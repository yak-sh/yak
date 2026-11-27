// Which directory writes raise the serving fence (directory-copy.ts in
// workers/yak). A write commits only once the serving copy has fenced its
// copied answers, unless nothing it writes is read by an authorization a
// copied answer gives. Each word says which it is where it is declared, with
// the `fence` keyword; a word that says nothing fences, so a new word is
// always safe and at worst costs its writes a fence.
//
// - `none`: no authorization reads it: a use receipt, a listing's order or
//   test mark, an archetype descriptor.
// - `own`: a row only the directory's own work reads, such as an effect's
//   run or a sign-in code. Neither it nor the stamps on its entity fence.
// - `hold`: what a hold on a space's budget commits. The directory's own
//   transaction refuses a spend past the budget, so no refusal reads a copied
//   balance: a copy that has not heard of it shows a slightly older one.

import type { Bundle } from '@yaks/graph'
import { comps, dead } from '@yaks/graph/bundle'
import { PROVENANCE } from '@yaks/graph/provenance'
import type { Keywords, Vocab } from '@yaks/vocab'

/** The URI a vocabulary file declares under `$vocabulary` to use `fence`. */
export let FENCE_URI = 'https://yak.sh/vocab/fence'

/** The `fence` keyword, ready to register with `loadVocab`. */
export let fenceKeywords: Keywords = {
  uri: FENCE_URI,
  comp: ['fence'],
  doc: {
    $defs: {
      fence: {
        description:
          'How a directory write of this component is fenced against the serving copy: "none" when no authorization reads it, "own" for a row only the directory\'s own work reads (its stamps raise none either), "hold" for what a hold on a space\'s budget commits. Left out, it fences.',
        enum: ['none', 'own', 'hold'],
      },
    },
  },
}

/** How a vocabulary's words fence a directory write. */
export type Fences = {
  /** Whether a write of `bundles` raises no fence; in a budget hold, with
   * `held`. A delete always fences: see `unheld`. */
  unfenced(bundles: Bundle[], held?: boolean): boolean
  /** Whether entities as they stand hold nothing an authorization reads, so
   * deleting them raises no fence. */
  unheld(rows: Bundle[]): boolean
  /** Whether a write is a hold on a space's budget: a held spend, written
   * with nothing a hold does not commit. */
  hold(bundles: Bundle[]): boolean
}

let STAMPS = new Set(PROVENANCE)

/**
 * The fences `vocab`'s words declare.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { loadVocab } from '@yaks/vocab'
 * import { fenceKeywords, fences } from '@yaks/platform/fence'
 * let f = fences(loadVocab([{
 *   $defs: {
 *     used: { component: true, fence: 'none' },
 *     effect: { component: true, fence: 'own' },
 *     spend: { component: true, fence: 'hold' },
 *     member: { component: true },
 *   },
 * }], [fenceKeywords]))
 * let row = (eid: string, rest: object) => ({ entity: { eid }, ...rest })
 * equal([
 *   f.unfenced([row('a', { used: {} })]),
 *   f.unfenced([row('a', { member: {} })]),
 *   f.unfenced([row('r', { effect: {}, updated: {} })]),
 *   f.unfenced([row('a', { used: {}, updated: {} })]),
 *   f.unfenced([row('s', { spend: { held: true } })]),
 *   f.unfenced([row('s', { spend: { held: true } })], true),
 *   f.hold([row('s', { spend: { held: true } })]),
 *   f.hold([row('s', { spend: {} })]),
 *   f.unheld([row('r', { effect: {}, created: {} })]),
 * ], [true, false, true, false, false, true, true, false, true])
 * ```
 */
export let fences = (vocab: Vocab): Fences => {
  let classOf = (name: string) => vocab.comp(name)?.keywords.fence
  let free = (name: string, held = false) => {
    let c = classOf(name)
    return c == 'none' || c == 'own' || held && c == 'hold'
  }
  let unfenced = (bundles: Bundle[], held = false) => {
    let own = new Set(
      bundles.filter((b) => comps(b).some(([n]) => classOf(n) == 'own'))
        .map((b) => b.entity.eid),
    )
    return bundles.every((b) =>
      !dead(b) &&
      comps(b).every(([name]) =>
        free(name, held) ||
        STAMPS.has(name) && (held || own.has(b.entity.eid))
      )
    )
  }
  return {
    unfenced,
    unheld: (rows) =>
      rows.every((b) =>
        comps(b).every(([name]) => free(name) || STAMPS.has(name))
      ),
    hold: (bundles) =>
      bundles.some((b) => (b.spend as { held?: unknown } | undefined)?.held) &&
      bundles.every((b) =>
        !b.spend || (b.spend as { held?: unknown }).held === true
      ) &&
      unfenced(bundles, true),
  }
}
