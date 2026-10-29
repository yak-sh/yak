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

/** What a run chose: the key of each file it was given, and those it runs. */
export type Chosen = { keys: Map<string, string>; run: string[] }

/**
 * Chooses among `files`. A file runs in a runtime of some `kind`, whose files
 * share the runtime's version, the kind's name, what `also` names and the
 * modules of the `runner` running them, each with what loads with it
 * (./deps.ts `shared`); when a run is `observed` its runtimes see what each
 * file reads (./reads.ts), and a pass is kept by that too. `changed` first
 * narrows the files to those reached by these paths, even with no cache.
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
    changed,
  }: {
    all?: boolean
    observed?: boolean
    kind?: (file: string) => string
    also?: (kind: string) => string[]
    runner?: string[]
    changed?: string[]
  } = {},
): Promise<Chosen> => {
  if (changed && !changed.length) return { keys: new Map(), run: [] }
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
    ])
    if (!s) {
      if (changed) {
        throw new Error(
          'Cannot select relevant tests: dependency graph unavailable',
        )
      }
      return { keys: new Map(), run: files }
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
      keys.set(f, await key(s, common.get(kind(f))!, plans.get(f) ?? f, f))
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
      if (!(t && await proof(t, keys.get(f)!, reads(f)) in before)) run.push(f)
    }
    return { keys, run }
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
): boolean =>
  s.reaches(roots, changed) || s.reaches(runner, changed, true) ||
  observed.reaches(reads, changed) ||
  reads.some((path) => changed.some((file) => file.startsWith(`${path}/`)))
