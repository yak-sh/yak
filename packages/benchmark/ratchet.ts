/** The pure ratchet compares compatible suite measurements. A baseline is a
 * value with its own tolerance; accepting it is an explicit runner operation.
 * A baseline only moves toward better: banking worse numbers is a separate,
 * explicit choice (`slower`), never what an ordinary acceptance does. */
import {
  type Baseline,
  type Direction,
  type Regression,
  type Run,
  sameNames,
  value,
  workload,
} from './result.ts'

export let tolerance = (n: number): number => {
  if (!Number.isFinite(n) || n < 0 || n >= 1) {
    throw new Error('Tolerance must be in [0, 1)')
  }
  return n
}

/** A bench's slack is this many times the spread its banking runs showed. */
export let NOISE = 2
/** The most slack noise can earn a bench; a tolerance stays under one. */
export let CAP = .95

/** How far apart repeated medians of one bench fall, as a fraction of the
 * best of them: the noise a later check has to allow.
 *
 * ```ts
 * import { spread } from '@yaks/benchmark'
 * import { equal } from '@yaks/testing'
 *
 * equal(spread([100, 104, 110], 'lower'), .1)
 * equal(spread([80, 100], 'higher'), .2)
 * equal(spread([5], 'lower'), 0)
 * ```
 */
export let spread = (medians: readonly number[], better: Direction): number => {
  let low = Math.min(...medians.map(value)), high = Math.max(...medians)
  let best = better == 'lower' ? low : high
  return best == 0 ? 0 : (high - low) / best
}

/** Repeated runs of one suite as one run: each bench as the run that measured
 * it best, the median acceptance banks, so a check compares like for like.
 *
 * ```ts
 * import { best, type Run } from '@yaks/benchmark'
 * import { equal } from '@yaks/testing'
 *
 * let run = (write: number, rate: number) => ({
 *   benches: [
 *     { name: 'write', better: 'lower', median: write },
 *     { name: 'rate', better: 'higher', median: rate },
 *   ],
 * }) as Run
 * equal(best([run(12, 40), run(10, 30)]).benches.map((b) => b.median), [10, 40])
 * ```
 */
export let best = (runs: readonly Run[]): Run => {
  let last = runs.at(-1)
  if (!last) throw new Error('Expected at least one run')
  return {
    ...last,
    benches: last.benches.map((b) =>
      runs.map((r) => r.benches.find((c) => c.name == b.name)!).reduce((
        a,
        c,
      ) =>
        (b.better == 'lower' ? c.median < a.median : c.median > a.median)
          ? c
          : a
      )
    ),
  }
}

export let validate = (base: Baseline): void => {
  if (
    base.version !== 1 ||
    [base.suite, base.metric, base.runtime, base.cpu].some((s) =>
      typeof s != 'string' || !s
    ) ||
    !['number', 'string'].includes(typeof base.workload)
  ) {
    throw new Error('Invalid baseline metadata')
  }
  workload(base.workload)
  tolerance(base.tolerance)
  sameNames(base.benches, base.benches)
  for (let b of base.benches) {
    value(b.median)
    if (b.tolerance !== undefined) tolerance(b.tolerance)
    if (!['lower', 'higher'].includes(b.better)) {
      throw new Error(`Missing direction: ${b.name}`)
    }
  }
}

let KEYS = ['version', 'suite', 'metric', 'workload', 'runtime', 'cpu'] as const
type Key = typeof KEYS[number]
/** The first piece of metadata that keeps a run from comparing with a
 * baseline, or undefined when the two compare. */
export let incomparable = (
  base: Pick<Baseline, Key>,
  current: Pick<Run, Key>,
): Key | undefined => KEYS.find((key) => base[key] !== current[key])

/** Bank one run, or several repeated runs of one suite, as a baseline. Each
 * bench banks its best median. Repeated runs also bank each bench's slack:
 * NOISE times the spread of their medians, never under `allowed` and never
 * over CAP. With a previous baseline, a bench keeps its banked median where the
 * new one is worse, unless `slower` says to bank the worse one, and a scoped
 * acceptance retains the workloads it did not measure. */
