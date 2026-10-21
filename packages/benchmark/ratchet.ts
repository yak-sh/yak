/** The pure ratchet compares compatible suite measurements. A baseline is a
 * value with its own slack; accepting it is an explicit runner operation.
 * A figure counts only where it clears the noise. A regression is a figure
 * past its reference by more than the noise of both measurements; a baseline
 * moves toward better only by as much, and never on a run the box measured
 * while loaded. Banking worse numbers is a separate, explicit choice
 * (`slower`), never what an ordinary acceptance does. */
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

/** A bench's slack is this many times the spread its measurement showed. */
export let NOISE = 2
/** The most slack noise can earn a bench; a tolerance stays under one. */
export let CAP = .95
/** A run is loaded when the box's one-minute load average as it began is
 * over this share of its CPUs: other work then shares the cores it times. */
export let LOAD = .75

/// loaded({ load: [3.1, 2, 1], cpus: 4 }) -> true
/// loaded({ load: [3, 5, 9], cpus: 4 }) -> false
/** Whether the box was loaded as a run began. A loaded run confirms no
 * regression and banks no baseline: what it timed was the other work. */
export let loaded = (run: Pick<Run, 'load' | 'cpus'>): boolean =>
  run.load[0] > run.cpus * LOAD

/** Refuses to bank what a loaded box measured. */
export let quiet = (suite: string, run: Pick<Run, 'load' | 'cpus'>): void => {
  if (loaded(run)) {
    throw new Error(
      `${suite} cannot bank on a loaded box: load ${
        run.load[0]
      } on ${run.cpus} CPUs`,
    )
  }
}

/** How far apart repeated medians of one bench fall, as a fraction of the
 * best of them: the noise a figure carries, which a check has to allow.
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
 * it best, the median acceptance banks, so a check compares like for like,
 * with the spread of every round median the runs took between them.
 *
 * ```ts
 * import { best, type Run } from '@yaks/benchmark'
 * import { equal } from '@yaks/testing'
 *
 * let run = (write: number, rate: number) => ({
 *   benches: [
 *     { name: 'write', better: 'lower', rounds: [{ median: write }] },
 *     { name: 'rate', better: 'higher', rounds: [{ median: rate }] },
 *   ].map((b) => ({ ...b, median: b.rounds[0].median })),
 * }) as Run
 * let one = best([run(12, 40), run(10, 30)])
 * equal(one.benches.map((b) => b.median), [10, 40])
 * equal(one.benches.map((b) => b.spread), [.2, .25])
 * ```
 */
export let best = (runs: readonly Run[]): Run => {
  let last = runs.at(-1)
  if (!last) throw new Error('Expected at least one run')
  return {
    ...last,
    benches: last.benches.map((b) => {
      let all = runs.map((r) => r.benches.find((c) => c.name == b.name)!)
      let top = all.reduce((a, c) =>
        (b.better == 'lower' ? c.median < a.median : c.median > a.median)
          ? c
          : a
      )
      let rounds = all.flatMap((r) => r.rounds.map((round) => round.median))
      return { ...top, spread: spread(rounds, b.better) }
    }),
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

/// past(100, 'lower', 121, .2) -> true
/// past(100, 'lower', 120, .2) -> false
/// past(100, 'higher', 79, .2) -> true
/** Whether a figure is past a median by more than a slack, the wrong way. */
export let past = (
  median: number,
  better: Direction,
  figure: number,
  slack: number,
): boolean =>
  better == 'lower'
    ? figure > median * (1 + slack)
    : figure < median * (1 - slack)

/** Bank one run, or several repeated runs of one suite, as a baseline. Each
 * bench banks its best median and, as its slack, NOISE times the spread of
 * its round medians, never under `allowed` and never over CAP. Against a
 * previous baseline a bench moves only when its new median clears the noise
 * of both, that is when the banked median would have regressed against it;
 * otherwise it keeps its median and the wider slack. `slower` banks the
 * measurement as it is, worse or not. A run the box measured while loaded
 * never banks, and a scoped acceptance retains the workloads it did not
 * measure. */
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
    quiet(run.suite, run)
  }
  if (previous) compare(previous, last, 'subset')
  let floor = tolerance(allowed)
  let one = runs.length == 1 ? last : best(runs)
  let banked = new Map(previous?.benches.map((b) => [b.name, b]))
  let out: Baseline = {
    version: last.version,
    suite: last.suite,
    metric: last.metric,
    workload: last.workload,
    runtime: last.runtime,
    cpu: last.cpu,
    tolerance: Math.min(floor, previous?.tolerance ?? floor),
    benches: one.benches.map((b) => {
      // Rounded up to a tenth of a percent, so a baseline reads plainly.
      let noise = Math.ceil(NOISE * b.spread * 1000) / 1000
      let measured = Math.min(CAP, Math.max(floor, noise))
      let old = slower ? undefined : banked.get(b.name)
      let wider = Math.min(
        CAP,
        Math.max(old?.tolerance ?? previous?.tolerance ?? 0, measured),
      )
      let kept = old && !past(b.median, b.better, old.median, wider)
        ? old
        : undefined
      return {
        name: b.name,
        unit: b.unit,
        better: b.better,
        median: kept?.median ?? b.median,
        ...(b.resolution !== undefined ? { resolution: b.resolution } : {}),
        tolerance: kept ? wider : measured,
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
 * moved by its own slack, else the baseline's, or by NOISE times the `spread`
 * the check itself measured where that is wider, so a figure must clear the
 * noise of both measurements. Rounded to its resolution. */
export let limit = (
  base: Baseline,
  b: Baseline['benches'][number],
  spread = 0,
): number => {
  let slack = Math.max(b.tolerance ?? base.tolerance, NOISE * spread)
  let most = b.median *
    (b.better == 'lower' ? 1 + slack : Math.max(0, 1 - slack))
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
    let most = limit(base, old, b.spread)
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
