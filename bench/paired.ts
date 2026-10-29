/** Whether the code got slower: a suite measured at the revision its baseline
 * was banked at and at the current one, side by side at the same moment. Each
 * round brackets a sitting of the current code between two of the older
 * code's, so a busy box slows both alike. A bench is slower only when every
 * round's current figure is past both of its neighbours (or every current
 * figure is past every reference one), and its median is past the
 * reference's by more than the slack its baseline banked, and at least
 * `SLOWER`. The figure is CPU
 * time from every sample (@yaks/benchmark `stopwatch`). Wall time remains
 * diagnostic and is never a fallback for a missing CPU reading.
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
import { combined, grouped, references } from './references.ts'

/** A suite's committed baseline and its collector over the code at `root`. */
export let registered = (suite: string): {
  baseline: string
  collector: (root: string, names?: readonly string[]) => CollectedSuite
} => {
  if (suite == 'throughput') {
    return {
      baseline: 'bench/throughput.baseline.json',
      collector: (root, names) => throughput({ root, names }),
    }
  }
  let entry = standalone.find((b) => b.suite().name == suite)
  if (!entry) throw Error(`Unknown suite: ${suite}`)
  return {
    baseline: entry.baseline,
    collector: (root, names) => {
      let suite = entry.suite([], root, names)
      if (!names) return suite
      return {
        ...suite,
        benches: suite.benches.filter((bench) => names.includes(bench.name)),
        collect: async (round) => {
          let samples = await suite.collect(round)
          return Object.fromEntries(names.map((name) => [name, samples[name]]))
        },
      }
    },
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
  /** Every comparison judges CPU time. */
  figure: 'cpu'
  referenceCommit?: string
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
  references?: Record<string, string>
  groups?: Judgement[]
  collection?: Collection
  plan?: Collection[]
  complete?: boolean
}

/** The source and sampling contract that produced one reference group. */
export type Collection = {
  suite: string
  reference: string
  revision: string
  names: string[]
  rounds: number
  driver: string
  runtime: string
  cpu: string
  protocol: 'paired-cpu-1'
}
export type Checkpoint = {
  resume?: Judgement
  checkpoint?: (evidence: Judgement) => Promise<void>
}
let completeGroup = (group: Judgement, at: Collection) =>
  !group.error && group.verdict != 'failed' &&
  (Object.keys(at) as (keyof Collection)[]).every((field) =>
    JSON.stringify(group.collection?.[field]) == JSON.stringify(at[field])
  ) &&
  [group.before, group.current, group.after].every((run, slot) =>
    run?.rounds == at.rounds && run.metric.endsWith('/cpu') &&
    run.commit == (slot == 1 ? at.revision : at.reference) &&
    run.runtime == at.runtime && run.cpu == at.cpu &&
    JSON.stringify(run.benches.map((b) => b.name)) ==
      JSON.stringify(at.names) &&
    run.benches.every((b) =>
      b.rounds.length == at.rounds && b.samples.length > 0 &&
      b.rounds.every((r) => Number.isFinite(r.cpu)) &&
      b.samples.every((s) => Number.isFinite(s.cpu))
    )
  )

/** Persist observations before advancing to another reference. Resume only
 * complete groups from exactly the same code and sampling contract. */
export let collectGroups = async (
  plan: Collection[],
  measure: (collection: Collection) => Promise<Judgement>,
  options: Checkpoint = {},
): Promise<Judgement> => {
  let groups: Judgement[] = []
  let names = plan.flatMap((group) => group.names)
  let previous = options.resume?.groups ??
    (options.resume ? [options.resume] : [])
  let result = (error?: unknown): Judgement => {
    let complete = groups.length == plan.length &&
      groups.every((group, index) => completeGroup(group, plan[index]))
    let evidence = groups.length
      ? combined(groups, names)
      : { verdict: 'inconclusive' as const, slower: [], comparisons: [] }
    return {
      ...evidence,
      groups: [...groups],
      plan,
      complete,
      ...!complete ? { error: evidence.error ?? 'Collection incomplete' } : {},
      ...error
        ? {
          verdict: 'failed',
          error: error instanceof Error
            ? error.stack ?? error.message
            : `${error}`,
        }
        : {},
    }
  }
  for (let at of plan) {
    let retained = previous.find((group) => completeGroup(group, at))
    let group: Judgement
    try {
      group = retained ?? {
        ...await measure(at),
        collection: at,
        references: Object.fromEntries(at.names.map((name) => [
          name,
          at.reference,
        ])),
      }
    } catch (error) {
      let evidence = result(error)
      await options.checkpoint?.(evidence)
      return evidence
    }
    groups.push(group)
    await options.checkpoint?.(result())
  }
  return result()
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
 *     rounds: rounds.map((median, index) => ({ index, median, cpu: median, spans: null })),
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
    let [x, y, z] = runs.map((rounds) => rounds.map((r) => r.cpu ?? NaN))
    let reference = [...x, ...z]
    return {
      name: b.name,
      unit: b.unit,
      figure: 'cpu' as const,
      ...before.commit ? { referenceCommit: before.commit } : {},
      before: x,
      current: y,
      after: z,
      reference: reference.length && reference.every(Number.isFinite)
        ? median(reference)
        : NaN,
      now: y.length && y.every(Number.isFinite) ? median(y) : NaN,
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

let archive = async (root: string, target: string, revision: string) => {
  let source = new Deno.Command('git', {
    args: ['archive', revision],
    cwd: root,
    stdout: 'piped',
    stderr: 'piped',
  }).spawn()
  let unpack = new Deno.Command('tar', {
    args: ['-xf', '-', '-C', target],
    stdin: 'piped',
    stdout: 'null',
    stderr: 'piped',
  }).spawn()
  let [, from, into, sourceError, unpackError] = await Promise.all([
    source.stdout.pipeTo(unpack.stdin),
    source.status,
    unpack.status,
    new Response(source.stderr).text(),
    new Response(unpack.stderr).text(),
  ])
  if (!from.success || !into.success) {
    throw Error(`Cannot extract ${revision}: ${sourceError}${unpackError}`)
  }
}

/** Both revisions run the identical present-day driver and fixture. No live
 * database is opened or copied; each probe owns and cleans its seeded graph. */
export type Revisions = Checkpoint & {
  reference?: string
  current?: string
  rounds?: number
  names?: readonly string[]
  references?: Record<string, string>
}

export let collect = async (
  suite: string,
  root: string,
  revisions: Revisions = {},
): Promise<Judgement> => {
  let { baseline: path, collector } = registered(suite)
  let base: Baseline = JSON.parse(await Deno.readTextFile(`${root}/${path}`))
  let names = collector(root, revisions.names).benches.map((bench) =>
    bench.name
  )
  let fallback = revisions.reference ?? base.reference ?? text.decode(
    await command(root, 'git', ['log', '-1', '--format=%H', '--', path]),
  ).trim()
  let overrides = revisions.reference
    ? Object.fromEntries(names.map((name) => [name, revisions.reference!]))
    : revisions.references
  let source = references(base, names, fallback, overrides)
  let rounds = revisions.rounds ??
    Math.max(6, Math.ceil(Math.log2(20 * names.length)))
  let git = async (...args: string[]) =>
    text.decode(await command(root, 'git', args)).trim()
  let revision = await git('rev-parse', revisions.current ?? 'HEAD')
  let driver = await captureDriver(root)
  try {
    let context = await host()
    let plan: Collection[] = []
    for (let [reference, selected] of grouped(source)) {
      plan.push({
        suite,
        reference: await git('rev-parse', reference),
        revision,
        names: selected,
        rounds,
        driver: driver.identity,
        runtime: context.runtime,
        cpu: context.cpu,
        protocol: 'paired-cpu-1',
      })
    }
    return await collectGroups(plan, (at) =>
      collectAt(suite, root, driver, {
        reference: at.reference,
        current: at.revision,
        names: at.names,
        rounds,
      }), revisions)
  } finally {
    await Deno.remove(driver.root, { recursive: true })
  }
}

type Driver = { root: string; files: string[]; identity: string }
let captureDriver = async (root: string): Promise<Driver> => {
  let target = await Deno.makeTempDir({ prefix: 'bench-driver-' })
  try {
    await command(root, 'cp', ['-R', 'bench', target + '/bench'])
    await Deno.mkdir(target + '/packages')
    await command(root, 'cp', [
      '-R',
      'packages/benchmark',
      target + '/packages/benchmark',
    ])
    let files = text.decode(
      await command(root, 'git', [
        'ls-files',
        '*_bench.ts',
      ]),
    ).trim().split('\n').filter(Boolean)
    for (let file of files) {
      await Deno.mkdir(`${target}/${file.slice(0, file.lastIndexOf('/'))}`, {
        recursive: true,
      })
      await Deno.copyFile(`${root}/${file}`, `${target}/${file}`)
    }
    return { root: target, files, identity: await driverIdentity(root, target) }
  } catch (error) {
    await Deno.remove(target, { recursive: true })
    throw error
  }
}

let driverIdentity = async (root: string, snapshot: string) => {
  let files = text.decode(
    await command(root, 'git', [
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      'bench',
      'packages/benchmark',
      '*_bench.ts',
    ]),
  ).split('\0').filter((file) =>
    (/\.tsx?$/.test(file) && !/_test\.tsx?$/.test(file)) ||
    file == 'packages/benchmark/deno.json'
  ).sort()
  let sources = await Promise.all(files.map(async (file) => {
    try {
      return [file, await Deno.readTextFile(`${snapshot}/${file}`)]
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error
      return [file, null]
    }
  }))
  let bytes = new TextEncoder().encode(JSON.stringify(sources))
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  )
    .map((b) => b.toString(16).padStart(2, '0')).join('')
}

let collectAt = async (
  suite: string,
  root: string,
  driver: Driver,
  revisions: Revisions = {},
): Promise<Judgement> => {
  let { baseline: path, collector: registeredCollector } = registered(suite)
  let collector = (root: string) => registeredCollector(root, revisions.names)
  let git = async (...args: string[]) =>
    text.decode(await command(root, 'git', args)).trim()
  let base: Baseline = JSON.parse(
    await Deno.readTextFile(`${driver.root}/${path}`),
  )
  let reference = await git(
    'rev-parse',
    revisions.reference ?? base.reference ??
      await git('log', '-1', '--format=%H', '--', path),
  )
  let revision = await git('rev-parse', revisions.current ?? 'HEAD')
  let common = await git(
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  )
  let context = await host()
  let scratch = await Deno.makeTempDir({ prefix: 'bench-paired-' })
  let collectors: CollectedSuite[] = []
  try {
    let roots: string[] = []
    for (let [i, commit] of [reference, revision].entries()) {
      let target = `${scratch}/${i}`
      await Deno.mkdir(target)
      await archive(root, target, commit)
      // The driver is this checkout's: its bench files and the library they
      // measure with. The product under them is the revision's own.
      await command(driver.root, 'cp', ['-R', 'bench/.', `${target}/bench/`])
      await command(driver.root, 'cp', [
        '-R',
        'packages/benchmark/.',
        `${target}/packages/benchmark/`,
      ])
      // The timing library is part of the driver overlay, including on
      // revisions whose workspace predates the benchmark package.
      let config = JSON.parse(await Deno.readTextFile(`${target}/deno.json`))
      config.workspace = [
        ...new Set([
          ...config.workspace ?? [],
          './packages/benchmark',
        ]),
      ]
      await Deno.writeTextFile(`${target}/deno.json`, JSON.stringify(config))
      for (let file of driver.files) {
        await Deno.mkdir(`${target}/${file.slice(0, file.lastIndexOf('/'))}`, {
          recursive: true,
        })
        await Deno.copyFile(`${driver.root}/${file}`, `${target}/${file}`)
      }
      // Reuse dependencies, not generated product assets or a graph.
      await Deno.symlink(`${root}/node_modules`, `${target}/node_modules`)
        .catch((e) => {
          if (!(e instanceof Deno.errors.AlreadyExists)) throw e
        })
      // Generators enumerate tracked sources. A private index makes this
      // archive self-contained without a managed worktree or a live checkout.
      await command(target, 'git', ['init', '-q'])
      await Deno.writeTextFile(
        `${target}/.git/objects/info/alternates`,
        `${common}/objects\n`,
      )
      await command(target, 'git', ['read-tree', commit])
      await command(target, 'git', ['update-ref', 'HEAD', commit])
      roots.push(target)
    }
    collectors = [collector(roots[0]), collector(roots[1]), collector(roots[0])]
    let observations: Record<string, Samples>[][] = [[], [], []]
    let names = JSON.stringify(
      collectors[1].benches.map((b) => b.name).sort(),
    )
    let measure = async (at: number, round: number) => {
      try {
        let samples = await collectors[at].collect(round)
        let got = JSON.stringify(Object.keys(samples).sort())
        if (got != names) throw Error(`measured ${got}, banked ${names}`)
        return samples
      } catch (error) {
        if (at == 1) throw error
        throw new Unjudged(
          `the code at ${reference.slice(0, 9)} cannot run today's bench: ${
            error instanceof Error ? error.message : error
          }`,
        )
      }
    }
    // Each tree runs once unmeasured, so no round times one tree's cold
    // compile caches against the other's warm ones.
    for (let at of [0, 1, 2]) await measure(at, 0)
    let rounds = revisions.rounds ?? Math.max(
      6,
      Math.ceil(Math.log2(20 * collectors[1].benches.length)),
    )
    if (!Number.isInteger(rounds) || rounds < 3) {
      throw Error('A paired comparison needs at least three rounds')
    }
    for (let round = 0; round < rounds; round++) {
      console.error(`${suite}: paired round ${round + 1}/${rounds}`)
      let reference = 0
      let pair = await bracket(
        (revision) =>
          measure(revision == 'current' ? 1 : reference++ ? 2 : 0, round),
        async () => {},
      )
      observations[0].push(pair.before)
      observations[1].push(pair.current)
      observations[2].push(pair.after)
    }
    let suiteOf = collectors[1]
    let aggregate = (slot: number): Promise<Run> =>
      run({
        ...suiteOf,
        close: undefined,
        collect: (round: number) => observations[slot][round],
      }, {
        rounds,
        figure: 'cpu',
        output: `${scratch}/run.json`,
        reporters: () => [],
        host: () => ({ ...context, commit: slot == 1 ? revision : reference }),
      }).then((r) => ({
        ...r,
        busy: null,
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
    await Promise.all(collectors.map((suite) => suite.close?.()))
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
