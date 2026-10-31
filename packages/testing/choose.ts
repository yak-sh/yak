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
  recall,
  shared,
  type Survey,
  survey,
} from './deps.ts'
import { tested } from './find.ts'
import { plan, sweep } from './load.ts'

let code = (path: string) => /\.[mc]?[jt]sx?$/.test(path)

/** What a run chose: the key of each file it was given, those it runs, and
 * whether those import any of `paths` (true when the graph could not say). */
export type Chosen = {
  keys: Map<string, string>
  run: string[]
  affected: string[]
  sources: string[]
  beyond: number
  reaches: (paths: string[]) => boolean
}

/// let rank = (f: string) => ({ own: 0, near: 1, slow: 1, far: Infinity })[f]!
/// let cost = (f: string) => ({ own: 1, near: 1, slow: 5, far: 1 })[f]!
/// within(['far', 'slow', 'near', 'own'], rank, cost, 3) -> ['far', 'near', 'own']
/// within(['far', 'slow', 'near', 'own'], rank, cost, 0) -> ['own']
/** Of `files`, what fits `budget`: the change's own files whatever they cost
 * (rank 0), then the nearest and cheapest first. A file that does not fit is
 * passed over for a cheaper one behind it. Their order is kept. */
export let within = (
  files: string[],
  rank: (file: string) => number,
  cost: (file: string) => number,
  budget: number,
): string[] => {
  let left = budget
  let kept = new Set<string>()
  let order = files.toSorted((a, b) =>
    rank(a) == rank(b) ? cost(a) - cost(b) : rank(a) - rank(b)
  )
  for (let f of order) {
    if (rank(f) && cost(f) > left) continue
    left -= cost(f)
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
 * A narrowed run with a `budget` runs what fits it by what each file is
 * expected to `cost`, the nearest to the change first (./deps.ts `distance`,
 * `within`), and only those a distance reaches unless none is, and counts the
 * rest `beyond`: a run elsewhere with all of its files covers those.
 * When deno cannot say what a module imports, a narrowed run reports that
 * selection is unavailable; an explicit run has no keys and runs its files.
 */
export let choose = async (
  files: string[],
  {
    all = false,
    observed = false,
    kind = () => '',
    also = () => [],
    runner = [],
    sources = [],
    changed,
    budget,
    cost = () => 0,
  }: {
    all?: boolean
    observed?: boolean
    kind?: (file: string) => string
    also?: (kind: string) => string[]
    runner?: string[]
    sources?: string[]
    changed?: string[]
    budget?: number
    cost?: (file: string) => number
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
    }
  }
  let pages = files.filter((f) => !tested(f))
  await sweep(pages)
  let plans = new Map(await plan(pages))
  try {
    let kinds = [...new Set(files.map(kind))]
    let s = await survey([
      ...files.filter(tested),
      ...plans.values(),
      ...kinds.flatMap(also),
      ...runner,
      ...sources,
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
    // What each file read as it last passed, and a survey of the modules it
    // imported by a computed specifier, each sealed with its graph.
    let read = observed ? recall() : {}
    let reads = (f: string) => observed ? read[keys.get(f)!] ?? [] : undefined
    let imported = [...new Set(files.flatMap((f) => reads(f) ?? []))]
      .filter(code)
    let t = imported.length ? await survey(imported) : s
    if (changed && !t) {
      throw new Error(
        'Cannot select relevant tests: observed dependency graph unavailable',
      )
    }
    let before = all || !t ? {} : passed()
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
          t ?? s,
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
          t ?? s,
          true,
        )
      ) continue
      if (!(t && await proof(t, keys.get(f)!, reads(f), true) in before)) {
        run.push(f)
      }
    }
    let far = changed && s.distance(changed)
    let rank = (f: string) =>
      far ? Math.min(far(f), far(plans.get(f) ?? f)) : Infinity
    let near = run.filter((f) => rank(f) < Infinity)
    let kept = changed && budget != null
      ? within(near.length ? near : run, rank, cost, budget)
      : run
    let typed = sources.filter((f) => !changed || s.reaches([f], changed))
    let roots = [...kept.map((f) => plans.get(f) ?? f), ...typed]
    return {
      keys,
      run: kept,
      affected: reached,
      sources: typed,
      beyond: run.length - kept.length,
      reaches: (paths) => s.reaches(roots, paths),
    }
  } finally {
    await Promise.all(
      [...plans.values()].map((p) => Deno.remove(p).catch(() => {})),
    )
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
