#!/usr/bin/env -S deno run -A
// Absolute throughput ratchet, separate from bench-gate.ts's hot-path ratios.
import {
  benchmarkNames,
  MODES,
  WORKLOAD_VERSION,
} from '../packages/sqlite/fixtures/fleet.ts'

export const REGRESSION_THRESHOLD = 0.20
export const RUNS = 3
export const METRIC = 'median-of-3-deno-avg-ns'
const BASELINE = 'bench/baseline.json'
const RESULTS = 'bench/results.json'
const FILES = [
  'packages/sqlite/throughput_bench.ts',
  'packages/sqlite/archetype_bench.ts',
  'packages/sql/throughput_bench.ts',
  'packages/query/throughput_bench.ts',
  'src/throughput_bench.ts',
]
export type Measurement = {
  version: number
  metric: string
  workload: number
  runtime: string
  cpu: string
  ns: Record<string, number>
}

export function median(values: number[]): number {
  if (
    values.length != RUNS || values.some((v) => !Number.isFinite(v) || v <= 0)
  ) {
    throw new Error(`Expected ${RUNS} finite, positive measurements`)
  }
  return [...values].sort((a, b) => a - b)[1]
}

export function validateNames(
  ns: Record<string, number>,
  names = benchmarkNames(),
) {
  let actual = Object.keys(ns).sort()
  let expected = [...names].sort()
  if (JSON.stringify(actual) != JSON.stringify(expected)) {
    throw new Error(
      `Benchmark set changed: missing [${
        expected.filter((n) => !(n in ns))
      }]; unexpected [${actual.filter((n) => !expected.includes(n))}]`,
    )
  }
  for (let [name, value] of Object.entries(ns)) {
    if (typeof value != 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error(`Invalid ns/op for ${name}: ${value}`)
    }
  }
}

type Report = {
  version: number
  runtime: string
  cpu: string
  benches: {
    name: string
    results: { ok?: { avg: number }; failed?: unknown }[]
  }[]
}
export function extract(report: Report, names: string[]) {
  if (report.version != 1) {
    throw new Error('Unsupported Deno bench JSON version')
  }
  let ns: Record<string, number> = {}
  for (let bench of report.benches) {
    if (bench.name in ns) throw new Error(`Duplicate bench: ${bench.name}`)
    if (
      bench.results.length != 1 || !bench.results[0].ok ||
      bench.results[0].failed
    ) {
      throw new Error(`Failed or missing result: ${bench.name}`)
    }
    ns[bench.name] = bench.results[0].ok.avg
  }
  validateNames(ns, names)
  return ns
}

export function regressions(base: Measurement, current: Measurement): string[] {
  for (
    let key of ['version', 'metric', 'workload', 'runtime', 'cpu'] as const
  ) {
    if (base[key] !== current[key]) {
      throw new Error(
        `Incomparable ${key}; explicitly bench:ratchet on the target box`,
      )
    }
  }
  validateNames(base.ns)
  validateNames(current.ns)
  return benchmarkNames().filter((name) =>
    current.ns[name] > base.ns[name] * (1 + REGRESSION_THRESHOLD)
  )
}

