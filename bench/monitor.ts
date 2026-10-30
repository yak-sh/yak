/** Runs the box's bench suites on their own and tells the tracker when the
 * code got slower, so @yaks/heal sends it to an agent like any other bug. It is
 * monitoring, not a gate: nothing waits on it and nothing is refused.
 *
 * A "got slower" bug means the code got slower. Each suite is screened with
 * one run against its committed baseline, and a screen past its limit is
 * never evidence by itself: the monitor then measures the code the baseline
 * was banked at beside the code now, at the same moment (bench/paired.ts),
 * and reports only the benches that comparison finds slower. Every suite is
 * judged that way, except those that measure the live box (`LIVE`), which
 * have no older code to run beside them and so never report a slowdown.
 *
 * A check that can tell nothing reports nothing: a busy box, a busy lock, a
 * measurement past its time cap, older code that cannot run today's bench. A
 * suite that fails is checked again at once and reported only when it fails
 * again on a box that is not loaded, so a bug says the bench is broken, not
 * that the box was busy; one that fails on a loaded box stays owed. Each
 * suite reports under one fault, so a suite that stays slow adds hits to its
 * open bug, and one that turns slow again after its bug was resolved reopens
 * it.
 *
 * The box runs this from cron: every suite once a day, and `--hourly` every 30
 * minutes for user-facing waits, from a queue that carries what one tick could
 * not measure to the next.
 *
 *   deno run -A bench/monitor.ts [suite ...] [--hourly] */
import { busy, loaded, type Regression, type Run } from '@yaks/benchmark'
import { diagnostic } from './diagnostic.ts'
import { drain, enqueue, type Queue } from './queue.ts'
import { configPath, read } from '../packages/cli/config.ts'
import { reporter, revision } from '../packages/cli/report.ts'
import type { Judgement } from './paired.ts'

/** Every suite this box measures itself; the CI suites are timed where they
 * run, and yaks.app's own deploys by the deploy catch-up (@yaks/admin). */
export let SUITES = [
  'person-commands',
  'hook-waits',
  'operation-commands',
  'operation-remaining',
  'operation-controls',
  'operation-checkout',
  'operation-diagnostics',
  'operation-sessions',
  'operation-scale',
  'platform-waits',
  'web-client',
  'client-frame',
  'client-rules',
  'session-status',
  'graph-activity',
  'relay-admission',
  'harness-startup',
  'harness-steps',
  'harness-streaming',
  'harness-worker',
  'harness-window',
  'harness-switch',
  'throughput',
]

/** User-facing waits are checked every half hour, independent of slow throughput. */
export let HOURLY = [
  'person-commands',
  'hook-waits',
  'operation-commands',
  'operation-remaining',
  'operation-controls',
  'operation-checkout',
  'operation-diagnostics',
  'operation-sessions',
  'operation-scale',
  'platform-waits',
]

/** Suites that measure the live box (its server, its workers, its deploys),
 * so no older code can run beside them: they report only failures. */
export let LIVE: string[] = []

/** Deploy checks need fresh observations before comparison. */
export let MEASURE: Record<string, string[]> = {
  'app-deploy': ['bench/run.ts', 'app-deploy', 'time'],
}

/** One suite's check: a run, judged; a failure; or a check that could tell
 * nothing: the benchmark lock was busy (`deferred`), the box was loaded
 * (`loaded`), or the comparison could not be made (`inconclusive`). */
export type Outcome =
  | { verdict: 'passed' | 'measured'; run: Run }
  | {
    verdict: 'regressed'
    run: Run
    /** The commit the current code was measured beside. */
    reference?: string
    references?: Record<string, string>
    evidence: string[]
  }
  | { verdict: 'failed'; error: string }
  | { verdict: 'deferred' | 'loaded' | 'inconclusive' }
export type Monitor = {
  check: (suite: string) => Promise<Outcome>
  report: (
    error: Error,
    suite: string,
    kind: 'regressed' | 'failed',
  ) => Promise<void>
  /** Commits after `from` up to the checkout's head, one line each. */
  since: (from: string) => Promise<string[]>
  /** Whether other work has the box too busy for a failure to mean anything. */
  loaded: () => Promise<boolean>
}

