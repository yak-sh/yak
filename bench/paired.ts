/** Whether the code got slower: a suite measured at the revision its baseline
 * was banked at and at the current one, side by side at the same moment. Each
 * round brackets a sitting of the current code between two of the older
 * code's, so a busy box slows both alike. A bench is slower only when every
 * round's current figure is past both of its neighbours (or every current
 * figure is past every reference one), and its median is past the
 * reference's by more than the slack its baseline banked, and at least
 * `SLOWER`. The figure is CPU
 * time where the bench's samples carry it (@yaks/benchmark `stopwatch`),
 * which other work on the box barely moves, and wall time where they do not.
 *
 * Both revisions run this checkout's driver (bench/*.ts and @yaks/benchmark)
 * over their own product code. When the older code cannot run today's driver
 * the comparison is inconclusive; when the current code's bench fails, it
 * failed. This is evidence for the monitor: it banks nothing and gates
 * nothing.
 *
 *   deno run -A bench/paired.ts SUITE OUTPUT [--reference=REV] [--current=REV]
 *
 * The caller holds the box-wide benchmark lock for the whole bracket. */
import {
  type Baseline,
  type CollectedSuite,
  host,
  limit,
  median,
  type Run,
  run,
  type Samples,
} from '@yaks/benchmark'
import { standalone } from './standalone.ts'
import { throughput } from './throughput.ts'

/** A suite's committed baseline and its collector over the code at `root`. */
export let registered = (suite: string): {
  baseline: string
  collector: (root: string) => CollectedSuite
} => {
  if (suite == 'throughput') {
    return {
      baseline: 'bench/throughput.baseline.json',
      collector: (root) => throughput({ root }),
    }
  }
  let entry = standalone.find((b) => b.suite().name == suite)
  if (!entry) throw Error(`Unknown suite: ${suite}`)
  return {
    baseline: entry.baseline,
    collector: (root) => entry.suite([], root),
  }
}

/** The least slowdown reported, as a fraction of the older code's figure:
 * about the least change in a wait a person notices. Less is real, but nearly
 * every change that adds a feature costs that much somewhere. */
export let SLOWER = .1

export type Pair = { before: Run; current: Run; after: Run }
export type Comparison = {
  name: string
  unit: string
  /** Which time the rounds compare: CPU where every sample carried it. */
  figure: 'cpu' | 'wall'
  before: number[]
  current: number[]
  after: number[]
  /** The medians of the reference's rounds and the current code's. */
  reference: number
  now: number
}
export type Evidence = {
  verdict: 'slower' | 'same' | 'inconclusive' | 'failed'
  slower: string[]
  comparisons: Comparison[]
  /** What kept the comparison from being made. */
  error?: string
}

/** What bench/paired.ts writes: the evidence, the runs it judged and the two
 * commits measured. */
export type Judgement = Evidence & Partial<Pair> & {
  reference?: string
  revision?: string
}

/** Judge one bracketed comparison against the slack `base` banked.
 *
 * ```ts
 * import type { Run } from '@yaks/benchmark'
 * import { compare } from './paired.ts'
 * import { equal } from '@yaks/testing'
 *
 * let at = (...rounds: number[]) => ({
 *   suite: 's', metric: 'm', workload: 1, runtime: 'r', cpu: 'c', busy: 0,
 *   benches: [{
 *     name: 'b', unit: 'ms', better: 'lower',
 *     rounds: rounds.map((median, index) => ({ index, median, spans: null })),
 *   }],
 * }) as unknown as Run
 * let reference = at(100, 104, 98, 102, 101, 99)
 * let verdict = (...rounds: number[]) =>
 *   compare({ before: reference, current: at(...rounds), after: reference })
 *     .verdict
 * equal(verdict(101, 103, 99, 100, 102, 98), 'same')
 * equal(verdict(130, 131, 129, 133, 130, 128), 'slower')
 * ```
 */
