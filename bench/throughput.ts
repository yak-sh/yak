/** Exercise the benchmark runner against the existing throughput workloads.
 * The legacy runner and baseline stay intact until their consumers migrate. */
import { type CollectedSuite, host, run, type Sample } from '@yaks/benchmark'
import { type DenoReport, extract } from '@yaks/benchmark/deno'
import {
  benchmarkNames,
  MODES,
  WORKLOAD_VERSION,
} from '../packages/sqlite/fixtures/fleet.ts'

let files = [
  'packages/sqlite/throughput_bench.ts',
  'packages/sqlite/archetype_bench.ts',
  'packages/sql/throughput_bench.ts',
  'packages/query/throughput_bench.ts',
]
export let throughput = (): CollectedSuite => ({
  name: 'throughput',
  metric: 'median-of-3-deno-avg-ns',
  workload: WORKLOAD_VERSION,
  benches: benchmarkNames().map((name) => ({ name, unit: 'ns/op' })),
  collect: async (round) => {
    let machine = await host()
    let out: Record<string, Sample> = {}
    for (let mode of MODES) {
      console.error(`throughput: round ${round + 1}/3, ${mode}`)
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
        args: ['bench', '-A', '--json', ...files],
        env,
        stdout: 'piped',
        stderr: 'inherit',
      }).output()
      if (!child.success) throw new Error(`deno bench failed (${child.code})`)
      let report: DenoReport = JSON.parse(
        new TextDecoder().decode(child.stdout),
      )
      if (report.runtime != machine.runtime || report.cpu != machine.cpu) {
        throw new Error('Runtime/CPU changed between samples')
      }
      Object.assign(
        out,
        extract(
          report,
          benchmarkNames().filter((name) => name.split('/')[1] == mode),
        ),
      )
    }
    return out
  },
})

if (import.meta.main) {
  let mode = Deno.args[0] ?? 'run'
  if (!['run', 'check', 'accept'].includes(mode)) {
    throw new Error(`Unknown mode: ${mode}`)
  }
  let current = await run(throughput(), {
    mode: mode as 'run' | 'check' | 'accept',
    rounds: 3,
    output: 'bench/throughput.results.json',
    baseline: 'bench/throughput.baseline.json',
    tolerance: mode == 'accept' ? 0.20 : undefined,
    lock: `${Deno.env.get('TMPDIR') ?? '/tmp'}/yaks-throughput-bench.lock`,
  })
  console.log(`throughput: ${current.verdict}`)
}
