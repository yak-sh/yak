#!/usr/bin/env -S deno run -A
// Report-only wall-clock ratchet. Never replace a command's exit status with
// a timing verdict. See bench/suites.md for measurement limits and acceptance.
export const VERSION = 1
export type Sample = {
  seconds: number
  controlSeconds: number
  samples: number
  code: number
  at: string
}
export type Baseline = {
  ratio: number
  controlFloorSeconds: number
  seconds?: number // observed wall-clock when this ratio was banked
}
export type Verdict =
  | 'NEW'
  | 'ACCEPTED'
  | 'REGRESSION'
  | 'IMPROVED'
  | 'HELD'
  | 'FAILED'
export function ratchet(
  sample: Sample,
  baseline: Baseline | undefined,
  tolerance = 0.25,
  accept = false,
): { verdict: Verdict; baseline?: Baseline; ratio: number; loaded: boolean } {
  for (let n of [sample.seconds, sample.controlSeconds, sample.samples]) {
    if (!Number.isFinite(n) || n <= 0) throw new Error('invalid suite sample')
  }
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error('invalid SUITE_TOL')
  }
  if (
    baseline &&
    [baseline.ratio, baseline.controlFloorSeconds].some((n) =>
      !Number.isFinite(n) || n <= 0
    )
  ) {
    throw new Error('invalid suite baseline')
  }
  let ratio = sample.seconds / sample.controlSeconds
  let floor = Math.min(
    baseline?.controlFloorSeconds ?? Infinity,
    sample.controlSeconds,
  )
  let loaded = sample.controlSeconds > floor * 1.5
  if (sample.code !== 0) return { verdict: 'FAILED', baseline, ratio, loaded }
  if (accept || !baseline) {
    return {
      verdict: accept ? 'ACCEPTED' : 'NEW',
      baseline: {
        ratio,
        controlFloorSeconds: sample.controlSeconds,
        seconds: sample.seconds,
      },
      ratio,
      loaded,
    }
  }
  if (ratio > baseline.ratio * (1 + tolerance)) {
    return { verdict: 'REGRESSION', baseline, ratio, loaded }
  }
  return {
    verdict: ratio < baseline.ratio && !loaded ? 'IMPROVED' : 'HELD',
    baseline: {
      ...baseline,
      ...(ratio < baseline.ratio && !loaded ? { seconds: sample.seconds } : {}),
      ratio: loaded ? baseline.ratio : Math.min(baseline.ratio, ratio),
      controlFloorSeconds: floor,
    },
    ratio,
    loaded,
  }
}

type Row = {
  baseline?: Baseline
  latest?: Sample & { ratio: number; verdict: Verdict; loaded: boolean }
}
type Results = {
  version: number
  metric: string
  tolerance: number
  suites: Record<string, Row>
}

export function record(path: string, name: string, sample: Sample): string {
  let tolerance = Number(Deno.env.get('SUITE_TOL') ?? '0.25')
  let read = (file: string) => {
    try {
      return JSON.parse(Deno.readTextFileSync(file))
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error
      return undefined
    }
  }
  let baselinePath = path.replace(/[^/]+$/, 'suite.baseline.json')
  let document = read(path) ?? {}
  let results: Results = read(baselinePath) ?? {
    version: VERSION,
    metric: '',
    tolerance,
    suites: {},
  }
  let reset = results.version !== VERSION
  if (reset) results.suites = {}
  if (!reset && document.suiteTimings?.version === VERSION) {
    for (
      let [key, row] of Object.entries(document.suiteTimings.suites) as [
        string,
        Row,
      ][]
    ) {
      results.suites[key] = { ...row, baseline: results.suites[key]?.baseline }
    }
  }
  results.version = VERSION
  results.metric = 'wall-seconds / mean-concurrent-8M-LCG-seconds'
  results.tolerance = tolerance
  let previous = results.suites[name]?.baseline
  let result = ratchet(
    sample,
    previous,
    tolerance,
    Deno.env.get('SUITE_ACCEPT') === '1',
  )
  results.suites[name] = {
    baseline: result.baseline,
    latest: {
      ...sample,
      ratio: result.ratio,
      verdict: result.verdict,
      loaded: result.loaded,
    },
  }
  // Read/modify/write has no awaits; nested CI/suite wrappers write in order.
  // Use a separate SUITE_RESULTS path for independent simultaneous invocations.
  let write = (file: string, value: unknown) => {
    let temporary = `${file}.${Deno.pid}.tmp`
    Deno.writeTextFileSync(temporary, JSON.stringify(value, null, 2) + '\n')
    Deno.renameSync(temporary, file)
  }
  document.suiteTimings = results
  write(path, document)
  // The ignored results file holds observations; only floors are committed.
  write(baselinePath, {
    version: VERSION,
    metric: results.metric,
    tolerance,
    suites: Object.fromEntries(
      Object.entries(results.suites).map((
        [key, row],
      ) => [key, { baseline: row.baseline }]),
    ),
  })
  let delta = previous
    ? ` (${((result.ratio / previous.ratio - 1) * 100).toFixed(1)}%)`
    : ''
  return `suite-time: ${name}: ${result.verdict} — ${
    sample.seconds.toFixed(3)
  }s, ratio ${result.ratio.toFixed(3)}${delta}, tolerance +${
    tolerance * 100
  }%` +
    (result.loaded ? ' (loaded; no improvement banked)' : '') +
    (reset ? ' (metric changed; re-baselined)' : '')
}

export async function timed(command: string, args: string[]): Promise<Sample> {
  let worker = new Worker(new URL('./suite-control.ts', import.meta.url).href, {
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

if (import.meta.main) {
  let [name, command, ...args] = Deno.args
  // CI's custom shell supplies the step name via env, and a script path as {0}.
  if (name === '--ci') name = `ci/${Deno.env.get('SUITE_STEP') ?? 'unknown'}`
  else if (Deno.env.get('GITHUB_ACTIONS') === 'true') name = `ci/suite/${name}`
  if (!name || !command) {
    throw new Error('usage: suite-time.ts NAME COMMAND [ARGS...]')
  }
  let sample = await timed(command, args)
  try {
    let message = record(
      Deno.env.get('SUITE_RESULTS') ?? 'bench/results.json',
      name,
      sample,
    )
    console.log(message)
    let summary = Deno.env.get('GITHUB_STEP_SUMMARY')
    if (summary) {
      Deno.writeTextFileSync(summary, message + '\n\n', { append: true })
    }
  } catch (error) {
    console.error('suite-time: recording failed:', error)
  }
  Deno.exit(sample.code)
}
