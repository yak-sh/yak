/** The pure ratchet compares compatible suite measurements. A baseline is a
 * value with its own tolerance; accepting it is an explicit runner operation. */
import {
  type Baseline,
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
    if (!['lower', 'higher'].includes(b.better)) {
      throw new Error(`Missing direction: ${b.name}`)
    }
  }
}
/** A scoped acceptance retains workloads outside the current observation. */
export let baseline = (
  current: Run,
  allowed: number,
  previous?: Baseline,
): Baseline => {
  if (previous) compare(previous, current, 'subset')
  let out: Baseline = {
    version: current.version,
    suite: current.suite,
    metric: current.metric,
    workload: current.workload,
    runtime: current.runtime,
    cpu: current.cpu,
    tolerance: tolerance(allowed),
    benches: current.benches.map((
      { name, unit, better, median, resolution },
    ) => ({
      name,
      unit,
      better,
      median,
      ...(resolution !== undefined ? { resolution } : {}),
    })),
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
export let compare = (
  base: Baseline,
  current: Run,
  coverage: Coverage = 'exact',
): Regression[] => {
  if (!['exact', 'subset'].includes(coverage)) {
    throw new Error(`Unknown benchmark coverage: ${coverage}`)
  }
  validate(base)
  for (
    let key of [
      'version',
      'suite',
      'metric',
      'workload',
      'runtime',
      'cpu',
    ] as const
  ) {
    if (base[key] !== current[key]) {
      throw new Error(
        `Incomparable ${key}; explicitly accept a baseline on the target box`,
      )
    }
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
    let limit = old.median *
      (b.better == 'lower' ? 1 + base.tolerance : 1 - base.tolerance)
    if (b.resolution !== undefined) {
      limit = Math.round(limit / b.resolution) * b.resolution
    }
    let failed = b.better == 'lower' ? b.median > limit : b.median < limit
    if (failed) {
      out.push({
        name: b.name,
        unit: b.unit,
        baseline: old.median,
        current: b.median,
        change: old.median == 0
          ? null
          : (b.median / old.median - 1) * (b.better == 'lower' ? 1 : -1),
      })
    }
  }
  return out
}
