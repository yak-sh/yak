/** Runs the box's bench suites on their own and tells the tracker when one has
 * become slower, so @yaks/heal sends it to an agent like any other bug. It is
 * monitoring, not a gate: nothing waits on it and nothing is refused.
 *
 * Each suite is screened against its banked baseline with one run
 * (`deno task bench:check <suite> --runs=1`). A regression counts only when a
 * check taken as the baseline was banked confirms it: each bench's best median
 * of three runs, so one slow run alone is not called a regression. A confirmed
 * one is reported with every
 * figure over its limit, the run's load, and the commits since the suite's
 * last good run; a suite that cannot run (no baseline, a crash, a page that
 * never paints) is reported as a failure. Each suite reports under one fault,
 * so a suite that stays slow adds hits to its open bug, and one that turns
 * slow again after its bug was resolved reopens it.
 *
 * The box runs this from cron: every suite once a day, and `--hourly`
 * every 30 minutes for user-facing waits. Its serialized queue, lock wait,
 * screening and confirmation share an absolute 25-minute deadline. Each suite
 * gets an equal share of the remaining time, including its confirmation, so
 * slow predecessors cannot spend the whole tick. Unused time flows forward. Unmeasured
 * suites report failures, never silently defer past the next tick; `--restarted` every 15 minutes
 * measures pages only when the live web unit has
 * changed since it last looked, that is once after each `yak restart`.
 *
 *   deno run -A bench/monitor.ts [suite ...] [--restarted]
 *
 * What it last saw (the web unit, each suite's last good commit) is kept in
 * `~/.cache/yak/bench/monitor.json`; losing it only widens the commits listed
 * to those since the suite's baseline was banked. */
import {
  type Baseline,
  baseline,
  type Regression,
  type Run,
} from '@yaks/benchmark'
import { drain, enqueue, type Queue } from './queue.ts'
import { configPath, read } from '../packages/cli/config.ts'
import { reporter, revision } from '../packages/cli/report.ts'

/** Every suite this box measures itself; the CI and platform deploy suites are
 * timed where they run. */
export let SUITES = [
  'pages',
  'page-content',
  'inbox-content',
  'person-commands',
  'hook-waits',
  'operation-commands',
  'operation-remaining',
  'operation-controls',
  'terminal-interactions',
  'operation-scale',
  'platform-waits',
  'worker-health',
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
  'app-deploy',
]

/** User-facing waits are checked every half hour, independent of slow throughput. */
export let HOURLY = [
  'pages',
  'page-content',
  'inbox-content',
  'person-commands',
  'hook-waits',
  'operation-commands',
  'operation-remaining',
  'operation-controls',
  'terminal-interactions',
  'operation-scale',
  'platform-waits',
  'worker-health',
]

/** Deploy checks need fresh observations before comparison. */
export let MEASURE: Record<string, string[]> = {
  'app-deploy': ['bench/run.ts', 'app-deploy', 'time'],
}

/** One suite's check: its run, a failure, or a busy benchmark lock. */
export type Outcome =
  | { verdict: 'passed' | 'measured' | 'regressed'; run: Run }
  | { verdict: 'failed'; error: string }
  | { verdict: 'deferred' }
  | { verdict: 'unconfirmed' }
  | { verdict: 'inconclusive' }
export type Good = { commit: string; at: string }
export type State = { web?: string; good: Record<string, Good> }
export type Monitor = {
  /** One check of a suite, over `runs` runs, else as its baseline was banked.
   * A scheduled deadline includes both lock wait and collection. */
  check: (suite: string, runs?: number, deadline?: number) => Promise<Outcome>
  report: (
    error: Error,
    suite: string,
    kind: 'regressed' | 'failed',
  ) => Promise<void>
  /** Commits after `from` up to the checkout's head, one line each. */
  since: (suite: string, from?: string) => Promise<string[]>
  bank?: (suite: string, run: Run) => Promise<void>
}

