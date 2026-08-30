import { runTestCommands, type TestCommand } from './test.ts'

let [mode, phase, dir, codeText] = Deno.args
let stubborn = phase.startsWith('stubborn-')
let phaseName = phase.replace(/^stubborn-/, '')

if (mode === 'grandchild') {
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
        // Leave enough time for an overlapping delivery to reach the
        // orchestrator while its accepted outcome and cleanup are settled.
        setTimeout(() => Deno.exit(signal === 'SIGINT' ? 130 : 143), 250)
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
  let result = await runTestCommands(commands, { terminateOnSignal: true })
  Deno.exit(result.code)
}
