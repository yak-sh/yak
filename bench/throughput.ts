/** Storage, apply and relay throughput, with separately collected SQL counts. */
import {
  type CollectedSuite,
  type Host,
  host,
  type Sample,
} from '@yaks/benchmark'
import { type DenoReport, extract } from '@yaks/benchmark/deno'
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
  recording?: boolean
  filter?: string
  measure?: (mode: string) => Promise<DenoReport>
  counts?: () => Promise<Record<string, Sample>>
  host?: () => Promise<Host>
}
export let throughput = (input: Input = {}): CollectedSuite => {
  let recording = input.recording ?? false
  let selected = input.filter ? new RegExp(input.filter) : undefined
  let applyNames = applyBenchmarkNames(recording).filter((name) =>
    !selected || selected.test(name)
  )
  let counts: Record<string, Sample> | undefined
  return {
    name: 'throughput',
    metric: 'median-of-7-deno-avg-ns',
    workload: WORKLOAD_VERSION,
    benches: [
      ...(recording ? applyNames : benchmarkNames()).map((name) => ({
        name,
        unit: name.startsWith('apply/')
          ? 'ns/bundle'
          : name.startsWith('relay/')
          ? 'ns/value'
          : 'ns/op',
      })),
      ...(recording ? [] : countNames()).map((name) => ({
        name,
        unit: 'statements',
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
        console.error(`throughput: round ${round + 1}/7, ${mode}`)
        let report = await (input.measure ?? ((mode) =>
          measure(mode, input.filter)))(
            mode,
          )
        if (report.runtime != machine.runtime || report.cpu != machine.cpu) {
          throw new Error('Runtime/CPU changed between samples')
        }
        let names = mode.startsWith('recording-')
          ? applyNames.filter((name) =>
            name.endsWith('/subscribed') == (mode == 'recording-subscribed')
          )
          : mode == 'pipeline'
          ? [...applyBenchmarkNames(), ...relayBenchmarkNames()]
          : storageNames().filter((name) => name.split('/')[1] == mode)
        Object.assign(out, extract(report, names))
      }
      for (let [name, sample] of Object.entries(out)) {
        sample.value /= bundlesPerOp(name) * (recording ? RECORDING_BATCHES : 1)
      }
      if (recording) return out
      counts ??= await (input.counts ?? measureCounts)()
      return { ...out, ...counts }
    },
  }
}
let measure = async (mode: string, filter?: string): Promise<DenoReport> => {
  let env: Record<string, string> = {
    BENCH_RECORDING: mode.startsWith('recording-')
      ? mode.slice('recording-'.length)
      : '0',
    DB_PATH: ':memory:',
    BENCH_STORAGE: mode,
    TASKS_SYNC: 'off',
    TASKS_EMBED: '0',
    TASKS_BACKOFF: '',
  }
  if (Deno.build.os == 'linux') {
    env.DENO_SQLITE_PATH = Deno.env.get('DENO_SQLITE_PATH') ?? 'libsqlite3.so.0'
  }
  let child = await new Deno.Command(Deno.execPath(), {
    args: [
      'bench',
      '-A',
      '--json',
      ...(mode.startsWith('recording-') && filter
        ? ['--filter', `/${filter}/`]
        : []),
      ...(mode.startsWith('recording-')
        ? ['bench/apply_bench.ts']
        : mode == 'pipeline'
        ? ['bench/apply_bench.ts', 'bench/relay_bench.ts']
        : files),
    ],
    env,
    stdout: 'piped',
    stderr: 'inherit',
  }).output()
  if (!child.success) throw new Error(`deno bench failed (${child.code})`)
  return JSON.parse(new TextDecoder().decode(child.stdout))
}
let measureCounts = async () => {
  let out: Record<string, Sample> = {}
  for (let file of ['bench/apply-fixture.ts', 'bench/relay-fixture.ts']) {
    let child = await new Deno.Command(Deno.execPath(), {
      args: ['run', '-A', file, '--counts'],
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
