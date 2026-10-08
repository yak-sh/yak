import { until } from '@yaks/testing'
import { runTestCommands, type TestCommand } from './phases.ts'

// A runner for test_runner_test.ts to signal, in a process of its own:
//
// - `bulk <dir>` runs bin/test.ts --bulk over the two test files in dir;
// - `orchestrator [stubborn-]<phase> <dir> [code]` runs two phases
//   (test_runner_phase.sh), the named one held open with a grandchild, or
//   ending with the code given, and ends as the runner says. A stubborn run
//   settles on a clock that holds until the case writes `release`.

if (import.meta.main) {
  let [mode, phase, dir, codeText] = Deno.args
  let stubborn = phase.startsWith('stubborn-')
  let phaseName = phase.replace(/^stubborn-/, '')

  if (mode === 'bulk') {
    let result = await runTestCommands([{
      command: Deno.execPath(),
      args: [
        'run',
        '-A',
        new URL('./test.ts', import.meta.url).pathname,
        '--bulk',
        `${dir}/a_test.ts`,
        `${dir}/packages/web/b_test.ts`,
      ],
    }])
    Deno.exit(result.code ?? 1)
  } else if (mode === 'orchestrator') {
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
      : phaseName === 'isolated'
      ? [child('broad', 0), child('isolated')]
      : phaseName === 'broad-code'
      ? [child('broad', Number(codeText)), child('isolated', 0)]
      : [child('broad', 0), child('isolated', Number(codeText))]
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
}
