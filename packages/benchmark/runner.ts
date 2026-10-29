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
  best,
  compare,
  type Coverage,
  covered,
  incomparable,
  loaded,
  spread,
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
  /** Judge CPU time; wall readings remain in raw samples for diagnostics. */
  figure?: 'cpu'
  mode?: 'run' | 'check' | 'accept'
  output: string
  baseline?: string
  /** Required for acceptance: the least slack any bench is banked with.
   * Checks use the baseline's own. */
  tolerance?: number
  /** Measure the suite this many times over, keeping each bench's best median
   * and the spread of every round between them (ratchet.ts `best`).
   * Acceptance banks it with the slack that spread asks for (ratchet.ts
   * `baseline`), and a check compares it, allowing that spread as well, so a
   * check taken as its baseline was banked measures what it banked. */
  runs?: number
  /** Bank the measurement as it is, even a worse median than the baseline's:
   * every bench's, or only the named benches'. Without it acceptance only
   * moves a bench toward better, by more than the noise. */
  slower?: boolean | readonly string[]
  host?: () => Host | Promise<Host>
  reporters?: Reporters
  files?: Files
  /** A box-wide flock, held for each round and publication, so queued suites
   * can measure between rounds. Compatible with shell flock; never unlink it. */
  lock?: string
  /** Scoped observations may measure only part of a suite, including new work.
   * Unbanked measurements are reported as measured; acceptance retains the
   * other workloads in the suite's baseline. Exact coverage is the default. */
  coverage?: Coverage
}
export class Regressed extends Error {
  constructor(public result: Run) {
    super(`${result.regressions.length} benchmarks exceeded tolerance`)
    this.name = 'Regressed'
  }
}

export let run = async (
  suite: Suite | CollectedSuite,
  options: Options,
): Promise<Run> => {
  try {
    if (!options.lock) return await execute(suite, options)
    using lock = await Deno.open(options.lock, {
      create: true,
      read: true,
      write: true,
    })
    let exclusive: Exclusive = async (work) => {
      await lock.lock(true)
      try {
        await lock.truncate(0)
        await lock.write(new TextEncoder().encode(`${Deno.pid}\n`))
        return await work()
      } finally {
        await lock.unlock()
      }
    }
    return await execute(suite, options, exclusive)
  } finally {
    await suite.close?.()
  }
}

type Exclusive = <T>(work: () => Promise<T>) => Promise<T>
let direct: Exclusive = (work) => work()

