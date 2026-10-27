/** Compare independent observations by their ranks. A round sharing its host
 * conditions with other rounds is one observation, not several votes. */
import { type Direction, median, value } from './result.ts'

export type Difference = {
  verdict: 'slower' | 'unconfirmed' | 'inconclusive'
  probability: number | null
  reference: number | null
  current: number | null
}

/** Exact one-sided permutation probability, including ties. The caller bounds
 * the observation window; no normal approximation turns a small sample into
 * evidence. */
export let difference = (
  reference: readonly number[],
  current: readonly number[],
  better: Direction = 'lower',
  significance = .05,
): Difference => {
  let out: Difference = {
    verdict: 'inconclusive',
    probability: null,
    reference: reference.length ? median(reference) : null,
    current: current.length ? median(current) : null,
  }
  if (reference.length < 3 || current.length < 3) return out
  let all = [...reference, ...current].map(value)
  let ranks = all.map((x) =>
    all.filter((y) => y < x).length * 2 +
    all.filter((y) => y == x).length + 1
  )
  let observed = ranks.slice(reference.length).reduce((a, b) => a + b, 0)
  let counts = Array.from(
    { length: current.length + 1 },
    () => new Map<number, number>(),
  )
  counts[0].set(0, 1)
  for (let rank of ranks) {
    for (let n = current.length; n > 0; n--) {
      for (let [sum, count] of counts[n - 1]) {
        counts[n].set(sum + rank, (counts[n].get(sum + rank) ?? 0) + count)
      }
    }
  }
  let total = 0, tail = 0
  for (let [sum, count] of counts[current.length]) {
    total += count
    if (better == 'lower' ? sum >= observed : sum <= observed) tail += count
  }
  out.probability = tail / total
  out.verdict = out.probability <= significance &&
      (better == 'lower'
        ? out.current! > out.reference!
        : out.current! < out.reference!)
    ? 'slower'
    : 'unconfirmed'
  return out
}
