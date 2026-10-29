/** Baselines can bank different workloads at different revisions. Keep that
 * provenance through grouped measurement and the merged monitor evidence. */
import type { Baseline, Run } from '@yaks/benchmark'
import type { Judgement } from './paired.ts'

export let references = (
  base: Baseline,
  names: readonly string[],
  fallback: string,
  overrides: Record<string, string> = {},
): Record<string, string> =>
  Object.fromEntries(names.map((name) => [
    name,
    overrides[name] ?? base.benches.find((bench) =>
      bench.name == name
    )?.reference ??
      base.reference ?? fallback,
  ]))

export let grouped = (
  references: Record<string, string>,
): [string, string[]][] => {
  let groups = new Map<string, string[]>()
  for (let [name, reference] of Object.entries(references)) {
    let names = groups.get(reference) ?? []
    names.push(name)
    groups.set(reference, names)
  }
  return [...groups]
}

export let combined = (
  groups: Judgement[],
  names: readonly string[],
): Judgement => {
  if (groups.length == 1) return groups[0]
  let references = Object.assign({}, ...groups.map((group) => group.references))
  let comparisons = groups.flatMap((group) => group.comparisons)
    .sort((a, b) => names.indexOf(a.name) - names.indexOf(b.name))
  let merged = (slot: 'before' | 'current' | 'after'): Run | undefined => {
    let runs = groups.map((group) => group[slot])
    if (runs.some((run) => !run)) return undefined
    let all = runs as Run[]
    return {
      ...all[0],
      commit: slot == 'current' ? all[0].commit : null,
      benches: all.flatMap((run) => run.benches)
        .sort((a, b) => names.indexOf(a.name) - names.indexOf(b.name)),
    }
  }
  return {
    verdict: groups.some((group) => group.verdict == 'failed')
      ? 'failed'
      : groups.some((group) => group.verdict == 'slower')
      ? 'slower'
      : groups.some((group) => group.verdict == 'inconclusive')
      ? 'inconclusive'
      : 'same',
    slower: groups.flatMap((group) => group.slower),
    comparisons,
    references,
    groups,
    revision: groups[0].revision,
    before: merged('before'),
    current: merged('current'),
    after: merged('after'),
    ...groups.some((group) => group.error)
      ? {
        error: groups.filter((group) => group.error).map((group) => group.error)
          .join('\n'),
      }
      : {},
  }
}