export let compare = (
  { before, current, after }: Pair,
  base?: Baseline,
): Evidence => {
  for (let run of [before, after]) {
    for (
      let field of ['suite', 'metric', 'workload', 'runtime', 'cpu'] as const
    ) {
      if (run[field] != current[field]) throw Error(`Paired ${field} differs`)
    }
    if (
      JSON.stringify(run.benches.map((b) => [b.name, b.unit, b.better])) !=
        JSON.stringify(current.benches.map((b) => [b.name, b.unit, b.better]))
    ) {
      throw Error('Paired workloads differ')
    }
  }
  let comparisons: Comparison[] = current.benches.map((b, i) => {
    let runs = [before, current, after].map((r) => r.benches[i].rounds)
    let cpu = runs.every((rounds) =>
      rounds.length && rounds.every((r) => r.cpu !== undefined)
    )
    let [x, y, z] = runs.map((rounds) =>
      rounds.map((r) => cpu ? r.cpu! : r.median)
    )
    let reference = [...x, ...z]
    return {
      name: b.name,
      unit: b.unit,
      figure: cpu ? 'cpu' : 'wall',
      before: x,
      current: y,
      after: z,
      reference: reference.length ? median(reference) : NaN,
      now: y.length ? median(y) : NaN,
    }
  })
  let overlap = (a: number[], b: number[]) =>
    Math.max(...a) >= Math.min(...b) && Math.max(...b) >= Math.min(...a)
  let valid = (xs: number[]) =>
    xs.length >= 3 && xs.every((x) => Number.isFinite(x) && x >= 0)
  // A bench whose reference rounds before and after moved apart cannot be
  // judged: the box changed more than the code did.
  let steady = (b: Comparison) =>
    [b.before, b.current, b.after].every(valid) && overlap(b.before, b.after)
  let slower = comparisons.filter((b, i) => {
    if (!steady(b)) return false
    let lower = current.benches[i].better == 'lower'
    let worse = (x: number, y: number) => lower ? x > y : x < y
    let paired = b.current.length >=
        Math.max(6, Math.ceil(Math.log2(20 * comparisons.length))) &&
      b.current.every((n, round) =>
        worse(n, b.before[round]) && worse(n, b.after[round])
      )
    let reference = [...b.before, ...b.after]
    let apart = lower
      ? Math.min(...b.current) > Math.max(...reference)
      : Math.max(...b.current) < Math.min(...reference)
    let banked = base?.benches.find((c) => c.name == b.name)
    let most = limit(base ?? { tolerance: 0 } as Baseline, {
      name: b.name,
      unit: b.unit,
      better: current.benches[i].better,
      median: b.reference,
      tolerance: Math.max(SLOWER, banked?.tolerance ?? base?.tolerance ?? 0),
    })
    return (paired || apart) && worse(b.now, most)
  }).map((b) => b.name)
  return {
    verdict: slower.length
      ? 'slower'
      : comparisons.every(steady)
      ? 'same'
      : 'inconclusive',
    slower,
    comparisons,
  }
}

/** The bracket keeps code selection and cleanup independent of the host clock. */
export let bracket = async <T>(
  measure: (revision: 'reference' | 'current') => Promise<T>,
  close: () => Promise<void>,
) => {
  try {
    let before = await measure('reference')
    let current = await measure('current')
    let after = await measure('reference')
    return { before, current, after }
  } finally {
    await close()
  }
}

/** Why a bracket stopped short: the older code could not run today's
 * driver, which says nothing about the current code. */
class Unjudged extends Error {}