let execute = async (
  suite: Suite | CollectedSuite,
  options: Options,
  exclusive: Exclusive = direct,
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
  let repeats = options.runs ?? 1
  if (!Number.isSafeInteger(repeats) || repeats < 1) {
    throw new Error('Expected a positive integer run count')
  }
  let store = options.files ?? files
  let readBase = async (): Promise<Baseline | undefined> => {
    let base: Baseline | undefined
    if (mode != 'run') {
      try {
        base = JSON.parse(await store.read(options.baseline!))
      } catch (error) {
        if (mode == 'check' || !(error instanceof Deno.errors.NotFound)) {
          throw error
        }
      }
      if (mode == 'check' || base !== undefined) validate(base!)
    }
    return base
  }
  await readBase()
  let context = await (options.host ?? host)()
  // Only a check or an acceptance is judged, so only they sample the box.
  let sampled = mode == 'run' || options.figure == 'cpu'
    ? { ...context, busy: undefined }
    : context
  let runs: Run[] = []
  for (let i = 0; i < repeats; i++) {
    runs.push(await measure(suite, rounds, sampled, exclusive, options.figure))
  }
  // A different acceptance may have banked while our rounds yielded. Read its
  // baseline under the publication lock before comparing or moving the best.
  let current = await exclusive(async () => {
    let base = await readBase()
    let current = best(runs)
    current.tolerance = mode == 'accept'
      ? options.tolerance!
      : base?.tolerance ?? null
    if (mode == 'accept') {
      current.verdict = loaded(current) ? 'loaded' : 'accepted'
    }
    if (base && mode == 'check') {
      current.regressions = compare(base, current, options.coverage)
      current.verdict = current.regressions.length
        ? loaded(current) ? 'loaded' : 'regressed'
        : covered(base, current)
        ? 'passed'
        : 'measured'
    }
    // An exact acceptance banks the suite as measured: a baseline banked on
    // another runtime or workload, or for benches the suite no longer has, is
    // no reference for it.
    let previous = !base
      ? undefined
      : options.coverage == 'subset'
      ? base
      : incomparable(base, current)
      ? undefined
      : {
        ...base,
        benches: base.benches.filter((b) =>
          current.benches.some((c) => c.name == b.name)
        ),
      }
    await store.write(options.output, current)
    // A loaded run is kept as measured; baseline() refuses to bank it.
    if (mode == 'accept') {
      await store.write(
        options.baseline!,
        baseline(runs, options.tolerance!, previous, options.slower),
      )
    }
    return current
  })
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

/** One run: every round of every bench, aggregated, with the host's metadata.
 * The ratchet's verdict is the caller's. */
let measure = async (
  suite: Suite | CollectedSuite,
  rounds: number,
  context: Host,
  exclusive: Exclusive,
  figure?: 'cpu',
): Promise<Run> => {
  let benches: Result[] = suite.benches.map((b) => ({
    name: b.name,
    unit: b.unit,
    ...(b.resolution !== undefined ? { resolution: b.resolution } : {}),
    better: b.better ?? 'lower',
    samples: [],
    rounds: [],
    median: 0,
    spread: 0,
    spans: null,
  }))
  // The box is sampled at rest before each round, inside the lock: the
  // bench's own work, and what it asks of a server, never counts against it.
  let busy: number[] = []
  for (let round = 0; round < rounds; round++) {
    await exclusive(async () => {
      let use = await context.busy?.()
      if (use !== undefined) busy.push(use)
      let collected = 'collect' in suite
        ? await suite.collect(round)
        : undefined
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
        if (figure && raw.some((s) => s.cpu === undefined)) {
          throw new Error(`Missing CPU measurement: ${b.name}`)
        }
        let measured = (s: typeof raw[number]) => figure ? s.cpu! : s.value
        b.samples.push(
          ...raw.map(({ spans: _spans, ...s }) => ({ ...s, round })),
        )
        let middle = [...raw].sort((a, b) =>
          measured(a) - measured(b)
        )[Math.floor(raw.length / 2)]
        let cpu = raw.map((s) =>
          s.cpu
        )
        b.rounds.push({
          index: round,
          median: median(raw.map(measured)),
          ...cpu.every((n) => n !== undefined)
            ? { cpu: median(cpu as number[]) }
            : {},
          spans: middle.spans ?? null,
        })
      }
    })
  }
  for (let b of benches) {
    b.median = median(b.rounds.map((r) => r.median))
    b.spread = spread(b.rounds.map((r) => r.median), b.better)
    let middle = [...b.rounds].sort((a, b) =>
      a.median - b.median
    )[Math.floor(rounds / 2)]
    b.spans = middle.spans
  }
  return {
    version: 1,
    suite: suite.name,
    metric: figure ? `${suite.metric}/cpu` : suite.metric,
    workload: suite.workload,
    at: new Date().toISOString(),
    commit: context.commit,
    runtime: context.runtime,
    cpu: context.cpu,
    load: [...context.load],
    busy: busy.length ? Math.max(...busy) : null,
    rounds,
    benches,
    tolerance: null,
    verdict: 'measured',
    regressions: [],
  }
}

let freeze = <T>(input: T): T => {
  if (input && typeof input == 'object') {
    Object.freeze(input)
    for (let value of Object.values(input)) freeze(value)
  }
  return input
}
