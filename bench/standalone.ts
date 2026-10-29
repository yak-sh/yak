/** Package workloads and relay admission collected into benchmark suites.
 * Each suite declares its own baseline path and retains its timed boundaries. */
import { CHECKOUT_NAMES } from './operation-checkout.ts'
import { DIAGNOSTIC_NAMES } from './operation-diagnostics.ts'
import { LIFECYCLE_NAMES } from './operation-lifecycle.ts'
import { NAMES as SESSION_NAMES } from './operation-sessions.ts'
import { type CollectedSuite, host, type Samples } from '@yaks/benchmark'
import { type DenoReport, extract } from '@yaks/benchmark/deno'
import { RELAY_ENTITIES } from './names.ts'
import { suite as platformWaits } from './platform-waits.ts'
import { suite as workerHealth } from './worker-health.ts'
import { PERSON_COMMANDS } from './person-commands.ts'
import { HOOK_WAITS } from './hook-waits.ts'
import { OPERATION_COMMANDS } from './operation-commands.ts'
import { TERMINAL_INTERACTIONS } from './terminal-interactions.ts'
import { OPERATION_SCALE } from './operation-scale.ts'
import { CONTROL_NAMES } from './operation-controls.ts'
import { OPERATION_REMAINING } from './operation-remaining.ts'

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
  /** The suite, measuring the code checked out at `root`, this checkout's by
   * default: bench/paired.ts measures an older revision's beside it. */
  suite: (args?: string[], root?: string) => CollectedSuite
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
  suite: (args = [], root) => ({
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
          ? ['run', '-A', 'bench/deno-worker.ts', file]
          : ['run', '-A', 'bench/standalone-worker.ts', file, ...args],
        cwd: root,
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
  measured(
    'operation-remaining',
    'bench/operation-remaining.ts',
    OPERATION_REMAINING,
  ),
  measured('operation-checkout', 'bench/operation-checkout.ts', CHECKOUT_NAMES),
  measured('operation-controls', 'bench/operation-controls.ts', CONTROL_NAMES),
  measured(
    'operation-diagnostics',
    'bench/operation-diagnostics.ts',
    DIAGNOSTIC_NAMES,
  ),
  measured(
    'operation-lifecycle',
    'bench/operation-lifecycle.ts',
    LIFECYCLE_NAMES,
  ),
  measured('operation-sessions', 'bench/operation-sessions.ts', SESSION_NAMES),
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
  {
    ...measured('harness-steps', 'packages/harness/steps_bench.ts', [
      'no-tools',
      'tool-step',
    ]),
    baseline: 'packages/harness/steps.baseline.json',
  },
  measured('harness-streaming', 'packages/harness/streaming_bench.ts', [
    'apply',
    'transient',
  ]),
  measured(
    'harness-worker',
    'packages/harness/worker_bench.ts',
    ['inline', 'worker'].flatMap((mode) =>
      ['startup', 'work'].map((phase) => `${mode}/${phase}`)
    ),
  ),
  measured(
    'harness-window',
    'packages/harness/window_bench.ts',
    ['full', 'window'].flatMap((mode) =>
      ['first', 'warm'].map((phase) => `${mode}/${phase}`)
    ),
  ),
  measured('harness-switch', 'packages/harness/switch_bench.ts', [
    'switch',
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
]
