/** Storage, apply and relay throughput, with separately collected SQL counts. */
import {
  type CollectedSuite,
  type Host,
  host,
  type Sample,
} from '@yaks/benchmark'
import { type DenoReport, extract } from '@yaks/benchmark/deno'
import { collector } from './collector.ts'
import {
  benchmarkNames as storageNames,
  MODES,
  WORKLOAD_VERSION,
} from '../packages/sqlite/fixtures/fleet.ts'
import {
  applyBenchmarkNames,
  benchmarkNames,
  bundlesPerOp,
  RECORDING_BATCHES,
  relayBenchmarkNames,
} from './names.ts'

let files = [
  'packages/sqlite/throughput_bench.ts',
  'packages/sqlite/archetype_bench.ts',
  'packages/sql/throughput_bench.ts',
  'packages/query/throughput_bench.ts',
]
export let countNames = () => [
  ...applyBenchmarkNames().flatMap((name) =>
    ['sqlPerApply', 'sqlPerBundle'].map((field) => `${name}/${field}`)
  ),
  ...relayBenchmarkNames().flatMap((name) =>
    ['sql', 'reads', 'writes', 'transactions'].map((field) =>
      `${name}/${field}`
    )
  ),
]
type Input = {
  names?: readonly string[]
  recording?: boolean
  filter?: string
  measure?: (mode: string) => Promise<DenoReport>
  counts?: () => Promise<Record<string, Sample>>
  host?: () => Promise<Host>
  /** The checkout whose code it measures; this process's working directory
   * by default. */
  root?: string
}
export let throughput = (input: Input = {}): CollectedSuite => {
  let recording = input.recording ?? false
  let selected = input.filter ? new RegExp(input.filter) : undefined
  let applyNames = applyBenchmarkNames(recording).filter((name) =>
    !selected || selected.test(name)
  )
  let counts: Record<string, Sample> | undefined
  let workers = new Map<string, ReturnType<typeof collector>>()
  let measured = async (mode: string, names: readonly string[]) => {
    if (input.measure) return await input.measure(mode)
    let worker = workers.get(mode)
    if (!worker) {
      worker = measure(mode, input.filter, input.root, names)
      workers.set(mode, worker)
    }
    return await worker.collect() as DenoReport
  }
  return {
    name: 'throughput',
    metric: 'median-of-7-deno-avg-ns',
    workload: `${WORKLOAD_VERSION}/relay-staging-2`,
    benches: [
      ...(recording ? applyNames : benchmarkNames())
        .filter((name) => !input.names || input.names.includes(name)).map((
          name,
        ) => ({
          name,
          unit: name.startsWith('apply/')
            ? 'ns/bundle'
            : name.startsWith('relay/')
            ? 'ns/value'
            : 'ns/op',
        })),
    ],
    collect: async (round) => {
      let machine = await (input.host ?? host)()
      let out: Record<string, Sample> = {}
      let modes = recording
        ? ['recording-unsubscribed', 'recording-subscribed']
        : [...MODES, 'pipeline']
      if (recording && round % 2) modes.reverse()
      for (let mode of modes) {
        let names = mode.startsWith('recording-')
          ? applyNames.filter((name) =>
            name.endsWith('/subscribed') == (mode == 'recording-subscribed')
          )
          : mode == 'pipeline'
          ? [...applyBenchmarkNames(), ...relayBenchmarkNames()]
          : storageNames().filter((name) => name.split('/')[1] == mode)
        names = names.filter((name) =>
          !input.names || input.names.includes(name)
        )
        if (!names.length) continue
        console.error(`throughput: round ${round + 1}/7, ${mode}`)
        let report = await measured(mode, names)
        if (report.runtime != machine.runtime || report.cpu != machine.cpu) {
          throw new Error('Runtime/CPU changed between samples')
        }
        Object.assign(out, extract(report, names))
      }
      for (let [name, sample] of Object.entries(out)) {
        let operations = bundlesPerOp(name) *
          (recording ? RECORDING_BATCHES : 1)
        sample.value /= operations
        if (sample.cpu !== undefined) sample.cpu /= operations
      }
      if (recording) return out
      counts ??=
        await (input.counts ?? (() => measureCounts(input.root, input.names)))()
      for (let [name, sample] of Object.entries(out)) {
        sample.counts = Object.fromEntries(
          Object.entries(counts).filter(([key]) => key.startsWith(`${name}/`))
            .map(([key, value]) => [key.slice(name.length + 1), value.value]),
        )
      }
      return out
    },
    close: async () => {
      await Promise.all([...workers.values()].map((worker) => worker.close()))
    },
  }
}
let measure = (
  mode: string,
  filter?: string,
  root?: string,
  names?: readonly string[],
) => {
  let env: Record<string, string> = {
    BENCH_RECORDING: mode.startsWith('recording-')
      ? mode.slice('recording-'.length)
      : '0',
    ...filter ? { BENCH_FILTER: filter } : {},
    ...names ? { BENCH_NAMES: JSON.stringify(names) } : {},
    DB_PATH: ':memory:',
    BENCH_STORAGE: mode,
    TASKS_SYNC: 'off',
    TASKS_EMBED: '0',
    TASKS_BACKOFF: '',
  }
  if (Deno.build.os == 'linux') {
    env.DENO_SQLITE_PATH = Deno.env.get('DENO_SQLITE_PATH') ?? 'libsqlite3.so.0'
  }
  let paths = mode.startsWith('recording-')
    ? ['bench/apply_bench.ts']
    : mode == 'pipeline'
    ? ['bench/apply_bench.ts', 'bench/relay_bench.ts']
    : files
  paths = paths.filter((path) =>
    !names || names.some((name) => {
      let prefix = path.includes('archetype_bench')
        ? 'archetype'
        : path.startsWith('packages/')
        ? path.split('/')[1]
        : path.includes('apply_bench')
        ? 'apply'
        : 'relay'
      return name.startsWith(`${prefix}/`)
    })
  )
  return collector(
    ['bench/deno-worker.ts', ...paths],
    root,
    env,
  )
}
let measureCounts = async (root?: string, names?: readonly string[]) => {
  let out: Record<string, Sample> = {}
  for (let file of ['bench/apply-fixture.ts', 'bench/relay-fixture.ts']) {
    let prefix = file.includes('apply-fixture') ? 'apply/' : 'relay/'
    if (names && !names.some((name) => name.startsWith(prefix))) continue
    let child = await new Deno.Command(Deno.execPath(), {
      args: ['run', '-A', file, '--counts'],
      cwd: root,
      stdout: 'piped',
      stderr: 'inherit',
    }).output()
    if (!child.success) throw new Error(`Statement counts failed: ${file}`)
    let by: Record<string, Record<string, number>> = JSON.parse(
      new TextDecoder().decode(child.stdout),
    )
    for (let [name, fields] of Object.entries(by)) {
      for (let [field, value] of Object.entries(fields)) {
        out[`${name}/${field}`] = { value, source: 'statement-count' }
      }
    }
  }
  return out
}
