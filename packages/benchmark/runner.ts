/** Run workloads sequentially, persist JSON before reporting, and accept one
 * suite's baseline only on request. External collectors use the same ratchet
 * and reporting path as timed callbacks. */
import { type Host, host, type Reporters, reporters } from './host.ts'
import { resolve } from 'node:path'
import {
  type Baseline,
  type CollectedSuite,
  median,
  names,
  type Result,
  type Run,
  sameNames,
  samples,
  type Suite,
  workload,
} from './result.ts'
import {
  baseline,
  compare,
  type Coverage,
  covered,
  tolerance,
  validate,
} from './ratchet.ts'

export type Files = {
  read: (path: string) => Promise<string>
  write: (path: string, value: unknown) => Promise<void>
}
/** An interrupted write never leaves a partial result or baseline. */
export let files: Files = {
  read: (path) => Deno.readTextFile(path),
  write: async (path, value) => {
    let tmp = `${path}.${crypto.randomUUID()}.tmp`
    try {
      await Deno.writeTextFile(tmp, JSON.stringify(value, null, 2) + '\n')
      await Deno.rename(tmp, path)
    } catch (error) {
      try {
        await Deno.remove(tmp)
      } catch (cleanup) {
        if (!(cleanup instanceof Deno.errors.NotFound)) {
          console.error('Benchmark temporary file cleanup failed', cleanup)
        }
      }
      throw error
    }
  },
}
export type Options = {
  rounds?: number
  mode?: 'run' | 'check' | 'accept'
  output: string
  baseline?: string
  /** Required for acceptance; checks use the committed baseline's tolerance. */
  tolerance?: number
  host?: () => Host | Promise<Host>
  reporters?: Reporters
  files?: Files
  /** A box-wide flock, compatible with shell flock. Never unlink this file. */
  lock?: string
  /** Scoped observations may measure only part of a suite, including new work.
   * Unbanked measurements are reported as measured; acceptance retains the
   * other workloads in the suite's baseline. Exact coverage is the default. */
  coverage?: Coverage
}
export class Regressed extends Error {
  constructor(public result: Run) {
    super(
      `${result.regressions.length} benchmarks exceeded tolerance (${
        result.tolerance! * 100
      }%)`,
    )
    this.name = 'Regressed'
  }
}

export let run = async (
  suite: Suite | CollectedSuite,
  options: Options,
): Promise<Run> => {
  if (!options.lock) return await execute(suite, options)
  using lock = await Deno.open(options.lock, {
    create: true,
    read: true,
    write: true,
  })
  console.error(`benchmark: waiting for ${options.lock}`)
  await lock.lock(true)
  try {
    await lock.truncate(0)
    await lock.write(new TextEncoder().encode(`${Deno.pid}\n`))
    return await execute(suite, options)
  } finally {
    await lock.unlock()
  }
}

