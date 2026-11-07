import * as io from '@yaks/file/io'
// Which of its files a run runs: each test module and example page is keyed
// by what it depends on (./deps.ts), and one whose pass is kept is left out,
// unless the run asks for all. A page is keyed by a module importing what its
// examples import, written beside it while the keys are made (./load.ts
// `plan`). The caller that chooses before it starts anything (bin/test.ts)
// hands each runtime the keys of the files it runs, so none are made twice.
import {
  key,
  passed,
  proof,
  READS,
  recall,
  shared,
  type Survey,
  survey,
  versions,
} from './deps.ts'
import type { Examples } from './examples.ts'
import { tested } from './find.ts'
import { plan, sweep } from './load.ts'
import { naming } from './names.ts'

/** What a run chose: the key of each file it was given, those it runs,
 * whether those import any of `paths` (true when the graph could not say),
 * and what a file read as this version of it last passed, where that is
 * known: another version's reads are not this one's. */
export type Chosen = {
  keys: Map<string, string>
  run: string[]
  affected: string[]
  sources: string[]
  beyond: number
  reaches: (paths: string[]) => boolean
  read: (file: string) => string[] | undefined
}

/// let rank = (f: string) => ({ own: 0, near: 1, slow: 1, far: Infinity })[f]!
/// let cost = (f: string) => ({ own: 1, near: 1, slow: 5, far: 1 })[f]!
/// within(['far', 'slow', 'near', 'own'], rank, cost, 3) -> ['far', 'near', 'own']
/// within(['far', 'slow', 'near', 'own'], rank, cost, 0) -> []
/** Of `files`, what fits `budget`: the lowest rank first, and the cheapest
 * first of a rank. A file that does not fit is passed over for a cheaper one
 * behind it. Their order is kept. */
export let within = (
  files: string[],
  rank: (file: string) => number,
  cost: (file: string) => number,
  budget: number,
): string[] => {
  let left = budget
  let kept = new Set<string>()
  // Each file ranked and costed once: a sort asks again at every comparison.
  let ranks = new Map(files.map((f) => [f, rank(f)]))
  let costs = new Map(files.map((f) => [f, cost(f)]))
  let r = (f: string) => ranks.get(f)!, c = (f: string) => costs.get(f)!
  let order = files.toSorted((a, b) => r(a) == r(b) ? c(a) - c(b) : r(a) - r(b))
  for (let f of order) {
    if (c(f) > left) continue
    left -= c(f)
    kept.add(f)
  }
  return files.filter((f) => kept.has(f))
}

/**
 * Chooses among `files`. A file runs in a runtime of some `kind`, whose files
 * share the runtime's version, the kind's name, what `also` names and the
 * modules of the `runner` running them, each with what loads with it
 * (./deps.ts `shared`); when a run is `observed` its runtimes see what each
 * file reads (./reads.ts), and a pass is kept by that too. `changed` first
 * narrows the files to those reached by these paths, even with no cache.
 * A narrowed run with a `budget` runs each file `changed` names, then what
 * fits the rest of it by what each file is expected to `cost` (`within`):
 * first the files naming a declaration the change `edits`, or one naming it,
 * the fewest steps from it first (./names.ts `naming`, reading each file's
 * `source`), then the nearest to the change (./deps.ts `distance`), and only
 * those a distance reaches unless none is, and counts the rest `beyond`: a
 * run elsewhere with all of its files covers those. Given each path's package
 * (`owner`), the files of a changed package its distance reaches come first,
 * followed by those importing it.
 * When deno cannot say what a module imports, a narrowed run reports that
 * selection is unavailable; an explicit run has no keys and runs its files.
 */
