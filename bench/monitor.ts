/** Runs the box's bench suites on their own and tells the tracker when one has
 * become slower, so @yaks/heal sends it to an agent like any other bug. It is
 * monitoring, not a gate: nothing waits on it and nothing is refused.
 *
 * Each suite is screened against its banked baseline with one run
 * (`deno task bench:check <suite> --runs=1`). A regression counts only when a
 * check taken as the baseline was banked confirms it: each bench's best median
 * of three runs, so one slow run on a busy box reports nothing. A confirmed
 * one is reported with every
 * figure over its limit, the run's load, and the commits since the suite's
 * last good run; a suite that cannot run (no baseline, a crash, a page that
 * never paints) is reported as a failure. Each suite reports under one fault,
 * so a suite that stays slow adds hits to its open bug, and one that turns
 * slow again after its bug was resolved reopens it.
 *
 * The box runs this from cron: every suite once a day, and `--hourly`
 * every 30 minutes for user-facing waits; `--restarted` every 15 minutes
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
import { configPath, read } from '../packages/cli/config.ts'
import { reporter, revision } from '../packages/cli/report.ts'

/** Every suite this box measures itself; the CI and platform deploy suites are
 * timed where they run. */
export let SUITES = [
  'pages',
  'page-content',
  'inbox-content',
  'person-commands',
  'platform-waits',
  'worker-health',
  'web-client',
  'client-frame',
  'client-rules',
  'session-status',
  'graph-activity',
  'relay-admission',
  'harness-startup',
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
  'platform-waits',
  'worker-health',
]

/** Deploy checks need fresh observations before comparison. */
export let MEASURE: Record<string, string[]> = {
  'app-deploy': ['bench/run.ts', 'app-deploy', 'time'],
}

/** One suite's check: its run, or why it could not run. */
export type Outcome =
  | { verdict: 'passed' | 'measured' | 'regressed'; run: Run }
  | { verdict: 'failed'; error: string }
export type Good = { commit: string; at: string }
export type State = { web?: string; good: Record<string, Good> }
export type Monitor = {
  /** One check of a suite, over `runs` runs, else as its baseline was banked. */
  check: (suite: string, runs?: number) => Promise<Outcome>
  report: (
    error: Error,
    suite: string,
    kind: 'regressed' | 'failed',
  ) => Promise<void>
  /** Commits after `from` up to the checkout's head, one line each. */
  since: (suite: string, from?: string) => Promise<string[]>
  bank?: (suite: string, run: Run) => Promise<void>
}

let figure = (n: number, unit: string) =>
  `${n.toLocaleString('en-US', { maximumFractionDigits: 1 })} ${unit}`
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
): Promise<Record<string, Outcome['verdict']>> => {
  let out: Record<string, Outcome['verdict']> = {}
  for (let suite of suites) {
    let safe = async (runs?: number): Promise<Outcome> => {
      try {
        return await m.check(suite, runs)
      } catch (error) {
        return {
          verdict: 'failed',
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }
    let outcome = await safe(1)
    if (outcome.verdict == 'regressed') outcome = await safe()
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

/** `deno task bench:check <suite>` in this checkout, read back from the run
 * it writes. */
let check = async (suite: string, runs?: number): Promise<Outcome> => {
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
  let child = await new Deno.Command('timeout', {
    args: [
      '--kill-after=10',
      HOURLY.includes(suite) ? '600' : '10800',
      Deno.execPath(),
      'run',
      '-A',
      'bench/run.ts',
      'check',
      suite,
      `--baseline=${path}`,
      `--output=${results}`,
      ...runs ? [`--runs=${runs}`] : [],
    ],
    cwd: root,
    env,
    stdout: 'inherit',
    stderr: 'piped',
  }).output()
  let said = new TextDecoder().decode(child.stderr)
  await Deno.stderr.write(child.stderr)
  try {
    let run: Run = JSON.parse(await Deno.readTextFile(results))
    if (child.success || run.verdict == 'regressed') {
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
  let restarted = Deno.args.includes('--restarted')
  let named = Deno.args.filter((a) => !a.startsWith('--'))
  let state = await load()
  let hourly = Deno.args.includes('--hourly')
  let suites = named.length ? named : hourly ? HOURLY : SUITES
  if (restarted) {
    let now = await web()
    if (!now || now == state.web) Deno.exit(0)
    state.web = now
    await save(state)
    suites = ['pages', 'page-content']
  }
  let path = configPath()
  let send = reporter(path ? read(path) : {}, undefined, revision(), {
    command: 'bench',
  })
  let verdicts = await watch(suites, state, {
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
  })
  await send.close()
  // Another run (a restart's, beside the daily one) may have saved since this
  // one loaded: keep what it saw, and add only the suites run here.
  let latest = await load()
  for (let suite of suites) {
    if (state.good[suite]) latest.good[suite] = state.good[suite]
  }
  await save(latest)
  for (let [suite, verdict] of Object.entries(verdicts)) {
    console.log(`${suite}: ${verdict}`)
  }
}
