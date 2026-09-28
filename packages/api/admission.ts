// One socket's peer relay allowance. The vocabulary sets a component's pace;
// a small transport ceiling also bounds components with no declared pace.

import type { Bundle } from '@yaks/graph'

type Bucket = { at: number; left: number }
export type Verdict = 'accept' | 'skip' | 'close'

let BURST = 2
let CEILING = 16 // at most about sixty unpaced messages a second
let MAX_PATCHES = 64
let STRIKES = 8

/** Admit a whole relay message or none of it. A rejected patch never replaces
 * the last value the relay accepted. A sustained sender loses its socket. */
export let admission = (
  pace: (comp: string) => number | null,
  now: () => number = () => Date.now(),
): (bundles: Bundle[]) => Verdict => {
  let buckets = new Map<string, Bucket>()
  let bad = 0
  let since = 0

  let refuse = (at: number): Verdict => {
    if (at - since >= 1000) bad = 0, since = at
    return ++bad >= STRIKES ? 'close' : 'skip'
  }

  return (bundles) => {
    let at = now()
    if (bundles.length > MAX_PATCHES) return 'close'
    let counts = new Map<string, number>([['', 1]])
    let patches = 0
    for (let b of bundles) {
      // Let the relay's normal admission report malformed bundles.
      if (!b || typeof b != 'object') continue
      for (let [comp, patch] of Object.entries(b)) {
        if (comp == 'entity' || comp.startsWith('$')) continue
        if (++patches > MAX_PATCHES) return 'close'
        if (patch == null || pace(comp) == null) continue
        counts.set(comp, (counts.get(comp) ?? 0) + 1)
      }
    }
    let next = new Map<string, Bucket>()
    for (let [comp, cost] of counts) {
      let span = comp ? pace(comp)! : CEILING
      let was = buckets.get(comp) ?? { at, left: BURST }
      let left = Math.min(BURST, was.left + Math.max(0, at - was.at) / span)
      if (left < cost) return refuse(at)
      next.set(comp, { at, left: left - cost })
    }
    for (let [comp, bucket] of next) buckets.set(comp, bucket)
    return 'accept'
  }
}