export let choose = async (
  files: string[],
  {
    all = false,
    observed = false,
    reads: store = READS,
    kind = () => '',
    also = () => [],
    runner = [],
    sources = [],
    changed,
    budget,
    cost = () => 0,
    owner,
    edits,
    source = text,
    inspect = survey,
    parsed,
  }: {
    all?: boolean
    observed?: boolean
    /** Where what files read as they passed is kept (deps.ts `note`). */
    reads?: string
    kind?: (file: string) => string
    also?: (kind: string) => string[]
    runner?: string[]
    sources?: string[]
    changed?: string[]
    budget?: number
    cost?: (file: string) => number
    owner?: (path: string) => string | undefined
    edits?: Record<string, string[]>
    source?: (path: string) => string | undefined
    inspect?: (paths: string[]) => Promise<Survey | undefined>
    parsed?: ReadonlyMap<string, Examples>
  } = {},
): Promise<Chosen> => {
  if (changed && !changed.length) {
    return {
      keys: new Map(),
      run: [],
      affected: [],
      sources: [],
      beyond: 0,
      reaches: () => false,
      read: () => undefined,
    }
  }
  let pages = files.filter((f) => !tested(f))
  await sweep(pages)
  let plans = new Map(await plan(pages, parsed))
  try {
    let kinds = [...new Set(files.map(kind))]
    // What each file read as it last passed, surveyed with the rest: the
    // modules among them were imported by a computed specifier.
    let read = observed ? recall(store) : {}
    let known = observed ? versions(store) : {}
    let reads = (f: string) => observed ? read[f] ?? [] : undefined
    let s = await inspect([
      ...files.filter(tested),
      ...plans.values(),
      ...kinds.flatMap(also),
      ...runner,
      ...sources,
      ...new Set(files.flatMap((f) => reads(f) ?? [])),
    ])
    if (!s) {
      if (changed) {
        throw new Error(
          'Cannot select relevant tests: dependency graph unavailable',
        )
      }
      return {
        keys: new Map(),
        run: files,
        affected: files,
        sources,
        beyond: 0,
        reaches: () => true,
        read: () => undefined,
      }
    }
    let common = new Map(
      await Promise.all(
        kinds.map(async (k) =>
          [k, await shared(s, also(k), k, runner)] as const
        ),
      ),
    )
    let keys = new Map<string, string>()
    for (let f of files) {
      keys.set(
        f,
        await key(s, common.get(kind(f))!, plans.get(f) ?? f, f, true),
      )
    }
    let before = all ? new Set<string>() : passed()
    let run: string[] = []
    let reached: string[] = []
    for (let f of files) {
      if (
        changed &&
        !affected(
          s,
          [f, plans.get(f) ?? f, ...also(kind(f))],
          runner,
          changed,
          reads(f),
        )
      ) continue
      reached.push(f)
      if (
        changed && !affected(
          s,
          [f, plans.get(f) ?? f, ...also(kind(f))],
          runner,
          changed,
          reads(f),
          s,
          true,
        )
      ) continue
      if (!before.has(await proof(s, keys.get(f)!, reads(f), true))) {
        run.push(f)
      }
    }
    let far = changed && s.distance(changed, owner)
    let root = (f: string) => plans.get(f) ?? f
    let info = changed && edits ? await s.info(run.map(root)) : undefined
    let named = info && edits
      ? naming(info, run, edits, source, root)
      : new Map<string, number>()
    // A file naming what the change edits comes before every distance, the
    // fewer steps from it the sooner.
    let rank = (f: string) =>
      named.has(f)
        ? -1 / (1 + named.get(f)!)
        : far
        ? Math.min(far(f), far(root(f)))
        : Infinity
    let near = run.filter((f) => rank(f) < Infinity)
    // A file the change edits is the change, and runs whatever it costs; the
    // budget left is for the rest of what it reaches.
    let edited = new Set(changed)
    let mine = run.filter((f) => edited.has(f))
    let spent = mine.reduce((sum, f) => sum + cost(f), 0)
    let rest = (near.length ? near : run).filter((f) => !edited.has(f))
    let fits = new Set([
      ...mine,
      ...within(rest, rank, cost, Math.max(0, (budget ?? 0) - spent)),
    ])
    let kept = changed && budget != null ? run.filter((f) => fits.has(f)) : run
    let typed = sources.filter((f) => !changed || s.reaches([f], changed))
    let roots = [...kept.map((f) => plans.get(f) ?? f), ...typed]
    return {
      keys,
      run: kept,
      affected: reached,
      sources: typed,
      beyond: run.length - kept.length,
      reaches: (paths) => s.reaches(roots, paths),
      read: (f) => observed && known[f] == keys.get(f) ? read[f] : undefined,
    }
  } finally {
    await Promise.all(
      [...plans.values()].map((p) => io.remove(p).catch(() => {})),
    )
  }
}

let text = (path: string) => {
  try {
    return io.readTextFileSync(path)
  } catch {
    return undefined
  }
}

/** Whether a change reaches a file, its shared dependencies or its observed
 * reads. Runner dependencies count only when they load unconditionally. */
export let affected = (
  s: Survey,
  roots: string[],
  runner: string[],
  changed: string[],
  reads: string[] = [],
  observed: Survey = s,
  runtime = false,
): boolean =>
  s.reaches(roots, changed, false, runtime) ||
  s.reaches(runner, changed, true) ||
  observed.reaches(reads, changed, false, runtime) ||
  reads.some((path) => changed.some((file) => file.startsWith(`${path}/`)))
