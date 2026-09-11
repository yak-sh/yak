// One bundle and kernel runtime; parallel probes have private binding names.
import { probeSuite } from '../workers/yak/probe-suite.ts'
import { runTestCommands } from './test.ts'

let suite = await probeSuite()
try {
  let result = await runTestCommands([{
    command: Deno.execPath(),
    args: [
      'test',
      '--frozen',
      '--no-check',
      '-A',
      '--parallel',
      '--unstable-net',
      '--unstable-worker-options',
      ...(Deno.args.length ? Deno.args : ['workers/yak/', 'workers/yak-tail/']),
    ],
    env: { ...suite.env, TASKS_SLOW: '1' },
  }], { terminateOnSignal: false })
  Deno.exitCode = result.code ?? (result.signal === 'SIGINT' ? 130 : 143)
} finally {
  await suite.stop()
}
