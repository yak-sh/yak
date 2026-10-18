/** Package workloads and relay admission collected into benchmark suites.
 * Each suite declares its own baseline path and retains its timed boundaries. */
import { type CollectedSuite, host, type Samples } from '@yaks/benchmark'
import { type DenoReport, extract } from '@yaks/benchmark/deno'
import { RELAY_ENTITIES } from './names.ts'
import { contentSuite, suite as pages } from './pages.ts'
import { suite as platformWaits } from './platform-waits.ts'
import { suite as workerHealth } from './worker-health.ts'
import { suite as inboxContent } from './inbox-content.ts'
import { PERSON_COMMANDS } from './person-commands.ts'
import { HOOK_WAITS } from './hook-waits.ts'
import { OPERATION_COMMANDS } from './operation-commands.ts'
import { TERMINAL_INTERACTIONS } from './terminal-interactions.ts'
import { OPERATION_SCALE } from './operation-scale.ts'

let deno = (
  name: string,
  file: string,
  names: string[],
): Registration => registration(name, file, names, 'ns/op', true)
let measured = (
  name: string,
  file: string,
  names: string[],
  unit = 'ms',
): Registration => registration(name, file, names, unit, false)

export type Registration = {
  baseline: string
  suite: (args?: string[]) => CollectedSuite
  /** The least slack its benches bank, where its drift over a day exceeds
   * the box's usual (`FLOOR` in ./run.ts). */
  floor?: number
}

let registration = (
  name: string,
  file: string,
  names: string[],
  unit: string,
  deno: boolean,
): Registration => ({
  baseline: `bench/${name}.baseline.json`,
  suite: (args = []) => ({
    name,
    metric: deno ? 'median-of-deno-averages' : 'median-of-round-medians',
    workload: name == 'graph-activity'
      ? JSON.stringify([
        1,
        Deno.env.get('BENCH_N') ?? '3000',
        Deno.env.get('BASE_GRAPH') ?? 'same-build',
      ])
      : args.length
      ? JSON.stringify([name == 'relay-admission' ? 2 : 1, ...args])
      : name == 'relay-admission'
      ? 2
      : 1,
    benches: names.map((name) => ({ name, unit })),
    collect: async () => {
      let child = await new Deno.Command(Deno.execPath(), {
        args: deno
          ? ['bench', '-A', '--json', file]
          : ['run', '-A', 'bench/standalone-worker.ts', file, ...args],
        stdout: 'piped',
        stderr: 'inherit',
      }).output()
      if (!child.success) throw new Error(`${name} failed (${child.code})`)
      let report = JSON.parse(new TextDecoder().decode(child.stdout))
      if (!deno) return report as Record<string, Samples>
      let machine = await host()
      let imported = report as DenoReport
      if (imported.runtime != machine.runtime || imported.cpu != machine.cpu) {
        throw new Error('Runtime/CPU changed between samples')
      }
      return extract(imported, names)
    },
  }),
})

export let standalone: Registration[] = [
  {
    baseline: 'bench/inbox-content.baseline.json',
    suite: inboxContent,
    floor: 0,
  },
  measured('hook-waits', 'bench/hook-waits.ts', HOOK_WAITS),
  measured(
    'operation-commands',
    'bench/operation-commands.ts',
    OPERATION_COMMANDS,
  ),
  measured(
    'terminal-interactions',
    'bench/terminal-interactions.ts',
    TERMINAL_INTERACTIONS,
  ),
  measured('operation-scale', 'bench/operation-scale.ts', OPERATION_SCALE),
  measured('person-commands', 'bench/person-commands.ts', [...PERSON_COMMANDS]),
  {
    baseline: 'bench/worker-health.baseline.json',
    suite: workerHealth,
    floor: 0,
  },
  {
    baseline: 'bench/platform-waits.baseline.json',
    suite: platformWaits,
    floor: 0,
  },
  deno('client-frame', 'packages/client/frame_bench.ts', [
    'frame: 50k-entity world, 208 bundles, 3 reads, 40 watches',
    'part: one patch (the local player steps)',
    'part: a 200-bundle batch (the simulation)',
    'part: what is near (range over creatures)',
    'part: what lies at its feet (range over items)',
    'part: what a player carries (a reference)',
    'part: what is alive (a property over one component)',
  ]),
  deno('client-rules', 'packages/client/rules_bench.ts', [
    'keystroke, no rules',
    'keystroke, four rules',
  ]),
  measured('harness-startup', 'packages/harness/startup_bench.ts', [
    'open',
    'agent',
    'sessions',
    'transcriptRead',
    'close',
    'remoteReady',
    'resume',
    'remoteSessions',
    'remoteTranscript',
    'mount',
    'selectedPaintAfterRead',
    'remoteClose',
  ]),
  measured('harness-streaming', 'packages/harness/streaming_bench.ts', [
    'apply',
    'transient',
  ]),
  measured(
    'harness-worker',
    'packages/harness/worker_bench.ts',
    ['inline', 'worker'].flatMap((mode) =>
      ['startup', 'work', 'timer-delay'].map((phase) => `${mode}/${phase}`)
    ),
  ),
  measured(
    'harness-window',
    'packages/harness/window_bench.ts',
    ['full', 'window'].flatMap((mode) =>
      ['first', 'warm', 'timer-delay'].map((phase) => `${mode}/${phase}`)
    ),
  ),
  measured('harness-switch', 'packages/harness/switch_bench.ts', [
    'switch',
    'timer-delay',
  ]),
  measured(
    'graph-activity',
    'packages/graph/activity_bench.ts',
    ['absent', 'uncreated', 'inactive'].flatMap((mode) =>
      ['apply', 'query'].map((operation) => `${mode}/${operation}`)
    ),
    'ns/op',
  ),
  deno('session-status', 'packages/session/status_bench.ts', [
    'status by identity beside 2,700 other calls',
    'status by query beside 2,700 other calls',
  ]),
  deno('web-client', 'packages/browse/client_bench.ts', [
    'rows: 2k-task snapshot',
    'query: filter 2k rows (a board render)',
    'applyLocal: fold a working-set seed into the cache',
    'resetSignals: rebuild every index from the cache',
  ]),
  measured(
    'relay-admission',
    'bench/relay-admission.ts',
    RELAY_ENTITIES.flatMap((entities) =>
      ['store-relay', 'graph-full-check'].map((variant) =>
        `${variant}/${entities}-entities`
      )
    ),
    'us/value',
  ),
  { baseline: 'bench/pages.baseline.json', suite: pages, floor: 0 },
  {
    baseline: 'bench/page-content.baseline.json',
    suite: contentSuite,
    floor: 0,
  },
]

/** A bench file remains a convenient entry point for the shared CLI. */
export let standaloneMain = async (name: string): Promise<void> => {
  let child = await new Deno.Command(Deno.execPath(), {
    args: [
      'run',
      '-A',
      new URL('./run.ts', import.meta.url).pathname,
      name,
      ...(Deno.args.length ? ['--', ...Deno.args] : []),
    ],
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn().status
  Deno.exit(child.code)
}