async function measure() {
  console.error(
    `bench: ${RUNS} samples per benchmark per storage mode (median)`,
  )
  // Best effort: tests do not participate in the throughput lock. Report only
  // pid and subcommand, not arbitrary process arguments (which may be private).
  try {
    let ps = await new Deno.Command('ps', {
      args: ['-eo', 'pid=,args='],
      stdout: 'piped',
      stderr: 'null',
    }).output()
    if (!ps.success) throw new Error('ps failed')
    for (let line of new TextDecoder().decode(ps.stdout).split('\n')) {
      let match = line.match(
        /^\s*(\d+)\s+(?:\S*\/)?deno\s+(bench|test)(?:\s|$)/,
      )
      if (match && Number(match[1]) != Deno.pid) {
        console.error(
          `bench: WARNING: other deno ${
            match[2]
          } process running at start (pid ${
            match[1]
          }); timings may be contended`,
        )
      }
    }
  } catch {
    console.error(
      'bench: WARNING: could not inspect other deno bench/test processes',
    )
  }
  let samples: Record<string, number[]> = Object.fromEntries(
    benchmarkNames().map((n) => [n, []]),
  )
  let runtime = ''
  let cpu = ''
  for (let run = 0; run < RUNS; run++) {
    for (let mode of MODES) {
      console.error(`bench: sample ${run + 1}/${RUNS}, ${mode}`)
      let env: Record<string, string> = {
        DB_PATH: ':memory:',
        BENCH_STORAGE: mode,
        TASKS_SYNC: 'off',
        TASKS_EMBED: '0',
        TASKS_BACKOFF: '',
      }
      if (Deno.build.os == 'linux') {
        env.DENO_SQLITE_PATH = Deno.env.get('DENO_SQLITE_PATH') ??
          'libsqlite3.so.0'
      }
      let child = await new Deno.Command(Deno.execPath(), {
        args: ['bench', '-A', '--json', ...FILES],
        env,
        stdout: 'piped',
        stderr: 'inherit',
      }).output()
      if (!child.success) {
        throw new Error(
          `deno bench failed (${child.code}); no results/baseline written`,
        )
      }
      let report: Report = JSON.parse(new TextDecoder().decode(child.stdout))
      if (runtime && (runtime != report.runtime || cpu != report.cpu)) {
        throw new Error('Runtime/CPU changed between samples')
      }
      runtime = report.runtime
      cpu = report.cpu
      let values = extract(
        report,
        benchmarkNames().filter((n) => n.split('/')[1] == mode),
      )
      for (let [name, ns] of Object.entries(values)) samples[name].push(ns)
    }
  }
  let ns = Object.fromEntries(
    Object.entries(samples).map(([n, v]) => [n, median(v)]),
  )
  validateNames(ns)
  let rev = await new Deno.Command('git', {
    args: ['rev-parse', 'HEAD'],
    stdout: 'piped',
  }).output()
  if (!rev.success) throw new Error('Cannot record source revision')
  let result = {
    version: 1,
    metric: METRIC,
    workload: WORKLOAD_VERSION,
    runtime,
    cpu,
    measuredAt: new Date().toISOString(),
    revision: new TextDecoder().decode(rev.stdout).trim(),
    ns,
    samples,
  }
  return result
}

function write(path: string, value: unknown) {
  // An interrupted run cannot leave a half JSON file looking like a baseline.
  let tmp = `${path}.tmp`
  Deno.writeTextFileSync(tmp, JSON.stringify(value, null, 2) + '\n')
  Deno.renameSync(tmp, path)
}

export async function main(mode = 'run') {
  if (!['run', 'check', 'ratchet'].includes(mode)) {
    throw new Error(`Unknown mode: ${mode}`)
  }
  // Missing/malformed baseline must fail, never silently accept a new floor.
  let base: Measurement | undefined = mode == 'check'
    ? JSON.parse(Deno.readTextFileSync(BASELINE))
    : undefined
  if (base) validateNames(base.ns)
  let current = await measure()
  write(RESULTS, current)
  for (let [name, ns] of Object.entries(current.ns)) {
    console.log(
      `${name.padEnd(30)} ${ns.toFixed(0).padStart(12)} ns/op  ${
        (1e9 / ns).toFixed(1).padStart(10)
      } ops/s`,
    )
  }
  if (mode == 'ratchet') {
    write(BASELINE, current)
    console.log(
      `Explicitly accepted fresh measurements into ${BASELINE}; review and commit the diff.`,
    )
  }
  if (base) {
    let failed = regressions(base, current)
    for (let name of failed) {
      console.error(
        `REGRESSION ${name}: ${
          (100 * (current.ns[name] / base.ns[name] - 1)).toFixed(1)
        }% slower`,
      )
    }
    if (failed.length) {
      throw new Error(
        `${failed.length} benchmarks exceeded REGRESSION_THRESHOLD (${
          REGRESSION_THRESHOLD * 100
        }%)`,
      )
    }
    console.log('bench:check passed; baseline unchanged')
  }
}

if (import.meta.main) await main(Deno.args[0])
