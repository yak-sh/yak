/** Between-sitting evidence stays attached to the code that produced it.
 * Suspicious new code cannot teach the reference that its slowdown is noise. */
import { type Difference, difference, loaded, type Run } from '@yaks/benchmark'

export type Observation = {
  at: string
  commit: string | null
  load: readonly number[]
  busy: number | null
  medians: Record<string, number>
}
export type Cohort = { key: string; observations: Observation[] }
export type History = {
  reference?: Cohort
  candidate?: Cohort
  references?: Record<string, Cohort>
  protocol?: string
}
export type Judgement = {
  verdict: 'slower' | 'unconfirmed' | 'inconclusive' | 'loaded'
  slower: string[]
  comparisons: (Difference & { name: string })[]
}
let WINDOW = 12
// A screen and its confirmation share a sitting, as do overlapping cron lanes.
let SITTING = 15 * 60_000
let observe = (cohort: Cohort, run: Run) => {
  let observation = {
    at: run.at,
    commit: run.commit,
    load: run.load,
    busy: run.busy,
    medians: Object.fromEntries(run.benches.map((b) => [b.name, b.median])),
  }
  let last = cohort.observations.at(-1)
  if (last && Math.abs(Date.parse(run.at) - Date.parse(last.at)) < SITTING) {
    cohort.observations[cohort.observations.length - 1] = observation
  } else cohort.observations.push(observation)
  cohort.observations = cohort.observations.slice(-WINDOW)
}
let protocol = (run: Run) =>
  JSON.stringify([
    run.version,
    run.suite,
    run.metric,
    run.workload,
    run.runtime,
    run.cpu,
    run.benches.map((b) => [b.name, b.unit, b.better, b.resolution]),
  ])

/** Only an absolute pass can start a missing reference. Once it exists every
 * sitting is judged, including shifts inside the absolute ratchet's slack. */
export let judge = (
  history: History,
  key: string,
  run: Run,
  record = true,
): Judgement => {
  let out: Judgement = { verdict: 'inconclusive', slower: [], comparisons: [] }
  if (run.busy == null) return out
  if (loaded(run)) return { ...out, verdict: 'loaded' }
  let identity = protocol(run)
  if (history.protocol != identity) {
    history.protocol = identity
    delete history.reference
    delete history.candidate
    delete history.references
  }
  if (!history.reference) {
    if (run.verdict != 'passed' || !record) {
      if (record) {
        if (history.candidate?.key != key) {
          history.candidate = { key, observations: [] }
        }
        observe(history.candidate, run)
      }
      return out
    }
    history.reference = { key, observations: [] }
  }
  let reference = history.reference
  if (reference.key == key && record) observe(reference, run)
  if (history.candidate?.key != key) {
    history.candidate = { key, observations: [] }
  }
  if (record) observe(history.candidate, run)
  out.comparisons = run.benches.map((b) => {
    let prior = history.references?.[b.name] ?? reference
    if (prior.key == key) {
      if (record) observe(prior, run)
      return {
        name: b.name,
        verdict: 'unconfirmed' as const,
        probability: null,
        reference: null,
        current: null,
      }
    }
    let old = prior.observations.map((s) => s.medians[b.name])
    let current = history.candidate!.observations.map((s) => s.medians[b.name])
    let alpha = .05 / run.benches.length
    let result = difference(old, current, b.better, alpha)
    if (
      difference(old, current, b.better == 'lower' ? 'higher' : 'lower', alpha)
        .verdict == 'slower'
    ) {
      history.references ??= {}
      history.references[b.name] = structuredClone(history.candidate!)
    }
    return { name: b.name, ...result }
  })
  out.slower = out.comparisons.filter((b) => b.verdict == 'slower').map((b) =>
    b.name
  )
  out.verdict = out.slower.length
    ? 'slower'
    : out.comparisons.some((b) => b.verdict == 'inconclusive')
    ? 'inconclusive'
    : 'unconfirmed'
  return out
}
