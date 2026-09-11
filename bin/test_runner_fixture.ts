import { tick, until } from '../src/testing.ts'
import { runTestCommands, type TestCommand } from './test.ts'

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
      `${dir}/b_test.ts`,
    ],
    env: { DENO_JOBS: '2' },
  }])
  Deno.exit(result.code ?? 1)
} else if (mode === 'grandchild') {
  let signal = ''
  let exiting = false
  for (let name of ['SIGINT', 'SIGTERM'] as const) {
    Deno.addSignalListener(name, () => {
      signal ||= name
      Deno.writeTextFileSync(`${dir}/grandchild.signal`, signal)
      Deno.writeTextFileSync(
        `${dir}/grandchild.signals`,
        `${name}\n`,
        { append: true },
      )
      if (stubborn) return
      if (!exiting) {
        exiting = true
        // The parent releases us only after the orchestrator has observed
        // every signal in this case. No wall-clock padding for overlap.
        void until(() => {
          try {
            Deno.statSync(`${dir}/release`)
            return true
          } catch (e) {
            if (!(e instanceof Deno.errors.NotFound)) throw e
            return false
          }
        }, { timeout: 15_000 }).then(() =>
          Deno.exit(signal === 'SIGINT' ? 130 : 143)
        )
      }
    })
  }
  await Deno.writeTextFile(`${dir}/grandchild.pid`, `${Deno.pid}`)
  await new Promise(() => {})
} else if (mode === 'child') {
  if (codeText) Deno.exit(Number(codeText))
  if (stubborn) {
    for (let name of ['SIGINT', 'SIGTERM'] as const) {
      Deno.addSignalListener(name, () => {
        Deno.writeTextFileSync(
          `${dir}/${phaseName}.leader.signals`,
          `${name}\n`,
          { append: true },
        )
      })
    }
  }
  new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', import.meta.filename!, 'grandchild', phase, dir],
    stdin: 'null',
    stdout: 'null',
    stderr: 'null',
  }).spawn()
  await Deno.writeTextFile(`${dir}/${phaseName}.ready`, `${Deno.pid}`)
  // An unresolved promise alone does not keep Deno's event loop alive. Keep
  // this phase active until the orchestrator forwards its cancellation.
  setInterval(() => {}, 1_000)
  await new Promise(() => {})
} else if (mode === 'orchestrator') {
  let now = 0
  let clock = {
    now: () => now,
    wait: async () => {
      await until(() => {
        try {
          Deno.statSync(`${dir}/release`)
          return true
        } catch (e) {
          if (!(e instanceof Deno.errors.NotFound)) throw e
          return false
        }
      }, { timeout: 15_000 })
      await tick()
      now += 250
      Deno.writeTextFileSync(`${dir}/clock`, String(now))
    },
  }
  let child = (name: string, code?: number): TestCommand => ({
    command: Deno.execPath(),
    args: [
      'run',
      '-A',
      import.meta.filename!,
      'child',
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
    ? [child('broad', Number(codeText)), child('isolated')]
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