let numbers = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })
let figure = (n: number, unit: string) => `${numbers.format(n)} ${unit}`
let over = (r: Regression) =>
  `${r.name} ${figure(r.current, r.unit)}, over its limit of ${
    figure(r.limit, r.unit)
  } (best ${figure(r.baseline, r.unit)})`

/** The letter a confirmed regression sends: its first line is the bug's
 * title, the rest what a fixer reads first. */
export let regressed = (
  suite: string,
  run: Run,
  good: Good | undefined,
  commits: string[],
): string =>
  [
    `${suite} got slower: ${over(run.regressions[0])}`,
    ...run.regressions.slice(1).map((r) => `also ${over(r)}`),
    `confirmed at ${run.commit?.slice(0, 9)} on ${run.at}, load ${
      run.load.map((n) => n.toFixed(1)).join(' ')
    }`,
    good
      ? `commits since its last good run at ${
        good.commit.slice(0, 9)
      } (${good.at}):`
      : 'commits since its baseline was banked:',
    ...commits.length ? commits : ['(none: the box or the data changed)'],
    `re-run: deno task bench:check ${suite}`,
  ].join('\n')

/** Screen each suite with one run, confirm a regression with a check taken as
 * its baseline was banked, report what is confirmed or broken, and say which
 * suites are good now. */