let execute = async (
  suite: Suite | CollectedSuite,
  options: Options,
): Promise<Run> => {
  let rounds = options.rounds ?? 3
  let mode = options.mode ?? 'run'
  if (!Number.isSafeInteger(rounds) || rounds < 1) {
    throw new Error('Expected a positive integer round count')
  }
  if (!['run', 'check', 'accept'].includes(mode)) {
    throw new Error(`Unknown mode: ${mode}`)
  }
  if (options.coverage && !['exact', 'subset'].includes(options.coverage)) {
    throw new Error(`Unknown benchmark coverage: ${options.coverage}`)
  }
  if (
    typeof suite.name != 'string' || !suite.name ||
    typeof suite.metric != 'string' || !suite.metric ||
    !['string', 'number'].includes(typeof suite.workload)
  ) throw new Error('Invalid suite metadata')
  workload(suite.workload)
  names(suite.benches)
  if (
    !options.output ||
    (options.baseline && resolve(options.output) == resolve(options.baseline))
  ) {
    throw new Error('Result and baseline need separate paths')
  }
  if (options.baseline && !options.files) {
    try {
      let [output, base] = await Promise.all([
        Deno.realPath(options.output),
        Deno.realPath(options.baseline),
      ])
      if (output == base) {
        throw new Error('Result and baseline need separate paths')
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error
    }
  }
  if (mode != 'run' && !options.baseline) {
    throw new Error('A check or acceptance needs a baseline path')
  }
  if (mode == 'accept') tolerance(options.tolerance!)
  if (mode == 'check' && options.tolerance != null) {
    throw new Error('Checks use the baseline tolerance')
  }
  let store = options.files ?? files
  let base: Baseline | undefined
  if (mode == 'check' || mode == 'accept' && options.coverage == 'subset') {
    try {
      base = JSON.parse(await store.read(options.baseline!))
    } catch (error) {
      if (mode == 'check' || !(error instanceof Deno.errors.NotFound)) {
        throw error
      }
    }
    if (mode == 'check' || base !== undefined) validate(base!)
  }
  let context = await (options.host ?? host)()
  let benches: Result[] = suite.benches.map((b) => ({
    name: b.name,
    unit: b.unit,
    ...(b.resolution !== undefined ? { resolution: b.resolution } : {}),
    better: b.better ?? 'lower',
    samples: [],
    rounds: [],
    median: 0,
    spans: null,
  }))
  for (let round = 0; round < rounds; round++) {
    let collected = 'collect' in suite ? await suite.collect(round) : undefined
    if (collected) {
      sameNames(
        suite.benches,
        Object.keys(collected).map((name) => ({ name, unit: 'collected' })),
      )
    }
    for (let i = 0; i < benches.length; i++) {
      let b = benches[i]
      let input = collected
        ? collected[b.name]
        : await (suite as Suite).benches[i].sample(round)
      let raw = samples(input)
      b.samples.push(...raw.map(({ spans: _spans, ...s }) => ({ ...s, round })))
      let middle = [...raw].sort((a, b) =>
        a.value - b.value
      )[Math.floor(raw.length / 2)]
      b.rounds.push({
        index: round,
        median: median(raw.map((s) => s.value)),
        spans: middle.spans ?? null,
      })
    }
  }
  for (let b of benches) {
    b.median = median(b.rounds.map((r) => r.median))
    let middle = [...b.rounds].sort((a, b) =>
      a.median - b.median
    )[Math.floor(rounds / 2)]
    b.spans = middle.spans
  }
  let current: Run = {
    version: 1,
    suite: suite.name,
    metric: suite.metric,
    workload: suite.workload,
    at: new Date().toISOString(),
    commit: context.commit,
    runtime: context.runtime,
    cpu: context.cpu,
    load: [...context.load],
    rounds,
    benches,
    tolerance: mode == 'accept' ? options.tolerance! : base?.tolerance ?? null,
    verdict: mode == 'accept' ? 'accepted' : 'measured',
    regressions: [],
  }
  if (base && mode == 'check') {
    current.regressions = compare(base, current, options.coverage)
    current.verdict = current.regressions.length
      ? 'regressed'
      : covered(base, current)
      ? 'passed'
      : 'measured'
  }
  let accepted = mode == 'accept'
    ? baseline(current, options.tolerance!, base)
    : undefined
  await store.write(options.output, current)
  if (mode == 'accept') {
    await store.write(
      options.baseline!,
      accepted!,
    )
  }
  let report: Awaited<ReturnType<Reporters>> = []
  try {
    report = await (options.reporters ?? reporters)(context)
  } catch (error) {
    console.error('Benchmark reporter factory failed', error)
  }
  if (report.length) {
    // Reporting owns an immutable snapshot, never the ratchet's mutable result.
    let snapshot = freeze(JSON.parse(JSON.stringify(current)) as Run)
    // One broken provider cannot keep another from receiving the durable run.
    let deliveries = await Promise.allSettled(
      report.map((send) => Promise.resolve().then(() => send(snapshot))),
    )
    for (let delivery of deliveries) {
      if (delivery.status == 'rejected') {
        console.error('Benchmark reporter failed', delivery.reason)
      }
    }
  }
  if (current.verdict == 'regressed') throw new Regressed(current)
  return current
}

let freeze = <T>(input: T): T => {
  if (input && typeof input == 'object') {
    Object.freeze(input)
    for (let value of Object.values(input)) freeze(value)
  }
  return input
}
