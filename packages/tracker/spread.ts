// What a bug's retained occurrences have in common and where they differ:
// how many share each commit, process, tag or entity, and when they came.
// Retention keeps the newest hundred and the first of each commit, so these
// describe that sample; the bug's own hits are the count of all of them.

import type { Bundle } from '@yaks/graph'
import { comp, str } from './model.ts'

/** One value occurrences share: how many, and the first and last of them. */
export type Tally = { value: string; n: number; first: string; last: string }

/// let e = (at: string, commit: string) => ({ entity: { eid: commit }, error: { at } })
/// tally([e('1', 'a'), e('3', 'b'), e('2', 'a')], (b) => b.entity.eid).map((t) => [t.value, t.n, t.first, t.last]) -> [['a', 2, '1', '2'], ['b', 1, '3', '3']]
/** The values `pick` reads off each occurrence, most shared first, then the
 * most recent. An occurrence without one is left out. */
export let tally = (
  errors: Bundle[],
  pick: (b: Bundle) => string | undefined,
): Tally[] => {
  let seen = new Map<string, Tally>()
  for (let b of errors) {
    let value = pick(b)
    if (!value) continue
    let at = str(comp(b, 'error').at)
    let t = seen.get(value)
    if (!t) seen.set(value, { value, n: 1, first: at, last: at })
    else {
      t.n++
      if (at < t.first) t.first = at
      if (at > t.last) t.last = at
    }
  }
  return [...seen.values()].sort((a, b) =>
    b.n - a.n || b.last.localeCompare(a.last)
  )
}

/// tags({ entity: { eid: 'a' }, error: { tags: { handler: 'h', n: 2 } } }) -> [['handler', 'h'], ['n', '2']]
/** An occurrence's tags as `[key, value]` pairs, in the order caught. */
export let tags = (b: Bundle): [string, string][] => {
  let t = comp(b, 'error').tags
  return t && typeof t == 'object'
    ? Object.entries(t as Record<string, unknown>)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => [k, typeof v == 'object' ? JSON.stringify(v) : str(v)])
    : []
}

/** What a bug's occurrences ran in: each a name and its tallies. */
export type Spread = { name: string; tallies: Tally[] }[]

let during = (key: string) => (b: Bundle) => str(comp(b, 'during')[key])

/** The places a bug's occurrences came from, newest commit first, and only
 * the ones any occurrence recorded. */
export let spread = (errors: Bundle[]): Spread =>
  [
    {
      name: 'commit',
      tallies: tally(errors, (b) => str(comp(b, 'error').commit))
        .sort((a, b) => b.last.localeCompare(a.last)),
    },
    ...[
      ...new Set(errors.flatMap((b) => tags(b).map(([k]) => k))),
    ].map((key) => ({
      name: key,
      tallies: tally(
        errors,
        (b) => tags(b).find(([k]) => k == key)?.[1],
      ),
    })),
    { name: 'process', tallies: tally(errors, during('process')) },
    { name: 'app', tallies: tally(errors, during('app')) },
    { name: 'space', tallies: tally(errors, during('space')) },
    { name: 'kind', tallies: tally(errors, during('kind')) },
    { name: 'request', tallies: tally(errors, during('request')) },
    { name: 'entity', tallies: tally(errors, during('entity')) },
    {
      name: 'environment',
      tallies: tally(errors, (b) => str(comp(b, 'error').environment)),
    },
  ].filter((s) => s.tallies.length)

/// bins(['2026-10-01T00:00:00Z', '2026-10-01T00:30:00Z', '2026-10-01T09:59:00Z'], Date.parse('2026-10-01T00:00:00Z'), Date.parse('2026-10-01T10:00:00Z'), 10) -> [2, 0, 0, 0, 0, 0, 0, 0, 0, 1]
/** How many moments fall in each of `n` equal stretches from `from` to `to`;
 * one at `to` counts in the last. */
export let bins = (
  ats: string[],
  from: number,
  to: number,
  n: number,
): number[] => {
  let out = Array<number>(n).fill(0)
  let span = Math.max(1, to - from)
  for (let at of ats) {
    let t = Date.parse(at)
    if (!Number.isFinite(t) || t < from || t > to) continue
    out[Math.min(n - 1, Math.floor((t - from) / span * n))]++
  }
  return out
}
