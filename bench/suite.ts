/** Wall-clock commands normalized by a concurrent fixed CPU yardstick.
 * Timing is report-only: the command's status always remains authoritative. */
import { createHash } from 'node:crypto'
import {
  type Baseline,
  host,
  Regressed,
  run,
  type Suite,
} from '@yaks/benchmark'
export const VERSION = 1
export type Sample = {
  seconds: number
  controlSeconds: number
  samples: number
  code: number
  at: string
}
export let suite = (name: string, sample: Sample): Suite => ({
  name: `suite/${name}`,
  metric: 'wall-seconds / mean-concurrent-8M-LCG-seconds',
  workload: VERSION,
  benches: [{
    name: 'wall/control',
    unit: 'ratio',
    sample: () => ({
      value: sample.seconds / sample.controlSeconds,
      source: 'concurrent-control',
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
    [sample.seconds, sample.controlSeconds, sample.samples].some((n) =>
      !Number.isFinite(n) || n <= 0
    )
  ) throw new Error('invalid suite sample')
  let base: (Baseline & { controlFloorSeconds?: number }) | undefined
  try {
    base = JSON.parse(await Deno.readTextFile(options.baseline))
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e
  }
  let loaded = !!base?.controlFloorSeconds &&
    sample.controlSeconds > base.controlFloorSeconds * 1.5
  if (accept && (sample.code || loaded)) {
    throw new Error('Cannot accept a failed or loaded command')
  }
  let current
  try {
    current = await run(suite(name, sample), {
      ...options,
      rounds: 1,
      mode: accept ? 'accept' : base && !sample.code ? 'check' : 'run',
      tolerance: accept ? .25 : undefined,
      host: async () => ({
        ...await host(),
        runtime: 'control-v1',
        cpu: 'load-normalized',
      }),
    })
  } catch (e) {
    if (!(e instanceof Regressed)) throw e
    current = e.result
  }
  if (accept) {
    let banked = JSON.parse(await Deno.readTextFile(options.baseline))
    banked.controlFloorSeconds = sample.controlSeconds
    await Deno.writeTextFile(
      options.baseline,
      JSON.stringify(banked, null, 2) + '\n',
    )
  }
  return { ...current, loaded }
}
export async function timed(command: string, args: string[]): Promise<Sample> {
  let worker = new Worker(new URL('./control.ts', import.meta.url).href, {
    type: 'module',
  })
  let controls: number[] = []
  try {
    await new Promise<void>((resolve, reject) => {
      worker.onerror = (event) => reject(new Error(event.message))
      worker.onmessage = ({ data }) => {
        if (data.ready) resolve()
        if (data.seconds) controls.push(data.seconds)
      }
    })
    let start = performance.now()
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
      let seconds = (performance.now() - start) / 1000
      // A short command can finish before the first control message arrives.
      while (!controls.length) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      return {
        seconds,
        controlSeconds: controls.reduce((a, b) => a + b, 0) / controls.length,
        samples: controls.length,
        code: status.code,
        at: new Date().toISOString(),
      }
    } finally {
      Deno.removeSignalListener('SIGINT', interrupt)
      Deno.removeSignalListener('SIGTERM', terminate)
    }
  } finally {
    worker.terminate()
  }
}

/** The suite a run times: its name, and whatever a `deno task` run was
 * handed past its own task. A run narrowed to a path or a platform times less
 * than the whole suite, so it is a suite of its own, and never banks its time
 * as the whole suite's floor nor is judged against it. Where a run writes its
 * times (`--times`) changes nothing it runs.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(suiteOf('test', 'deno', ['task', 'test:run']), 'test')
 * assertEquals(
 *   suiteOf('test', 'deno', ['task', 'test:run', '--tag=deno', 'workers']),
 *   'test --tag=deno workers',
 * )
 * assertEquals(suiteOf('ci/tests', 'bash', ['-c', 'x']), 'ci/tests')
 * assertEquals(
 *   suiteOf('test', 'deno', ['task', 'test:run', '--all', '--times=/tmp/t']),
 *   'test --all',
 * )
 * ```
 */
export let suiteOf = (name: string, command: string, args: string[]) => {
  let rest = args.slice(2).filter((a) => !a.startsWith('--times='))
  return command == 'deno' && args[0] == 'task' && rest.length
    ? [name, ...rest].join(' ')
    : name
}

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
    } — ${sample.seconds.toFixed(3)}s, ratio ${
      result.benches[0].median.toFixed(3)
    }${result.loaded ? ' (loaded)' : ''}`
    console.log(message)
    let summary = Deno.env.get('GITHUB_STEP_SUMMARY')
    if (summary) {
      await Deno.writeTextFile(summary, message + '\n\n', { append: true })
    }
  } catch (error) {
    console.error('benchmark: recording failed:', error)
  }
  return sample.code
}