export let watch = async (
  suites: string[],
  state: State,
  m: Monitor,
  schedule?: { deadline: number; now: () => number },
): Promise<Record<string, Outcome['verdict']>> => {
  let out: Record<string, Outcome['verdict']> = {}
  for (let [index, suite] of suites.entries()) {
    let now = schedule?.now() ?? 0
    let deadline = schedule
      ? now + Math.max(0, schedule.deadline - now) / (suites.length - index)
      : undefined
    let safe = async (runs?: number): Promise<Outcome> => {
      try {
        if (schedule && schedule.now() >= deadline!) {
          return {
            verdict: 'failed',
            error: 'scheduling deadline missed before measurement',
          }
        }
        let result = await m.check(suite, runs, deadline)
        if (
          schedule &&
          ((schedule.now() >= deadline! &&
            result.verdict != 'failed') ||
            result.verdict == 'deferred')
        ) {
          return {
            verdict: 'failed',
            error:
              'scheduling deadline missed: measurement or confirmation unavailable',
          }
        }
        return result
      } catch (error) {
        return {
          verdict: 'failed',
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }
    let outcome = await safe(1)
    if (outcome.verdict == 'regressed') outcome = await safe()
    if (
      outcome.verdict == 'deferred' || outcome.verdict == 'unconfirmed' ||
      outcome.verdict == 'inconclusive'
    ) {
      out[suite] = outcome.verdict
      continue
    }
    if (outcome.verdict != 'failed') {
      try {
        await m.bank?.(suite, outcome.run)
      } catch (error) {
        await m.report(
          new Error(`${suite} best could not be saved: ${error}`),
          suite,
          'failed',
        )
      }
    }
    out[suite] = outcome.verdict
    if (outcome.verdict == 'failed') {
      await m.report(
        new Error(`${suite} could not be measured: ${outcome.error}`),
        suite,
        'failed',
      )
    } else if (outcome.verdict == 'regressed') {
      let good = state.good[suite]
      let commits = await m.since(suite, good?.commit)
      await m.report(
        new Error(regressed(suite, outcome.run, good, commits)),
        suite,
        'regressed',
      )
    } else if (outcome.run.commit) {
      state.good[suite] = { commit: outcome.run.commit, at: outcome.run.at }
    }
  }
  return out
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
let STATE = `${home}/.cache/yak/bench/monitor.json`
/** Where the monitor's app-deploy rows go, beside its state, so a scheduled run
 * leaves the checkout clean. The suite's baseline stays in the repo. */
export let RECORDS = `${home}/.cache/yak/bench/app-deploys.jsonl`
let env = { APP_DEPLOY_RECORD: RECORDS }
let load = async (): Promise<State> => {
  try {
    return JSON.parse(await Deno.readTextFile(STATE))
  } catch {
    return { good: {} }
  }
}
let save = async (state: State) => {
  await Deno.mkdir(STATE.replace(/\/[^/]+$/, ''), { recursive: true })
  await Deno.writeTextFile(STATE, JSON.stringify(state, null, 2) + '\n')
}

/** Keep the monitor's moving best beside its state. The committed reference
 * and local best both bind it; neither a checkout nor a slower run raises it. */
let bank = async (path: string, value: Baseline) => {
  let tmp = `${path}.${Deno.pid}.tmp`
  try {
    await Deno.writeTextFile(tmp, JSON.stringify(value, null, 2) + '\n')
    await Deno.rename(tmp, path)
  } finally {
    await Deno.remove(tmp).catch(() => {})
  }
}
let reference = async (suite: string) => {
  let committed: Baseline = JSON.parse(
    await Deno.readTextFile(`${root}bench/${suite}.baseline.json`),
  )
  let dir = `${home}/.cache/yak/bench/best`
  await Deno.mkdir(dir, { recursive: true })
  let path = `${dir}/${suite}.baseline.json`
  let previous: Baseline | undefined
  try {
    previous = JSON.parse(await Deno.readTextFile(path))
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error
  }
  // A protocol change gets its own committed reference, not incomparable old data.
  if (
    previous && ['suite', 'metric', 'workload', 'runtime', 'cpu'].some(
      (key) =>
        previous![key as keyof Baseline] != committed[key as keyof Baseline],
    )
  ) previous = undefined
  let next = previous
    ? {
      ...committed,
      tolerance: 0,
      benches: committed.benches.map((b) => {
        let old = previous!.benches.find((c) => c.name == b.name)
        return {
          ...b,
          tolerance: 0,
          median: old && old.unit == b.unit && old.better == b.better &&
              old.resolution == b.resolution
            ? (b.better == 'lower' ? Math.min : Math.max)(
              old.median,
              b.median,
            )
            : b.median,
        }
      }),
    }
    : {
      ...committed,
      tolerance: 0,
      benches: committed.benches.map((b) => ({ ...b, tolerance: 0 })),
    }
  await bank(path, next)
  return path
}

/** The live web unit, as `systemctl --user` names it. */
let web = async (): Promise<string | undefined> => {
  let { stdout } = await new Deno.Command('systemctl', {
    args: [
      '--user',
      'list-units',
      '--state=active',
      '--plain',
      '--no-legend',
      'yak-web@*.service',
    ],
    stdout: 'piped',
    stderr: 'null',
  }).output()
  return new TextDecoder().decode(stdout).trim().split(/\s+/)[0] || undefined
}

/** A half-hour tick has 25 minutes for the entire queue, not 25 minutes per
 * suite. The remaining five minutes are for reporting/cron dispatch overhead;
 * a change just after a tick is measured or explicitly failed within 55 minutes.
 * No timing reference or benchmark limit is relaxed by this scheduling budget. */
export let WINDOW = 25 * 60_000

/** Command prefix at the process seam. Scheduled lock wait and collection share
 * one timeout, at most the existing check cap. Its ten-second kill grace is
 * inside the absolute deadline. One process group owns this invocation's flock
 * and collection only; it cannot signal the process holding a busy lock. The
 * flock parent keeps the descriptor; detached collectors cannot inherit it. */
export let measurement = (
  suite: string,
  deadline?: number,
  now = Date.now(),
): string[] | undefined => {
  let lock = '/tmp/yaks-throughput-bench.lock'
  let check = [
    'timeout',
    '--kill-after=10',
    HOURLY.includes(suite) ? '600' : '10800',
  ]
  if (deadline === undefined) {
    return [
      'flock',
      '--close',
      '--nonblock',
      '--conflict-exit-code=75',
      lock,
      ...check,
    ]
  }
  let remaining = deadline - now - 10_000
  if (remaining <= 0) return undefined
  return [
    'timeout',
    '--kill-after=10',
    `${
      Math.min(remaining, HOURLY.includes(suite) ? 600_000 : 10_800_000) / 1000
    }s`,
    'flock',
    '--close',
    lock,
  ]
}

/** `deno task bench:check <suite>` in this checkout, read back from the run
 * it writes. */
let check = async (
  suite: string,
  runs?: number,
  deadline?: number,
): Promise<Outcome> => {
  if (MEASURE[suite]) {
    let timed = await new Deno.Command(Deno.execPath(), {
      args: ['run', '-A', ...MEASURE[suite]],
      cwd: root,
      env,
      stdout: 'inherit',
      stderr: 'piped',
    }).output()
    if (!timed.success) {
      let said = new TextDecoder().decode(timed.stderr)
      await Deno.stderr.write(timed.stderr)
      return {
        verdict: 'failed',
        error: said.trim().split('\n').slice(-12).join('\n') ||
          `exit ${timed.code}`,
      }
    }
  }
  let path = await reference(suite)
  let results = `${home}/.cache/yak/bench/${suite}.${Deno.pid}.results.json`
  await Deno.remove(results).catch(() => {})
  // Queue admission owns the tick deadline. Its admitted checks use the
  // unchanged active cap; a busy lock leaves the job owed, not timed out.
  let args = measurement(suite, deadline)
  if (!args) {
    return {
      verdict: 'failed',
      error: 'scheduling deadline missed before lock acquisition',
    }
  }
  let child = await new Deno.Command(args[0], {
    args: [
      ...args.slice(1),
      Deno.execPath(),
      'run',
      '-A',
      'bench/run.ts',
      'check',
      suite,
      `--baseline=${path}`,
      `--output=${results}`,
      '--lock-held',
      ...runs ? [`--runs=${runs}`] : [],
    ],
    cwd: root,
    env,
    stdout: 'inherit',
    stderr: 'piped',
  }).output()
  if (child.code == 75) {
    return deadline === undefined ? { verdict: 'deferred' } : {
      verdict: 'failed',
      error: 'scheduling deadline missed waiting for benchmark lock',
    }
  }
  let said = new TextDecoder().decode(child.stderr)
  await Deno.stderr.write(child.stderr)
  if (child.code == 124 || child.code == 137) {
    return {
      verdict: 'failed',
      error:
        'measurement timed out (including scheduled lock wait); no result accepted' +
        (said.trim()
          ? `\n${said.trim().split('\n').slice(-12).join('\n')}`
          : ''),
    }
  }
  try {
    let run: Run = JSON.parse(await Deno.readTextFile(results))
    if (child.success || run.verdict == 'regressed') {
      if (
        run.verdict == 'regressed' && !runs &&
        ['platform-waits', 'inbox-content'].includes(suite)
      ) {
        let evidence = results.replace('.results.json', '.paired.json')
        let prefix = measurement(suite, deadline)
        if (!prefix) {
          return {
            verdict: 'failed',
            error: 'scheduling deadline missed before paired confirmation',
          }
        }
        let paired = await new Deno.Command(prefix[0], {
          args: [
            ...prefix.slice(1),
            Deno.execPath(),
            'run',
            '-A',
            'bench/paired.ts',
            suite,
            evidence,
          ],
          cwd: root,
          env,
          stdout: 'inherit',
          stderr: 'inherit',
        }).output()
        if (paired.code == 75) return { verdict: 'deferred' }
        if (!paired.success) {
          return {
            verdict: 'failed',
            error: 'Paired measurement failed; raw result retained at ' +
              results,
          }
        }
        let comparison = JSON.parse(await Deno.readTextFile(evidence))
        console.log(
          `${suite}: paired ${comparison.verdict}; raw evidence ${evidence}`,
        )
        if (
          comparison.verdict == 'unconfirmed' ||
          comparison.verdict == 'inconclusive'
        ) {
          return { verdict: comparison.verdict }
        }
      }
      return { verdict: run.verdict as 'passed', run }
    }
  } catch { /* no run was written: the check failed before measuring */ }
  return {
    verdict: 'failed',
    error: said.trim().split('\n').slice(-12).join('\n') ||
      `exit ${child.code}`,
  }
}

if (import.meta.main) {
  let started = Date.now()
  let restarted = Deno.args.includes('--restarted')
  let named = Deno.args.filter((a) => !a.startsWith('--'))
  let state = await load()
  let hourly = Deno.args.includes('--hourly')
  let suites = named.length ? named : hourly ? HOURLY : SUITES
  let restartedWeb = restarted ? await web() : undefined
  if (restarted) {
    if (!restartedWeb || restartedWeb == state.web) Deno.exit(0)
    suites = ['pages', 'page-content']
  }
  let path = configPath()
  let send = reporter(path ? read(path) : {}, undefined, revision(), {
    command: 'bench',
  })
  let monitor: Monitor = {
    check,
    bank: async (suite, run) => {
      let path = await reference(suite)
      let before = await Deno.readTextFile(path)
      await bank(path, baseline(run, 0, JSON.parse(before) as Baseline))
    },
    report: (error, suite, kind) =>
      send(error, {
        fault: `bench ${kind}: ${suite}`,
        during: { kind: 'bench' },
        tags: { job: 'bench', suite },
      }),
    since: async (suite, from) => {
      from ??= await git(
        'log',
        '-1',
        '--format=%H',
        '--',
        `bench/${suite}.baseline.json`,
      )
      let lines = from
        ? (await git('log', '--format=%h %s', `${from}..HEAD`)).split('\n')
          .filter(Boolean)
        : []
      return lines.length > 40
        ? [...lines.slice(0, 40), `… ${lines.length - 40} more`]
        : lines
    },
  }
  let verdicts: Record<string, Outcome['verdict']> = {}
  if (hourly) {
    let queuePath = `${home}/.cache/yak/bench/hourly-queue.json`
    let queue: Queue = { jobs: [], screened: {} }
    try {
      queue = JSON.parse(await Deno.readTextFile(queuePath))
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error
    }
    enqueue(queue, suites, Date.now())
    let persist = async () => {
      let temporary = queuePath + '.' + Deno.pid + '.tmp'
      await Deno.mkdir(`${home}/.cache/yak/bench`, { recursive: true })
      await Deno.writeTextFile(temporary, JSON.stringify(queue, null, 2) + '\n')
      await Deno.rename(temporary, queuePath)
    }
    await drain(queue, {
      now: Date.now,
      deadline: started + WINDOW,
      save: persist,
      check: (job) => check(job.suite, job.phase == 'screen' ? 1 : undefined),
      settle: async (job, outcome) => {
        let found = await watch([job.suite], state, {
          ...monitor,
          check: () => Promise.resolve(outcome),
        })
        Object.assign(verdicts, found)
        let current = await load()
        if (state.good[job.suite]) {
          current.good[job.suite] = state.good[job.suite]
        }
        await save(current)
      },
    })
    console.log(
      `hourly queue: ${queue.jobs.length} pending; unfinished work carries to the next tick`,
    )
  } else verdicts = await watch(suites, state, monitor)
  await send.close()
  // Another run (a restart's, beside the daily one) may have saved since this
  // one loaded: keep what it saw, and add only the suites run here.
  let latest = await load()
  // A contended restart check is still owed on the next tick.
  if (restartedWeb && !Object.values(verdicts).includes('deferred')) {
    latest.web = restartedWeb
  }
  for (let suite of suites) {
    if (state.good[suite]) latest.good[suite] = state.good[suite]
  }
  await save(latest)
  for (let [suite, verdict] of Object.entries(verdicts)) {
    console.log(`${suite}: ${verdict}`)
  }
}
