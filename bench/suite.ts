/** Command CPU includes every thread and its finished children.
 * Timing is report-only: the command's status always remains authoritative. */
import { createHash } from 'node:crypto'
import {
  type Baseline,
  host,
  Regressed,
  run,
  stopwatch,
  type Suite,
} from '@yaks/benchmark'
export const VERSION = 2
export type Sample = {
  seconds: number
  cpuSeconds: number
  code: number
  at: string
}
export let suite = (name: string, sample: Sample): Suite => ({
  name: `suite/${name}`,
  metric: 'cpu-seconds',
  workload: VERSION,
  benches: [{
    name: 'cpu',
    unit: 's',
    sample: () => ({
      value: sample.seconds,
      cpu: sample.cpuSeconds,
      source: 'command-cpu',
      details: sample,
    }),
  }],
})
export let paths = (name: string) => {
  let key = encodeURIComponent(name)
  if (key.length > 160) {
    key = key.slice(0, 120) + '-' +
      createHash('sha256').update(name).digest('hex').slice(0, 24)
  }
  return {
    baseline: `bench/suite-${key}.baseline.json`,
    output: `bench/suite-${key}.results.json`,
  }
}
export let record = async (
  name: string,
  sample: Sample,
  options = paths(name),
  accept = false,
) => {
  if (
    [sample.seconds, sample.cpuSeconds].some((n) =>
      !Number.isFinite(n) || n < 0
    )
  ) throw new Error('invalid suite sample')
  let base: (Baseline & { controlFloorSeconds?: number }) | undefined
  try {
    base = JSON.parse(await Deno.readTextFile(options.baseline))
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e
  }
  if (accept && sample.code) {
    throw new Error('Cannot accept a failed command')
  }
  let current
  try {
    current = await run(suite(name, sample), {
      ...options,
      rounds: 1,
      figure: 'cpu',
      mode: accept ? 'accept' : base && !sample.code ? 'check' : 'run',
      tolerance: accept ? .25 : undefined,
      host: async () => ({
        ...await host(),
        runtime: 'command-cpu-v2',
      }),
    })
  } catch (e) {
    if (!(e instanceof Regressed)) throw e
    current = e.result
  }
  return current
}
export async function timed(command: string, args: string[]): Promise<Sample> {
  let took = stopwatch()
  let child = new Deno.Command(command, {
    args,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn()
  let forward = (signal: Deno.Signal) => () => {
    try {
      child.kill(signal)
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e
    }
  }
  let interrupt = forward('SIGINT')
  let terminate = forward('SIGTERM')
  Deno.addSignalListener('SIGINT', interrupt)
  Deno.addSignalListener('SIGTERM', terminate)
  try {
    let status = await child.status
    let reading = took()
    return {
      seconds: reading.value / 1000,
      cpuSeconds: reading.cpu / 1000,
      code: status.code,
      at: new Date().toISOString(),
    }
  } finally {
    Deno.removeSignalListener('SIGINT', interrupt)
    Deno.removeSignalListener('SIGTERM', terminate)
  }
}

/** The suite a run times: its name, and whatever a `deno task` run was
 * handed past its own task. A run narrowed to a path or a platform times less
 * than the whole suite, so it is a suite of its own, and never banks its time
 * as the whole suite's floor nor is judged against it. What the budget does
 * with a run's times (`--write`, bin/test-budget.ts) and how much
 * a run says (`--verbose`) change nothing it runs.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(suiteOf('test', 'deno', ['task', '-q', 'test']), 'test')
 * assertEquals(
 *   suiteOf('test', 'deno', ['task', 'test', '--tag=deno', 'workers']),
 *   'test --tag=deno workers',
 * )
 * assertEquals(suiteOf('ci/tests', 'bash', ['-c', 'x']), 'ci/tests')
 * assertEquals(
 *   suiteOf('test', 'deno', ['task', '-q', 'test', '--all', '--write']),
 *   'test --all',
 * )
 * assertEquals(
 *   suiteOf('test', 'deno', ['task', 'test', '--verbose', 'bin']),
 *   'test bin',
 * )
 * ```
 */
export let suiteOf = (name: string, command: string, args: string[]) => {
  let task = args.findIndex((a, i) => i > 0 && !a.startsWith('-'))
  let rest = args.slice(task + 1).filter((a) => !SAME.includes(a))
  return command == 'deno' && args[0] == 'task' && rest.length
    ? [name, ...rest].join(' ')
    : name
}

// The flags a suite is the same suite without.
let SAME = ['--write', '--verbose']

export let command = async (args: string[]) => {
  let [name, cmd, ...rest] = args
  if (name === '--ci') name = `ci/${Deno.env.get('SUITE_STEP') ?? 'unknown'}`
  else if (Deno.env.get('GITHUB_ACTIONS') === 'true') name = `ci/suite/${name}`
  if (!name || !cmd) {
    throw new Error('usage: bench/run.ts command NAME COMMAND [ARGS...]')
  }
  name = suiteOf(name, cmd, rest)
  let sample = await timed(cmd, rest)
  try {
    let result = await record(
      name,
      sample,
      paths(name),
      Deno.env.get('SUITE_ACCEPT') === '1',
    )
    let message = `benchmark: ${result.suite}: ${
      sample.code ? 'FAILED' : result.verdict.toUpperCase()
    } — ${sample.seconds.toFixed(3)}s wall, ${
      result.benches[0].median.toFixed(3)
    }s CPU`
    // Report-only, so said where a run is read whole: in CI, or on
    // `--verbose`. An agent reads the rest of a run on every later turn.
    if (name.startsWith('ci/') || rest.includes('--verbose')) {
      console.log(message)
    }
    let summary = Deno.env.get('GITHUB_STEP_SUMMARY')
    if (summary) {
      await Deno.writeTextFile(summary, message + '\n\n', { append: true })
    }
  } catch (error) {
    console.error('benchmark: recording failed:', error)
  }
  return sample.code
}