export let baseline = (
  current: Run | readonly Run[],
  allowed: number,
  previous?: Baseline,
  slower = false,
): Baseline => {
  let runs: readonly Run[] = 'benches' in current ? [current] : current
  let last = runs.at(-1)
  if (!last) throw new Error('Expected at least one run to bank')
  for (let run of runs) {
    let key = incomparable(last, run)
    if (key) throw new Error(`Repeated runs differ in ${key}`)
    sameNames(last.benches, run.benches)
  }
  if (previous) compare(previous, last, 'subset')
  let banked = new Map(previous?.benches.map((b) => [b.name, b]))
  let out: Baseline = {
    version: last.version,
    suite: last.suite,
    metric: last.metric,
    workload: last.workload,
    runtime: last.runtime,
    cpu: last.cpu,
    tolerance: tolerance(allowed),
    benches: last.benches.map(({ name, unit, better, resolution }) => {
      let medians = runs.map((r) =>
        r.benches.find((b) => b.name == name)!.median
      )
      let pick = better == 'lower' ? Math.min : Math.max
      let old = banked.get(name)
      let median = old && !slower
        ? pick(...medians, old.median)
        : pick(...medians)
      // Rounded up to a tenth of a percent, so a baseline reads plainly.
      let noise = Math.ceil(NOISE * spread(medians, better) * 1000) / 1000
      let slack = runs.length > 1
        ? Math.min(CAP, Math.max(allowed, noise))
        : old?.tolerance
      return {
        name,
        unit,
        better,
        median,
        ...(resolution !== undefined ? { resolution } : {}),
        ...(slack !== undefined ? { tolerance: slack } : {}),
      }
    }),
  }
  if (previous) {
    let measured = new Set(out.benches.map((b) => b.name))
    out.benches = [
      ...previous.benches.filter((b) => !measured.has(b.name)),
      ...out.benches,
    ]
  }
  validate(out)
  return out
}
export type Coverage = 'exact' | 'subset'
/** Whether every measured workload already has a banked reference. */
export let covered = (base: Baseline, current: Run): boolean => {
  let banked = new Set(base.benches.map((b) => b.name))
  return current.benches.every((b) => banked.has(b.name))
}
/** The figure a banked bench may reach before it has regressed: its median
 * moved by its own slack, else the baseline's, rounded to its resolution. */
export let limit = (
  base: Baseline,
  b: Baseline['benches'][number],
): number => {
  let slack = b.tolerance ?? base.tolerance
  let most = b.median * (b.better == 'lower' ? 1 + slack : 1 - slack)
  return b.resolution !== undefined
    ? Math.round(most / b.resolution) * b.resolution
    : most
}
export let compare = (
  base: Baseline,
  current: Run,
  coverage: Coverage = 'exact',
): Regression[] => {
  if (!['exact', 'subset'].includes(coverage)) {
    throw new Error(`Unknown benchmark coverage: ${coverage}`)
  }
  validate(base)
  let key = incomparable(base, current)
  if (key) {
    throw new Error(
      `Incomparable ${key}; explicitly accept a baseline on the target box`,
    )
  }
  if (coverage == 'exact') sameNames(base.benches, current.benches)
  else sameNames(current.benches, current.benches)
  let prior = new Map(base.benches.map((b) => [b.name, b]))
  let out: Regression[] = []
  for (let b of current.benches) {
    value(b.median)
    let old = prior.get(b.name)
    if (!old) continue
    if (
      b.unit != old.unit || b.better != old.better ||
      b.resolution !== old.resolution
    ) {
      throw new Error(`Incomparable unit/direction/resolution: ${b.name}`)
    }
    let most = limit(base, old)
    if (b.better == 'lower' ? b.median > most : b.median < most) {
      out.push({
        name: b.name,
        unit: b.unit,
        baseline: old.median,
        limit: most,
        current: b.median,
        change: old.median == 0
          ? null
          : (b.median / old.median - 1) * (b.better == 'lower' ? 1 : -1),
      })
    }
  }
  return out
}
