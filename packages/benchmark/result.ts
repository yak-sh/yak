/** The data shared by bench authors, the runner, the ratchet and reporters.
 * Samples keep their round and provenance; a Deno average is never described
 * as an individual operation's timing. No effect belongs in this module. */

import type { Event } from '@yaks/trace'

export type Sample = {
  value: number
  /** The CPU time the step took, in the bench's unit: this process's and its
   * finished children's (host.ts `cputime`). Absent where the step's work runs
   * in a process that outlives it, or where the box does not say. */
  cpu?: number
  counts?: Record<string, number>
  source?: string
  details?: unknown
  spans?: readonly Event[]
}
export type Samples = number | Sample | readonly Sample[]
export type Direction = 'lower' | 'higher'
export type Workload = {
  name: string
  unit: string
  better?: Direction
  /** Precision in this workload's unit, used to round the tolerance boundary. */
  resolution?: number
}
export type Bench = Workload & {
  sample: (round: number) => Samples | Promise<Samples>
}
export type Suite = {
  name: string
  /** The aggregation contract, compared verbatim by the ratchet. */
  metric: string
  /** Change this when the corpus or timed boundary changes. */
  workload: string | number
  benches: readonly Bench[]
  /** Release collection resources after the final round, including failures. */
  close?: () => void | Promise<void>
}
/** A shared collector can measure several workloads in one external process. */
export type CollectedSuite = Omit<Suite, 'benches'> & {
  benches: readonly Workload[]
  collect: (round: number) =>
    | Record<string, Samples>
    | Promise<Record<string, Samples>>
}
export type Round = {
  index: number
  median: number
  /** The median of its samples' CPU time, where every sample has one. */
  cpu?: number
  /** Reserved for the recorded span tree, rather than live channel history. */
  spans: readonly Event[] | null
}
export type Result = Workload & {
  better: Direction
  samples: (Sample & { round: number })[]
  rounds: Round[]
  median: number
  /** How far apart its round medians fell, across every run of the
   * measurement, as a fraction of the best (ratchet.ts `spread`): the noise
   * this figure carries. */
  spread: number
  /** The median round's recorded span tree. */
  spans: readonly Event[] | null
}
export type Regression = {
  reference?: string
  name: string
  unit: string
  baseline: number
  /** The figure the bench was allowed to reach: its baseline and slack. */
  limit: number
  current: number
  /** A positive fraction is worse, for either direction. */
  change: number | null
}
export type Run = {
  version: 1
  suite: string
  metric: string
  workload: string | number
  at: string
  commit: string | null
  runtime: string
  cpu: string
  /** The box's one, five and fifteen minute load averages as the run began. */
  load: readonly number[]
  /** The most of the box's CPUs other work used in the second before a
   * round, while the bench rested (host.ts `busy`), or null where the box
   * does not say. Over BUSY, the run is loaded (ratchet.ts `loaded`). */
  busy: number | null
  rounds: number
  benches: Result[]
  tolerance: number | null
  /** `loaded`: a figure was past its limit, but the box was loaded, so the
   * run can tell nothing either way. */
  verdict: 'measured' | 'passed' | 'regressed' | 'loaded' | 'accepted'
  regressions: Regression[]
}
export type Baseline =
  & Pick<Run, 'version' | 'suite' | 'metric' | 'workload' | 'runtime' | 'cpu'>
  & {
    /** The revision measured when converting a baseline to a new metric. */
    reference?: string
    /** The slack a bench without its own may take. */
    tolerance: number
    benches: (Workload & {
      better: Direction
      /** The product revision this individual workload was banked against. */
      reference?: string
      median: number
      /** The slack this bench measured for itself when it was banked. */
      tolerance?: number
    })[]
  }

export let value = (n: number): number => {
  if (typeof n != 'number' || !Number.isFinite(n) || n < 0) {
    throw new Error(`Expected a finite, nonnegative sample: ${n}`)
  }
  return n
}
export let workload = (input: string | number): void => {
  if (
    typeof input == 'number'
      ? !Number.isFinite(input)
      : typeof input != 'string' || !input
  ) {
    throw new Error('Expected a finite workload version or a nonempty string')
  }
}
export let median = (values: readonly number[]): number => {
  if (!values.length) throw new Error('Expected at least one sample')
  let sorted = values.map(value).sort((a, b) => a - b)
  let middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}
export let samples = (input: Samples): Sample[] => {
  let out: readonly Sample[] = typeof input == 'number'
    ? [{ value: input }]
    : Array.isArray(input)
    ? input
    : [input as Sample]
  if (!out.length) throw new Error('Expected at least one sample')
  return out.map((s) => {
    value(s.value)
    if (s.cpu !== undefined) value(s.cpu)
    for (let count of Object.values(s.counts ?? {})) value(count)
    return { ...s, counts: s.counts && { ...s.counts } }
  })
}
export let names = (benches: readonly Workload[]): void => {
  let seen = new Set<string>()
  if (!benches.length) throw new Error('Expected at least one bench')
  for (let b of benches) {
    if (
      typeof b.name != 'string' || !b.name || typeof b.unit != 'string' ||
      !b.unit || seen.has(b.name)
    ) {
      throw new Error(`Missing name/unit or duplicate bench: ${b.name}`)
    }
    if (b.better != null && !['lower', 'higher'].includes(b.better)) {
      throw new Error(`Unknown direction: ${b.better}`)
    }
    if (
      b.resolution !== undefined &&
      (!Number.isFinite(b.resolution) || b.resolution <= 0)
    ) {
      throw new Error(`Expected a finite, positive resolution: ${b.name}`)
    }
    seen.add(b.name)
  }
}
export let sameNames = (
  expected: readonly Workload[],
  actual: readonly Workload[],
): void => {
  names(expected)
  names(actual)
  let a = actual.map((b) => b.name).sort()
  let e = expected.map((b) => b.name).sort()
  if (JSON.stringify(a) != JSON.stringify(e)) {
    throw new Error(`Benchmark set changed: expected [${e}]; received [${a}]`)
  }
}