let numbers = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })
let figure = (n: number, unit: string) => `${numbers.format(n)} ${unit}`

/** The letter a regression sends: its first line is the bug's title, the
 * rest what a fixer reads first. */
export let regressed = (
  suite: string,
  outcome: Extract<Outcome, { verdict: 'regressed' }>,
  commits: string[],
): string => {
  let { run } = outcome
  let references = [
    ...new Set(
      run.regressions.map((r) => r.reference ?? outcome.reference)
        .filter((reference): reference is string => !!reference),
    ),
  ]
  let reference = references.map((value) => value.slice(0, 9)).join(', ')
  let describe = (r: Regression) =>
    `${r.name} ${figure(r.current, r.unit)}, ${
      figure(r.baseline, r.unit)
    } for the code before it${
      r.reference ? ` at ${r.reference.slice(0, 9)}` : ''
    }`
  return [
    `${suite} got slower: ${describe(run.regressions[0])}`,
    ...run.regressions.slice(1).map((r) => `also ${describe(r)}`),
    `measured side by side at ${
      run.commit?.slice(0, 9)
    } and ${reference} on ${run.at}, ${
      run.busy == null
        ? 'how busy the box was is unknown'
        : `other work used at most ${
          Math.round(run.busy * 100)
        }% of the box's CPUs`
    }`,
    references.length > 1
      ? 'commits since each benchmark reference:'
      : `commits since ${reference}:`,
    ...commits.length ? commits : ['(none)'],
    ...outcome.evidence,
    `re-run: deno run -A bench/paired.ts ${suite} <evidence.json>`,
  ].join('\n')
}

/** Check each suite and report a slowdown or a suite that fails twice running
 * on a box that is not loaded.
 * A check that could tell nothing reports nothing; it is owed to a later tick. */
export let watch = async (
  suites: string[],
  m: Monitor,
): Promise<Record<string, Outcome['verdict']>> => {
  let out: Record<string, Outcome['verdict']> = {}
  for (let suite of suites) {
    let safe = async (): Promise<Outcome> => {
      try {
        return await m.check(suite)
      } catch (error) {
        return {
          verdict: 'failed',
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }
    let outcome = await safe()
    if (outcome.verdict == 'failed') outcome = await safe()
    if (outcome.verdict == 'failed' && await m.loaded()) {
      outcome = { verdict: 'loaded' }
    }
    out[suite] = outcome.verdict
    if (outcome.verdict == 'failed') {
      await m.report(
        new Error(`${suite} could not be measured: ${outcome.error}`),
        suite,
        'failed',
      )
    } else if (outcome.verdict == 'regressed') {
      let references = [
        ...new Set(
          outcome.run.regressions
            .map((regression) => regression.reference ?? outcome.reference)
            .filter((reference): reference is string => !!reference),
        ),
      ]
      let histories = await Promise.all(references.map(async (reference) => {
        let commits = await m.since(reference)
        return references.length > 1
          ? [`since ${reference.slice(0, 9)}:`, ...commits]
          : commits
      }))
      await m.report(
        new Error(regressed(suite, outcome, histories.flat())),
        suite,
        'regressed',
      )
    }
  }
  return out
}

/** The regressions a comparison found, as the screen's run reports them. */
export let judged = (run: Run, evidence: Judgement): Run => ({
  ...run,
  commit: evidence.revision ?? run.commit,
  busy: Math.max(run.busy ?? 0, evidence.current?.busy ?? 0),
  verdict: 'regressed',
  regressions: evidence.comparisons.filter((b) =>
    evidence.slower.includes(b.name)
  ).map((b) => ({
    name: `${b.name} (CPU)`,
    unit: b.unit,
    baseline: b.reference,
    reference: b.referenceCommit ?? evidence.references?.[b.name] ??
      evidence.reference,
    limit: b.reference,
    current: b.now,
    change: b.reference == 0 ? null : Math.abs(b.now / b.reference - 1),
  })),
})

/** Only a completed comparison can turn a screen into a reported slowdown. */
export let assessed = (
  run: Run,
  evidence: Judgement,
  path: string,
): Outcome => {
  if (evidence.verdict == 'failed') {
    return { verdict: 'failed', error: `${evidence.error}\nevidence: ${path}` }
  }
  if (evidence.complete !== true || evidence.error) {
    return { verdict: 'inconclusive' }
  }
  if (evidence.verdict == 'same') {
    return { verdict: 'passed', run: { ...run, verdict: 'passed' } }
  }
  if (evidence.verdict != 'slower') return { verdict: 'inconclusive' }
  return {
    verdict: 'regressed',
    run: judged(run, evidence),
    reference: evidence.reference,
    references: evidence.references,
    evidence: [`evidence: ${path}`],
  }
}

let root = new URL('../', import.meta.url).pathname
let git = async (...args: string[]) => {
  let { stdout, success } = await new Deno.Command('git', {
    args,
    cwd: root,
    stdout: 'piped',
    stderr: 'null',
  }).output()
  return success ? new TextDecoder().decode(stdout).trim() : ''
}
let home = Deno.env.get('HOME') ?? '/tmp'
let CACHE = `${home}/.cache/yak/bench`
/** Where the monitor's app-deploy rows go, beside its state, so a scheduled run
 * leaves the checkout clean. The suite's baseline stays in the repo. */
export let RECORDS = `${CACHE}/app-deploys.jsonl`
let env = { APP_DEPLOY_RECORD: RECORDS }
/** A half-hour tick admits work for 25 minutes; what it could not reach is
 * owed to the next. */
export let WINDOW = 25 * 60_000

/** Command prefix at the process seam: a busy box-wide lock exits 75 at once,
 * leaving the check owed, and a measurement over its cap is killed. A
 * user-facing suite's screen has ten minutes; a comparison runs it a dozen
 * times or more, so it has half an hour. The flock parent keeps the
 * descriptor; detached collectors cannot inherit it. */
export let measurement = (suite: string, paired = false): string[] => [
  'flock',
  '--close',
  '--nonblock',
  '--conflict-exit-code=75',
  '/tmp/yaks-throughput-bench.lock',
  'timeout',
  '--kill-after=10',
  HOURLY.includes(suite) ? paired ? '1800' : '600' : '10800',
]

/** One step of a check under the benchmark lock and its time cap: what it
 * printed to stderr, or why it said nothing. */
let measured = async (suite: string, args: string[]) => {
  let prefix = measurement(suite, args[0] == 'bench/paired.ts')
  let child = await new Deno.Command(prefix[0], {
    args: [...prefix.slice(1), Deno.execPath(), 'run', '-A', ...args],
    cwd: root,
    env,
    stdout: 'inherit',
    stderr: 'piped',
  }).output()
  await Deno.stderr.write(child.stderr)
  // Never spread the output: its stdout getter throws when stdout is not piped.
  return {
    code: child.code,
    said: new TextDecoder().decode(child.stderr),
    // A busy lock leaves the check owed; a run past its cap tells nothing.
    unjudged: child.code == 75
      ? 'deferred' as const
      : child.code == 124 || child.code == 137
      ? 'inconclusive' as const
      : undefined,
  }
}

/** Screen a suite with `deno task bench:check <suite> --runs=1`, and judge a
 * screen past its limit by measuring the code beside the code before it. A
 * loaded box is not measured at all: the bench would add to the load and its
 * figures could tell nothing. */
let check = async (suite: string): Promise<Outcome> => {
  // Sampled while the monitor sleeps, past its own start-up.
  if (loaded({ busy: await busy(2000) ?? null })) {
    return { verdict: 'loaded' }
  }
  if (MEASURE[suite]) {
    let timed = await new Deno.Command(Deno.execPath(), {
      args: ['run', '-A', ...MEASURE[suite]],
      cwd: root,
      env,
      stdout: 'inherit',
      stderr: 'piped',
    }).output()
    if (!timed.success) {
      await Deno.stderr.write(timed.stderr)
      return {
        verdict: 'failed',
        error: diagnostic(new TextDecoder().decode(timed.stderr), timed.code),
      }
    }
  }
  let results = `${CACHE}/${suite}.${Deno.pid}.results.json`
  await Deno.remove(results).catch(() => {})
  let screen = await measured(suite, [
    'bench/run.ts',
    'check',
    suite,
    `--output=${results}`,
    '--lock-held',
    '--runs=1',
  ])
  if (screen.unjudged) return { verdict: screen.unjudged }
  let run: Run
  try {
    run = JSON.parse(await Deno.readTextFile(results))
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error
    return { verdict: 'failed', error: diagnostic(screen.said, screen.code) }
  } finally {
    await Deno.remove(results).catch(() => {})
  }
  if (LIVE.includes(suite)) {
    let after = await busy(1000)
    if (after != null) run.busy = Math.max(run.busy ?? 0, after)
  }
  if (run.verdict == 'loaded' || loaded(run)) return { verdict: 'loaded' }
  if (run.verdict == 'inconclusive') return { verdict: 'inconclusive' }
  if (run.verdict == 'passed' || run.verdict == 'measured') {
    return { verdict: run.verdict, run }
  }
  if (run.verdict != 'regressed') {
    return { verdict: 'failed', error: diagnostic(screen.said, screen.code) }
  }
  if (LIVE.includes(suite)) return { verdict: 'inconclusive' }
  let path = `${CACHE}/${suite}.${Deno.pid}.paired.json`
  let paired = await measured(suite, ['bench/paired.ts', suite, path])
  if (paired.unjudged) return { verdict: paired.unjudged }
  let evidence: Judgement = JSON.parse(await Deno.readTextFile(path))
  let outcome = assessed(run, evidence, path)
  if (outcome.verdict == 'passed' || outcome.verdict == 'inconclusive') {
    await Deno.remove(path)
  }
  return outcome
}

if (import.meta.main) {
  let started = Date.now()
  let hourly = Deno.args.includes('--hourly')
  let named = Deno.args.filter((a) => !a.startsWith('--'))
  let suites = named.length ? named : hourly ? HOURLY : SUITES
  let path = configPath()
  let send = reporter(path ? read(path) : {}, undefined, revision(), {
    command: 'bench',
  })
  let monitor: Monitor = {
    check,
    loaded: async () => loaded({ busy: await busy(2000) ?? null }),
    report: (error, suite, kind) =>
      send(error, {
        fault: `bench ${kind}: ${suite}`,
        during: { kind: 'bench' },
        tags: { job: 'bench', suite },
      }),
    since: async (from) => {
      let lines = (await git('log', '--format=%h %s', `${from}..HEAD`))
        .split('\n').filter(Boolean)
      return lines.length > 40
        ? [...lines.slice(0, 40), `… ${lines.length - 40} more`]
        : lines
    },
  }
  let verdicts: Record<string, Outcome['verdict']> = {}
  if (hourly) {
    let queuePath = `${CACHE}/hourly-queue.json`
    let queue: Queue = { jobs: [], screened: {} }
    try {
      queue = JSON.parse(await Deno.readTextFile(queuePath))
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error
    }
    enqueue(queue, suites, Date.now())
    await drain(queue, {
      now: Date.now,
      deadline: started + WINDOW,
      save: async () => {
        let temporary = queuePath + '.' + Deno.pid + '.tmp'
        await Deno.mkdir(CACHE, { recursive: true })
        await Deno.writeTextFile(
          temporary,
          JSON.stringify(queue, null, 2) + '\n',
        )
        await Deno.rename(temporary, queuePath)
      },
      check: async (job) => {
        let found = await watch([job.suite], monitor)
        Object.assign(verdicts, found)
        return found[job.suite]
      },
    })
    console.log(
      `hourly queue: ${queue.jobs.length} pending; unfinished work carries to the next tick`,
    )
  } else verdicts = await watch(suites, monitor)
  await send.close()
  for (let [suite, verdict] of Object.entries(verdicts)) {
    console.log(`${suite}: ${verdict}`)
  }
}