let text = new TextDecoder()
let command = async (cwd: string, cmd: string, args: string[]) => {
  let out = await new Deno.Command(cmd, {
    cwd,
    args,
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!out.success) {
    throw Error(`${cmd}: ${text.decode(out.stderr).slice(-16000)}`)
  }
  return out.stdout
}

/** Both revisions run the identical present-day driver and fixture. No live
 * database is opened or copied; each probe owns and cleans its seeded graph. */
export let collect = async (
  suite: string,
  root: string,
  revisions: { reference?: string; current?: string } = {},
): Promise<Judgement> => {
  let { baseline: path, collector } = registered(suite)
  let git = async (...args: string[]) =>
    text.decode(await command(root, 'git', args)).trim()
  let reference = await git(
    'rev-parse',
    revisions.reference ?? await git('log', '-1', '--format=%H', '--', path),
  )
  let revision = await git('rev-parse', revisions.current ?? 'HEAD')
  let base: Baseline = JSON.parse(await Deno.readTextFile(`${root}/${path}`))
  let context = await host()
  let scratch = await Deno.makeTempDir({ prefix: 'bench-paired-' })
  try {
    let roots: string[] = []
    for (let [i, commit] of [reference, revision].entries()) {
      let target = `${scratch}/${i}`
      await Deno.mkdir(target)
      let tar = `${scratch}/${i}.tar`
      await Deno.writeFile(tar, await command(root, 'git', ['archive', commit]))
      await command(root, 'tar', ['-xf', tar, '-C', target])
      await Deno.remove(tar)
      // The driver is this checkout's: its bench files and the library they
      // measure with. The product under them is the revision's own.
      await command(root, 'cp', ['-R', 'bench/.', `${target}/bench/`])
      await command(root, 'cp', [
        '-R',
        'packages/benchmark/.',
        `${target}/packages/benchmark/`,
      ])
      // Reuse dependencies, not generated product assets or a graph.
      await Deno.symlink(`${root}/node_modules`, `${target}/node_modules`)
        .catch((e) => {
          if (!(e instanceof Deno.errors.AlreadyExists)) throw e
        })
      // Generators enumerate tracked sources. A private index makes this
      // archive self-contained without a managed worktree or a live checkout.
      await command(target, 'git', ['init', '-q'])
      await command(target, 'git', ['add', '-A'])
      roots.push(target)
    }
    let observations: Record<string, Samples>[][] = [[], [], []]
    let pressure: number[] = []
    // Other work slows both revisions alike, so it is recorded, not refused.
    let resting = async () => {
      let use = await context.busy?.()
      if (use != null) pressure.push(use)
    }
    let names = JSON.stringify(base.benches.map((b) => b.name).sort())
    let measure = async (at: number, slot: number) => {
      await resting()
      let samples
      try {
        samples = await collector(roots[at]).collect(observations[slot].length)
        let got = JSON.stringify(Object.keys(samples).sort())
        if (got != names) throw Error(`measured ${got}, banked ${names}`)
      } catch (error) {
        if (at == 1) throw error
        throw new Unjudged(
          `the code at ${reference.slice(0, 9)} cannot run today's bench: ${
            error instanceof Error ? error.message : error
          }`,
        )
      }
      observations[slot].push(samples)
      await resting()
    }
    let rounds = Math.max(6, Math.ceil(Math.log2(20 * base.benches.length)))
    for (let round = 0; round < rounds; round++) {
      await bracket(
        (revision) =>
          revision == 'current'
            ? measure(1, 1)
            : measure(0, observations[0].length > round ? 2 : 0),
        async () => {},
      )
    }
    let suiteOf = collector(roots[1])
    let aggregate = (slot: number): Promise<Run> =>
      run({
        ...suiteOf,
        collect: (round: number) => observations[slot][round],
      }, {
        rounds,
        output: `${scratch}/run.json`,
        reporters: () => [],
        host: () => ({ ...context, commit: slot == 1 ? revision : reference }),
      }).then((r) => ({
        ...r,
        busy: pressure.length ? Math.max(...pressure) : null,
      }))
    let pair = {
      before: await aggregate(0),
      current: await aggregate(1),
      after: await aggregate(2),
    }
    return { ...pair, ...compare(pair, base), reference, revision }
  } catch (error) {
    if (!(error instanceof Unjudged)) throw error
    return {
      verdict: 'inconclusive',
      slower: [],
      comparisons: [],
      error: error.message,
      reference,
      revision,
    }
  } finally {
    await Deno.remove(scratch, { recursive: true })
  }
}

if (import.meta.main) {
  let [suite, output] = Deno.args.filter((a) => !a.startsWith('--'))
  let flag = (name: string) =>
    Deno.args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
  if (!output) {
    throw Error(
      'usage: paired.ts SUITE OUTPUT [--reference=REV] [--current=REV]',
    )
  }
  let evidence: Judgement
  try {
    evidence = await collect(suite, new URL('..', import.meta.url).pathname, {
      reference: flag('reference'),
      current: flag('current'),
    })
  } catch (error) {
    // The current code's bench failed, or the judge itself did.
    evidence = {
      verdict: 'failed',
      slower: [],
      comparisons: [],
      error: error instanceof Error ? error.stack ?? error.message : `${error}`,
    }
  }
  await Deno.writeTextFile(output, JSON.stringify(evidence, null, 2) + '\n')
  console.log(`${suite}: paired ${evidence.verdict}; evidence ${output}`)
  for (let b of evidence.comparisons) {
    console.log(
      `${b.name} (${b.figure}): ${b.now.toFixed(1)} vs ${
        b.reference.toFixed(1)
      } ${b.unit}${evidence.slower.includes(b.name) ? ', slower' : ''}`,
    )
  }
}
