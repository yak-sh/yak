// Where a subscription and a local scan may disagree, the pure seam behind
// live.ts's agreement check: which queries are expected to differ (`gaps`) and
// what differs (`diff`). subs_test.ts drives it with plain values.
import { propAt } from './props.ts'
import { leafOf, type Pred } from './query.ts'
import { timeSpan } from '@yaks/query'

// Agreement is hard for moving time: membership can change with no write.
// Path membership is maintained from far-side reference invalidation.
// A WINDOW is a gap by design rather than by difficulty: the sub answers a
// bounded prefix and says so, while a local query door resolves the whole
// match — so the two are EXPECTED to differ once the answer outgrows the
// bound, and the difference is the feature, not a divergence to assert on.
export type Gap = 'moving-time' | 'window'

let atoms = (value: string) =>
  value.split(',').flatMap((v) => {
    let m = v.match(/^(.*?)\.\.(?:\.?)(.*)$/s)
    return m ? [m[1], m[2]] : [v]
  }).filter(Boolean)

let fixed = (value: string) => /^\d{4}-\d{2}-\d{2}(?:[t ].*)?$/i.test(value)

let moving = (p: Pred): boolean => {
  // A reverse hop moves when its SUB-filter has a moving-time leaf: a parent
  // ages out of `.comments.created.at=today` with nobody writing to it.
  if (p.rev) return p.rev.preds.some(moving)
  let target = leafOf(p)
  if (propAt(target.comp, target.prop)?.type != 'time') return false
  return atoms(p.value).some((v) => !fixed(v) && !!timeSpan(v))
}

export let gaps = (preds: Pred[]): Gap[] => [
  ...preds.some(moving) ? ['moving-time' as Gap] : [],
  ...preds.some((p) => p.win) ? ['window' as Gap] : [],
]

export type Diff = { scanOnly: string[]; subOnly: string[] }
export let diff = (scan: Iterable<string>, sub: Iterable<string>): Diff => {
  let a = new Set(scan), b = new Set(sub)
  return {
    scanOnly: [...a].filter((eid) => !b.has(eid)).sort(),
    subOnly: [...b].filter((eid) => !a.has(eid)).sort(),
  }
}
