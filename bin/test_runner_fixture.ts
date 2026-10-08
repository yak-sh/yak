import { until } from '../packages/testing/wait.ts'
import { runTestCommands, type TestCommand } from './phases.ts'

// A runner for test_runner_test.ts to signal, in a process of its own.
// `[stubborn-]<broad|isolated> <dir>` runs two phases
// (test_runner_phase.sh), the named one held open with a grandchild, and ends
// with the signal it was sent. A stubborn run settles on a clock that holds
// until the case writes `release`.

if (import.meta.main) {
  let [phase, dir] = Deno.args
  let stubborn = phase.startsWith('stubborn-')
  let phaseName = phase.replace(/^stubborn-/, '')

  let now = 0
  let released = () => {
    try {
      Deno.statSync(`${dir}/release`)
      return true
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e
      return false
    }
  }
  // Held until the case has sent every signal, then straight to the
  // runner's 2s deadline for SIGKILL; after it, time passes as it does, so
  // the killed group has the runner's whole 2s bound to be reaped in.
  let clock = {
    now: () => now,
    wait: async (ms: number) => {
      await until(released, { timeout: 15_000 })
      if (now < 2_000) now = 2_000
      else {
        await new Promise((go) => setTimeout(go, ms))
        now += ms
      }
      Deno.writeTextFileSync(`${dir}/clock`, String(now))
    },
  }
  let child = (name: string, code?: number): TestCommand => ({
    command: 'bash',
    args: [
      new URL('./test_runner_phase.sh', import.meta.url).pathname,
      `${stubborn ? 'stubborn-' : ''}${name}`,
      dir,
      ...(code === undefined ? [] : [`${code}`]),
    ],
  })
  let commands = phaseName === 'broad'
    ? [child('broad'), child('isolated')]
    : [child('broad', 0), child('isolated')]
  let result = await runTestCommands(commands, {
    terminateOnSignal: true,
    onSignal: (name) =>
      Deno.writeTextFileSync(`${dir}/orchestrator.signals`, `${name}\n`, {
        append: true,
      }),
    ...(stubborn ? { clock } : {}),
  })
  Deno.exit(result.code)
}
